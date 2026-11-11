"""幂等的每日增量更新。

流程：
1. 读 trade_cal 找到 lake 之后缺失的交易日；
2. 按日批量拉取 Tushare（daily / daily_basic / adj_factor / stk_limit / limit_list_d / moneyflow）；
3. 质量门禁（行数、覆盖率、收益一致性）；
4. 写入 core 表（不重复插入）；
5. 重算 mart 与静态导出。

用法：
    python -m pipeline.update_daily              # 补到最新交易日
    python -m pipeline.update_daily --date 20260525
    python -m pipeline.update_daily --dry-run
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import date, datetime, timedelta

import duckdb
import pandas as pd

from . import settings
from .db import session
from .quality_gates import run_gates
from .sources import akshare_fallback as ak_fb

DATASETS = ["daily", "daily_basic", "adj_factor", "stk_limit", "limit_list_d", "moneyflow", "margin"]


def log(msg: str) -> None:
    print(f"[update] {msg}", flush=True)


def tushare_pro():
    if not settings.TUSHARE_TOKEN:
        raise SystemExit(
            "未配置 TUSHARE_TOKEN。请在 breadthlab/.env 写入 TUSHARE_TOKEN=xxxx，"
            "或运行 python -m pipeline.update_daily --offline 只重建 mart。"
        )
    import tushare as ts

    ts.set_token(settings.TUSHARE_TOKEN)
    return ts.pro_api()


def open_days(con: duckdb.DuckDBPyConnection, start: str, end: str) -> list[str]:
    rows = con.execute(
        "SELECT cal_date FROM core_trade_cal WHERE is_open=1 AND cal_date >= ? AND cal_date <= ? ORDER BY cal_date",
        [start, end],
    ).fetchall()
    return [r[0] for r in rows]


def ensure_calendar(pro, con: duckdb.DuckDBPyConnection, end: str) -> None:
    """本地 trade_cal 也停在快照日，先向 Tushare 续上，否则会判定“无缺口”。"""
    maxd = con.execute("SELECT max(cal_date) FROM core_trade_cal").fetchall()[0][0]
    if maxd >= end:
        return
    df = pro.trade_cal(exchange="SSE", start_date=str(maxd), end_date=str(end))
    if df is None or df.empty:
        return
    df = df.copy()
    df["cal_date"] = df["cal_date"].astype(str)
    df["pretrade_date"] = df["pretrade_date"].astype(str)
    con.register("tmp_cal", df[["cal_date", "pretrade_date", "is_open"]])
    con.execute(
        """
        INSERT INTO core_trade_cal (cal_date, trade_date, pretrade_date, is_open)
        SELECT cal_date, strptime(cal_date, '%Y%m%d')::DATE, pretrade_date, is_open
        FROM tmp_cal t
        WHERE NOT EXISTS (SELECT 1 FROM core_trade_cal c WHERE c.cal_date = t.cal_date)
        """
    )
    con.unregister("tmp_cal")
    log(f"calendar extended to {con.execute('SELECT max(cal_date) FROM core_trade_cal').fetchall()[0][0]}")


def update_indices(pro, con: duckdb.DuckDBPyConnection, start: str, end: str) -> int:
    total = 0
    for code in ["000300.SH", "000905.SH", "000852.SH", "000001.SH"]:
        try:
            df = pro.index_daily(ts_code=code, start_date=start, end_date=end)
        except Exception as e:
            log(f"index {code} failed: {e}")
            continue
        if df is None or df.empty:
            continue
        df = df.copy()
        df["trade_date"] = pd.to_datetime(df["trade_date"].astype(str), format="%Y%m%d").dt.date
        con.register("tmp_idx", df)
        n = con.execute(
            """
            INSERT INTO core_index_day
            SELECT ts_code, trade_date, open, high, low, close, pre_close, pct_chg, vol, amount
            FROM tmp_idx t
            WHERE NOT EXISTS (
                SELECT 1 FROM core_index_day c WHERE c.ts_code = t.ts_code AND c.trade_date = t.trade_date
            )
            """
        ).fetchall()
        total += (n[0][0] if n else 0)
        con.unregister("tmp_idx")
        time.sleep(0.3)
    log(f"indices inserted: {total}")
    return total


def last_loaded(con: duckdb.DuckDBPyConnection) -> str:
    v = con.execute("SELECT max(trade_date) FROM core_stock_day").fetchall()[0][0]
    return v.strftime("%Y%m%d")


def fetch(pro, ds: str, day: str) -> pd.DataFrame:
    if ds == "daily":
        return pro.daily(trade_date=day)
    if ds == "daily_basic":
        return pro.daily_basic(trade_date=day)
    if ds == "adj_factor":
        return pro.adj_factor(trade_date=day)
    if ds == "stk_limit":
        return pro.stk_limit(trade_date=day)
    if ds == "limit_list_d":
        return pro.limit_list_d(trade_date=day)
    if ds == "moneyflow":
        return pro.moneyflow(trade_date=day)
    if ds == "margin":
        return pro.margin(trade_date=day)
    raise ValueError(ds)


def quality(con: duckdb.DuckDBPyConnection, day: str) -> tuple[bool, list[str]]:
    msgs: list[str] = []
    d = datetime.strptime(day, "%Y%m%d").date()
    q = con.execute(
        """
        SELECT count(*) n,
               count(*) FILTER (WHERE circ_mv IS NOT NULL) n_mv,
               count(*) FILTER (WHERE adj_factor IS NOT NULL) n_adj,
               count(*) FILTER (WHERE abs(pct_chg) > 21) n_bad
        FROM core_stock_day WHERE trade_date = ?
        """,
        [d],
    ).fetchall()[0]
    n, n_mv, n_adj, n_bad = q
    if n < 3000:
        msgs.append(f"row count too low: {n}")
    if n and n_mv / n < 0.95:
        msgs.append(f"circ_mv coverage low: {n_mv / n:.2%}")
    if n and n_adj / n < 0.95:
        msgs.append(f"adj_factor coverage low: {n_adj / n:.2%}")
    if n and n_bad / n > 0.01:
        msgs.append(f"abnormal |pct_chg|>21%: {n_bad / n:.2%}")
    return (len(msgs) == 0), msgs


def insert(con: duckdb.DuckDBPyConnection, ds: str, df: pd.DataFrame, day: str) -> int:
    if df is None or df.empty:
        return 0
    df = df.copy()
    if "trade_date" in df.columns:
        df["trade_date"] = pd.to_datetime(df["trade_date"].astype(str), format="%Y%m%d").dt.date
    con.register("tmp_df", df)
    before = con.execute("SELECT count(*) FROM core_stock_day").fetchall()[0][0]
    if ds == "daily":
        con.execute(
            """
            INSERT INTO core_stock_day (ts_code, trade_date, open, high, low, close, pre_close, pct_chg, vol, amount)
            SELECT ts_code, trade_date, open, high, low, close, pre_close, pct_chg, vol, amount
            FROM tmp_df t
            WHERE NOT EXISTS (SELECT 1 FROM core_stock_day c WHERE c.ts_code=t.ts_code AND c.trade_date=t.trade_date)
            """
        )
    elif ds == "adj_factor":
        con.execute(
            """
            UPDATE core_stock_day SET adj_factor = t.adj_factor, adj_close = close * t.adj_factor
            FROM tmp_df t
            WHERE core_stock_day.ts_code = t.ts_code AND core_stock_day.trade_date = t.trade_date
            """
        )
    elif ds == "daily_basic":
        con.execute(
            """
            UPDATE core_stock_day SET turnover_rate=t.turnover_rate, turnover_rate_f=t.turnover_rate_f,
                volume_ratio=t.volume_ratio, pe_ttm=t.pe_ttm, pb=t.pb, total_mv=t.total_mv, circ_mv=t.circ_mv
            FROM tmp_df t
            WHERE core_stock_day.ts_code = t.ts_code AND core_stock_day.trade_date = t.trade_date
            """
        )
    elif ds == "stk_limit":
        con.execute(
            """
            UPDATE core_stock_day SET up_limit=t.up_limit, down_limit=t.down_limit
            FROM tmp_df t
            WHERE core_stock_day.ts_code = t.ts_code AND core_stock_day.trade_date = t.trade_date
            """
        )
    elif ds == "limit_list_d":
        con.execute(
            """
            INSERT INTO core_limit_event
            SELECT ts_code, trade_date, industry, name, close, pct_chg, amount, limit_amount, float_mv, total_mv,
                   turnover_ratio, fd_amount, first_time, last_time, open_times, up_stat, limit_times,
                   CASE WHEN "limit"='U' THEN 1 ELSE 0 END,
                   CASE WHEN "limit"='D' THEN 1 ELSE 0 END,
                   CASE WHEN "limit"='Z' THEN 1 ELSE 0 END
            FROM tmp_df t
            WHERE NOT EXISTS (SELECT 1 FROM core_limit_event c WHERE c.ts_code=t.ts_code AND c.trade_date=t.trade_date)
            """
        )
    elif ds == "moneyflow":
        con.execute(
            """
            INSERT INTO core_flow_day
            SELECT ts_code, trade_date, net_mf_amount,
                   (buy_lg_amount + buy_elg_amount - sell_lg_amount - sell_elg_amount),
                   (buy_lg_amount + buy_elg_amount + buy_md_amount + buy_sm_amount)
            FROM tmp_df t
            WHERE NOT EXISTS (SELECT 1 FROM core_flow_day c WHERE c.ts_code=t.ts_code AND c.trade_date=t.trade_date)
            """
        )
    elif ds == "margin":
        con.execute(
            """
            INSERT INTO core_margin_day
            SELECT trade_date, exchange_id, rzye, rzmre, rzche, rqye, rzrqye
            FROM tmp_df t
            WHERE NOT EXISTS (
                SELECT 1 FROM core_margin_day c
                WHERE c.trade_date = t.trade_date AND c.exchange_id = t.exchange_id
            )
            """
        )
    con.unregister("tmp_df")
    after = con.execute("SELECT count(*) FROM core_stock_day").fetchall()[0][0]
    return after - before


def run(target: str | None = None, dry: bool = False, source: str = "auto") -> dict:
    started = time.time()
    report: dict = {"status": "ok", "days": [], "warnings": []}
    with session(read_only=dry, wait=not dry, timeout_sec=600, interval=5) as con:
        last = last_loaded(con)
        end = target or date.today().strftime("%Y%m%d")
        pro = None
        if source in ("auto", "tushare"):
            pro = tushare_pro()
        if source == "akshare":
            day = target or date.today().strftime("%Y%m%d")
            days = [day] if ak_fb.is_trading_day(day) else []
            if dry:
                counts = {}
                for ds in DATASETS:
                    try:
                        df0 = ak_fb.fetch(con, ds, day)
                        counts[ds] = 0 if df0 is None else len(df0)
                    except Exception as e:
                        counts[ds] = f"{type(e).__name__}: {e}"
                report["probe"] = counts
                report["from"] = last
                report["to"] = day
                report["pending"] = days
                report["duration_sec"] = round(time.time() - started, 1)
                return report
        elif not dry:
            ensure_calendar(pro, con, end)
            days = open_days(con, last, end)
        else:
            cal = pro.trade_cal(exchange="SSE", start_date=last, end_date=end)
            days = sorted(
                cal.loc[(cal["is_open"] == 1) & (cal["cal_date"].astype(str) > last), "cal_date"]
                .astype(str)
                .tolist()
            )
        # 去掉已完整加载的当天
        days = [d for d in days if d > last]
        report["from"] = last
        report["to"] = end
        report["pending"] = days
        log(f"last={last} pending={len(days)} days")
        if dry or not days:
            report["duration_sec"] = round(time.time() - started, 1)
            return report

        used: dict[str, str] = {}
        for day in days:
            day_started = time.time()
            inserted = {}
            for ds in DATASETS:
                src = "tushare"
                df = None
                err: Exception | None = None
                if source in ("auto", "tushare") and pro is not None:
                    try:
                        df = fetch(pro, ds, day)
                    except Exception as e:  # 单数据集失败不阻断，尝试备用源
                        err = e
                        log(f"{day} {ds} tushare failed: {type(e).__name__}")
                if (df is None or df.empty) and source in ("auto", "akshare"):
                    try:
                        fdf = ak_fb.fetch(con, ds, day)
                        if fdf is not None and not fdf.empty:
                            df = fdf
                            src = "akshare"
                            log(f"{day} {ds} fell back to akshare")
                    except Exception as e:
                        err = e
                if df is None or df.empty:
                    msg = f"{day} {ds} failed: {type(err).__name__ if err else 'empty'}"
                    if ds == "limit_list_d":
                        msg += " (no permission)"
                    log(msg)
                    report["warnings"].append(msg)
                    used.setdefault(ds, "unavailable")
                else:
                    n = insert(con, ds, df, day)
                    inserted[ds] = n
                    used[ds] = src
                    log(f"{day} {ds}: {len(df)} rows (inserted {n}, source {src})")
                time.sleep(0.35)
            prev = con.execute(
                "SELECT max(cal_date) FROM core_trade_cal WHERE is_open=1 AND cal_date < ? AND cal_date >= '20161201'",
                [day],
            ).fetchall()[0][0]
            gate = run_gates(con, day, prev)
            report.setdefault("gates", {})[day] = [{"id": g["id"], "pass": g["pass"]} for g in gate["gates"]]
            if not gate["passed"]:
                report["status"] = "failed"
                report["warnings"].append(f"{day}: quality gates failed {gate['blocking']}")
                log(f"quality gate failed: {gate['blocking']}")
                break
            report["days"].append({"date": day, "inserted": inserted, "sec": round(time.time() - day_started, 1)})
        if report["days"] and pro is not None:
            try:
                update_indices(pro, con, last, end)
            except Exception as e:
                report["warnings"].append(f"index update failed: {e}")
                log(f"index update failed: {e}")
        con.execute("CHECKPOINT")

    report["duration_sec"] = round(time.time() - started, 1)
    report["sources"] = used
    qlatest = settings.META / "quality" / "latest.json"
    qdata = json.loads(qlatest.read_text(encoding="utf-8")) if qlatest.exists() else {}
    gates = [{"id": g["id"], "pass": g["pass"]} for g in qdata.get("gates", [])]
    coverage = next((g["value"] for g in qdata.get("gates", []) if g["id"] == 5), None)
    status = {
        "status": report["status"],
        "last_trade_date": str(
            max([d["date"] for d in report["days"]], default=report.get("from", ""))
        ),
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "rows": {"daily": qdata.get("rows")},
        "coverage": coverage,
        "sources": {**(used or {"daily": "tushare"}), "index": "akshare"},
        "gates": gates,
        "warnings": report["warnings"][-3:],
        "duration_sec": report["duration_sec"],
        "message": "",
    }
    (settings.META / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    (settings.META / f"update_{date.today():%Y%m%d}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="目标日期 YYYYMMDD")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source", choices=["auto", "tushare", "akshare"], default="auto", help="auto=Tushare 失败时降级 akshare")
    args = ap.parse_args()

    lock = settings.DATA / ".update.lock"
    if lock.exists() and time.time() - lock.stat().st_mtime < 1800:
        print(json.dumps({"status": "skipped", "reason": "another update is running"}, ensure_ascii=False))
        raise SystemExit(0)
    lock.write_text(str(time.time()), encoding="utf-8")
    try:
        result = run(args.date, args.dry_run, args.source)
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    finally:
        lock.unlink(missing_ok=True)
