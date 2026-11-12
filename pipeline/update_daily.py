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
from datetime import date, datetime, timedelta, timezone

import duckdb
import pandas as pd

from . import settings
from .db import session
from .quality_gates import run_gates
from .sources import akshare_fallback as ak_fb
from .io_utils import atomic_write_json
from .locking import publish_lock

DATASETS = ["daily", "daily_basic", "adj_factor", "stk_limit", "limit_list_d", "moneyflow", "margin"]


def log(msg: str) -> None:
    print(f"[update] {msg}", flush=True)


def tushare_pro():
    if not settings.TUSHARE_TOKEN:
        raise RuntimeError(
            "未配置 TUSHARE_TOKEN。请在 breadthlab/.env 写入 TUSHARE_TOKEN=xxxx，"
            "离线重建请运行 python -m pipeline.release --rebuild。"
        )
    import tushare as ts

    # Pass credentials in memory; set_token() persists a copy in the user profile.
    return ts.pro_api(settings.TUSHARE_TOKEN, timeout=25)


def open_days(con: duckdb.DuckDBPyConnection, start: str, end: str) -> list[str]:
    rows = con.execute(
        "SELECT cal_date FROM core_trade_cal WHERE is_open=1 AND cal_date >= ? AND cal_date <= ? ORDER BY cal_date",
        [start, end],
    ).fetchall()
    return [r[0] for r in rows]


def ensure_calendar(pro, con: duckdb.DuckDBPyConnection, end: str) -> None:
    """本地 trade_cal 也停在快照日，先向 Tushare 续上，否则会判定“无缺口”。"""
    first = con.execute("SELECT min(cal_date) FROM core_trade_cal").fetchall()[0][0]
    start = first or settings.BOOTSTRAP_START.replace("-", "")
    # Refresh the full calendar interval, including holes and revised holiday flags.
    df = pro.trade_cal(exchange="SSE", start_date=str(start), end_date=str(end))
    if df is None or df.empty:
        raise RuntimeError("trade calendar unavailable")
    df = df.copy()
    df["cal_date"] = df["cal_date"].astype(str)
    df["pretrade_date"] = df["pretrade_date"].astype(str)
    con.register("tmp_cal", df[["cal_date", "pretrade_date", "is_open"]])
    con.execute("BEGIN TRANSACTION")
    try:
        con.execute("DELETE FROM core_trade_cal WHERE cal_date IN (SELECT cal_date FROM tmp_cal)")
        con.execute(
            """
            INSERT INTO core_trade_cal (cal_date, trade_date, pretrade_date, is_open)
            SELECT cal_date, strptime(cal_date, '%Y%m%d')::DATE, pretrade_date, is_open
            FROM tmp_cal t
            WHERE NOT EXISTS (SELECT 1 FROM core_trade_cal c WHERE c.cal_date = t.cal_date)
            """
        )
        con.execute("COMMIT")
    except BaseException:
        con.execute("ROLLBACK")
        raise
    finally:
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
        if (df.duplicated(["ts_code", "trade_date"]).any() or not df["ts_code"].eq(code).all()
                or not df["trade_date"].between(datetime.strptime(start, "%Y%m%d").date(),
                                                  datetime.strptime(end, "%Y%m%d").date()).all()):
            raise ValueError("invalid index response keys or dates")
        con.register("tmp_idx", df)
        # Called both inside daily transactions and independently for history.
        # One MERGE statement keeps corrections atomic in both cases.
        con.execute(
            """
            MERGE INTO core_index_day c USING tmp_idx t
            ON c.ts_code=t.ts_code AND c.trade_date=t.trade_date
            WHEN MATCHED THEN UPDATE SET open=t.open, high=t.high, low=t.low, close=t.close,
                pre_close=t.pre_close, pct_chg=t.pct_chg, vol=t.vol, amount=t.amount
            WHEN NOT MATCHED THEN INSERT (ts_code,trade_date,open,high,low,close,pre_close,pct_chg,vol,amount)
                VALUES (t.ts_code,t.trade_date,t.open,t.high,t.low,t.close,t.pre_close,t.pct_chg,t.vol,t.amount)
            """
        )
        total += len(df)
        con.unregister("tmp_idx")
        time.sleep(0.3)
    log(f"indices inserted: {total}")
    return total


def last_loaded(con: duckdb.DuckDBPyConnection) -> str:
    v = con.execute("SELECT max(trade_date) FROM core_stock_day").fetchall()[0][0]
    return v.strftime("%Y%m%d") if v else settings.BOOTSTRAP_START.replace("-", "")


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
        return pd.concat([pro.limit_list_d(trade_date=day, limit_type=k) for k in ("U", "D", "Z")], ignore_index=True)
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
        if not df["trade_date"].eq(datetime.strptime(day, "%Y%m%d").date()).all():
            raise ValueError("response contains a different trade date")
    key = ["exchange_id", "trade_date"] if ds == "margin" else ["ts_code", "trade_date"]
    if df.duplicated(key).any():
        raise ValueError(f"duplicate keys in {ds} response")
    con.register("tmp_df", df)
    if ds == "daily":
        con.execute("""UPDATE core_stock_day SET open=t.open, high=t.high, low=t.low,
            close=t.close, pre_close=t.pre_close, pct_chg=t.pct_chg, vol=t.vol, amount=t.amount,
            adj_close=t.close * core_stock_day.adj_factor
            FROM tmp_df t WHERE core_stock_day.ts_code=t.ts_code AND core_stock_day.trade_date=t.trade_date""")
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
        con.execute("DELETE FROM core_limit_event WHERE (ts_code, trade_date) IN (SELECT ts_code, trade_date FROM tmp_df)")
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
        con.execute("DELETE FROM core_flow_day WHERE (ts_code, trade_date) IN (SELECT ts_code, trade_date FROM tmp_df)")
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
        con.execute("DELETE FROM core_margin_day WHERE (exchange_id, trade_date) IN (SELECT exchange_id, trade_date FROM tmp_df)")
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
    return len(df)


def _today() -> str:
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d")


def _checkpoint_schema(con):
    con.execute("""CREATE TABLE IF NOT EXISTS core_dataset_checkpoint (
        trade_date DATE, dataset VARCHAR, source VARCHAR, completed BOOLEAN,
        updated_at TIMESTAMP, PRIMARY KEY(trade_date, dataset))""")


def _checkpoint(con, day, ds, src):
    con.execute("""INSERT INTO core_dataset_checkpoint VALUES (?::DATE, ?, ?, TRUE, current_timestamp)
        ON CONFLICT(trade_date,dataset) DO UPDATE SET source=excluded.source,
        completed=TRUE, updated_at=excluded.updated_at""",
        [datetime.strptime(day, "%Y%m%d").date(), ds, src])


def _run(target=None, dry=False, source="auto"):
    from .build_marts import SQL_VIEW
    from .db import table_exists
    started = time.time()
    report = {"status": "ok", "days": [], "warnings": [], "sources_by_date": {}}
    end = target or _today()
    datetime.strptime(end, "%Y%m%d")
    if end > _today():
        raise ValueError("future trade date is not allowed")
    with session(read_only=dry, wait=not dry, timeout_sec=600, interval=5) as con:
        last = last_loaded(con)
        first = con.execute("SELECT min(trade_date) FROM core_stock_day").fetchone()[0]
        start = first.strftime("%Y%m%d") if first else settings.BOOTSTRAP_START.replace("-", "")
        pro = None
        if source in ("auto", "tushare"):
            try:
                pro = tushare_pro()
            except RuntimeError:
                if source == "tushare":
                    raise
                report["warnings"].append("Tushare unavailable; only verified current-day fallback is possible")
        if pro is not None and not dry:
            ensure_calendar(pro, con, end)
        calendar = open_days(con, start, end)
        if pro is None:
            verified = [d for d in ak_fb.trading_days() if d <= end]
            if end not in verified:
                raise RuntimeError("requested date is not a verified trading day")
            if not dry:
                # The new day must exist locally too: weights, IPO age and
                # streak continuity all use this calendar during mart rebuild.
                con.executemany("""INSERT INTO core_trade_cal
                    SELECT ?, ?::DATE, ?, 1 WHERE NOT EXISTS
                    (SELECT 1 FROM core_trade_cal WHERE cal_date=?)""",
                    [(d, datetime.strptime(d, "%Y%m%d").date(),
                      verified[i-1] if i else "", d) for i, d in enumerate(verified)])
            calendar = [end]
        loaded = {r[0].strftime("%Y%m%d") for r in con.execute(
            "SELECT DISTINCT trade_date FROM core_stock_day").fetchall()}
        # Replay recent dates for T+1 datasets and corrections, plus every daily hole.
        replay = set(calendar[-20:])
        days = sorted(d for d in calendar if d not in loaded or d in replay or target == d)
        if table_exists(con, "core_dataset_checkpoint"):
            days = sorted(set(days) | {r[0].strftime("%Y%m%d") for r in con.execute(
                """SELECT DISTINCT trade_date FROM core_dataset_checkpoint WHERE (NOT completed OR source='akshare')
                AND dataset IN ('daily','daily_basic','adj_factor','stk_limit') AND trade_date <= ?::DATE""",
                [datetime.strptime(end, "%Y%m%d").date()]).fetchall()})
        report.update({"from": last, "to": end, "pending": days})
        log(f"last={last} pending={len(days)} days")
        if dry:
            report["duration_sec"] = round(time.time() - started, 1)
            return report
        _checkpoint_schema(con)
        if pro is not None:
            # New listings and renamed stocks must not wait for a manual refresh.
            from .bootstrap_api import _load_meta
            con.execute("BEGIN TRANSACTION")
            try:
                _load_meta(pro, con)
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
        bridge = (settings.ROOT / "config" / "industry_bridge.csv").as_posix().replace("'", "''")
        used = {}
        for day in days:
            day_started = time.time()
            day_sources = {}
            affected = {}
            con.execute("BEGIN TRANSACTION")
            transaction_active = True
            try:
                for ds in DATASETS:
                    df = None
                    src = "tushare"
                    failure = None
                    if pro is not None:
                        try:
                            df = fetch(pro, ds, day)
                        except Exception as exc:
                            failure = type(exc).__name__
                    if (df is None or df.empty) and source in ("auto", "akshare"):
                        try:
                            alternate = ak_fb.fetch(con, ds, day)
                            if alternate is not None and not alternate.empty:
                                df, src = alternate, "akshare"
                                report["warnings"].append(f"{day} {ds}: using akshare fallback")
                        except Exception as exc:
                            failure = type(exc).__name__
                    if df is None or df.empty:
                        day_sources[ds] = "unavailable"
                        report["warnings"].append(f"{day} {ds}: {failure or 'empty'}")
                        con.execute("""INSERT INTO core_dataset_checkpoint VALUES (?::DATE, ?, 'unavailable', FALSE, current_timestamp)
                            ON CONFLICT(trade_date,dataset) DO UPDATE SET completed=FALSE""",
                            [datetime.strptime(day, "%Y%m%d").date(), ds])
                        core_required = ds in ("daily", "daily_basic", "adj_factor", "stk_limit")
                        if source == "tushare" or core_required:
                            raise RuntimeError(f"{day} required dataset {ds} unavailable")
                        continue
                    affected[ds] = insert(con, ds, df, day)
                    day_sources[ds] = src
                    _checkpoint(con, day, ds, src)
                    time.sleep(0.35)
                if pro is not None:
                    update_indices(pro, con, day, day)
                    n_idx = con.execute("SELECT count(DISTINCT ts_code) FROM core_index_day WHERE trade_date=?::DATE",
                                        [datetime.strptime(day, "%Y%m%d").date()]).fetchone()[0]
                    day_sources["index"] = "tushare" if n_idx == 4 else "incomplete"
                else:
                    day_sources["index"] = "unavailable"
                con.execute(SQL_VIEW.format(bridge=bridge))
                prev = con.execute("SELECT max(cal_date) FROM core_trade_cal WHERE is_open=1 AND cal_date < ?",
                                   [day]).fetchone()[0]
                gate = run_gates(con, day, prev, persist=False)
                report.setdefault("gates", {})[day] = gate
                report["warnings"].extend(f"{day}: gate {g['id']} {g['name']}" for g in gate["gates"]
                                          if not g["pass"] and g["level"] == "warn")
                if not gate["passed"]:
                    raise RuntimeError(f"{day}: quality gates failed {gate['blocking']}")
                con.execute("COMMIT")
                transaction_active = False
                atomic_write_json(settings.META / "quality" / f"{day}.json", gate)
                atomic_write_json(settings.META / "quality" / "latest.json", gate)
            except Exception as exc:
                if transaction_active:
                    con.execute("ROLLBACK")
                # Persist failure independently; rolling back must not erase retry intent.
                for ds in DATASETS:
                    con.execute("""INSERT INTO core_dataset_checkpoint VALUES (?::DATE, ?, 'failed', FALSE, current_timestamp)
                        ON CONFLICT(trade_date,dataset) DO UPDATE SET completed=FALSE""",
                        [datetime.strptime(day, "%Y%m%d").date(), ds])
                if day in report.get("gates", {}):
                    atomic_write_json(settings.META / "quality" / f"{day}.json", gate)
                    atomic_write_json(settings.META / "quality" / "latest.json", gate)
                report["status"] = "failed"
                report["warnings"].append(f"{day}: {type(exc).__name__}: {exc}")
                break
            report["sources_by_date"][day] = day_sources
            used = day_sources
            report["days"].append({"date": day, "affected_rows": affected,
                                   "inserted": affected, "sec": round(time.time() - day_started, 1)})
        if pro is not None and report["status"] == "ok":
            # Optional/late datasets have independent retries. Never refetch all
            # seven daily datasets just because an old margin row is absent.
            for ds, table, minimum in (("margin", "core_margin_day", 2),
                                        ("moneyflow", "core_flow_day", 1),
                                        ("limit_list_d", "core_limit_event", 1)):
                holes = con.execute(f"""SELECT c.cal_date FROM core_trade_cal c
                    WHERE c.is_open=1 AND c.cal_date BETWEEN ? AND ?
                    AND (SELECT count(*) FROM {table} t WHERE t.trade_date=c.trade_date) < ?
                    ORDER BY c.cal_date""", [start, end, minimum]).fetchall()
                for (missing_day,) in holes:
                    if missing_day in days:
                        continue
                    try:
                        frame = fetch(pro, ds, missing_day)
                        if frame is None or frame.empty:
                            continue
                        con.execute("BEGIN TRANSACTION")
                        try:
                            insert(con, ds, frame, missing_day)
                            _checkpoint(con, missing_day, ds, "tushare")
                            con.execute("COMMIT")
                        except Exception:
                            con.execute("ROLLBACK")
                            raise
                    except Exception:
                        report["warnings"].append(f"{missing_day} {ds}: historical retry unavailable")
                        # Permission/outage should not issue thousands of identical requests.
                        break
                    time.sleep(0.35)
            # Index history has its own holes; the stock watermark cannot hide them.
            hole = con.execute("""SELECT min(c.cal_date) FROM core_trade_cal c
                WHERE c.is_open=1 AND c.cal_date BETWEEN ? AND ?
                AND (SELECT count(DISTINCT i.ts_code) FROM core_index_day i
                     WHERE i.trade_date=c.trade_date) < 4""", [start, end]).fetchone()[0]
            if hole:
                update_indices(pro, con, hole, end)
        con.execute("CHECKPOINT")
    report["sources"] = used
    report["duration_sec"] = round(time.time() - started, 1)
    status = {"status": report["status"], "last_trade_date": max(
        [d["date"] for d in report["days"]], default=last),
        "updated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "sources": used, "warnings": report["warnings"], "duration_sec": report["duration_sec"]}
    atomic_write_json(settings.META / "status.json", status)
    atomic_write_json(settings.META / f"update_{_today()}.json", report)
    return report


def run(target: str | None = None, dry: bool = False, source: str = "auto") -> dict:
    with publish_lock():
        return _run(target, dry, source)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="目标日期 YYYYMMDD；允许重试已存在日期")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source", choices=["auto", "tushare", "akshare"], default="auto")
    args = ap.parse_args()
    from . import alerts
    try:
        result = run(args.date, args.dry_run, args.source)
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        if result["status"] != "ok":
            if not args.dry_run:
                alerts.write("update", "quality gates or required dataset failed")
            raise SystemExit(2)
    except Exception:
        if not args.dry_run:
            alerts.write("update", "数据拉取未完成；请检查本机更新日志")
        raise
