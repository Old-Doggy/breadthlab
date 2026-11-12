"""从 Tushare API 构建 core 层（没有本地 parquet 快照时使用）。

用法：
    python -m pipeline.bootstrap_api --start 20240101
    python -m pipeline.bootstrap_api --start 20240101 --db data/lake.duckdb

说明：
- 每日请求7类数据，其中涨跌停事件分U/D/Z三次，另有4个指数请求；限频等待至少约2.45秒/日，网络耗时另计。
- `limit_list_d` 需要额外积分，无权限时自动跳过并记录 warning。
- 完成后运行 `python -m pipeline.build_marts` 生成 mart。
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime

import duckdb
import pandas as pd

from . import settings
from .update_daily import DATASETS, fetch, insert, log, tushare_pro, update_indices
from .update_daily import _checkpoint_schema, _checkpoint, _today
from .locking import publish_lock
from .quality_gates import run_gates
from .io_utils import atomic_write_json

SCHEMA = {
    "core_trade_cal": """CREATE TABLE IF NOT EXISTS core_trade_cal (
        cal_date VARCHAR, trade_date DATE, pretrade_date VARCHAR, is_open INTEGER)""",
    "core_stock_meta": """CREATE TABLE IF NOT EXISTS core_stock_meta (
        ts_code VARCHAR, symbol VARCHAR, name VARCHAR, area VARCHAR, industry VARCHAR,
        market VARCHAR, exchange VARCHAR, list_status VARCHAR, list_date VARCHAR,
        delist_date VARCHAR, is_hs VARCHAR)""",
    "core_stock_day": """CREATE TABLE IF NOT EXISTS core_stock_day (
        ts_code VARCHAR, trade_date DATE, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        pre_close DOUBLE, pct_chg DOUBLE, vol DOUBLE, amount DOUBLE, adj_factor DOUBLE,
        turnover_rate DOUBLE, turnover_rate_f DOUBLE, volume_ratio DOUBLE, pe_ttm DOUBLE,
        pb DOUBLE, total_mv DOUBLE, circ_mv DOUBLE, up_limit DOUBLE, down_limit DOUBLE,
        adj_close DOUBLE)""",
    "core_index_day": """CREATE TABLE IF NOT EXISTS core_index_day (
        ts_code VARCHAR, trade_date DATE, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        pre_close DOUBLE, pct_chg DOUBLE, vol DOUBLE, amount DOUBLE)""",
    "core_limit_event": """CREATE TABLE IF NOT EXISTS core_limit_event (
        ts_code VARCHAR, trade_date DATE, industry VARCHAR, name VARCHAR, close DOUBLE,
        pct_chg DOUBLE, amount BIGINT, limit_amount DOUBLE, float_mv DOUBLE, total_mv DOUBLE,
        turnover_ratio DOUBLE, fd_amount DOUBLE, first_time VARCHAR, last_time VARCHAR,
        open_times BIGINT, up_stat VARCHAR, limit_times DOUBLE, is_up INTEGER,
        is_down INTEGER, is_broken INTEGER)""",
    "core_flow_day": """CREATE TABLE IF NOT EXISTS core_flow_day (
        ts_code VARCHAR, trade_date DATE, net_mf_amount DOUBLE, main_net_amount DOUBLE,
        total_buy_amount DOUBLE)""",
    "core_margin_day": """CREATE TABLE IF NOT EXISTS core_margin_day (
        trade_date DATE, exchange_id VARCHAR, rzye BIGINT, rzmre BIGINT, rzche BIGINT,
        rqye BIGINT, rzrqye BIGINT)""",
}

META_FIELDS = "ts_code,symbol,name,area,industry,market,exchange,list_status,list_date,delist_date,is_hs"


def _init(con: duckdb.DuckDBPyConnection) -> None:
    for sql in SCHEMA.values():
        con.execute(sql)


def _load_meta(pro, con: duckdb.DuckDBPyConnection) -> int:
    frames = []
    for status in ("L", "D", "P"):
        try:
            df = pro.stock_basic(exchange="", list_status=status, fields=META_FIELDS)
            if status == "L" and (df is None or df.empty):
                raise RuntimeError("listed stock metadata is empty")
            if df is not None and not df.empty:
                frames.append(df)
        except Exception as e:
            raise RuntimeError(f"stock_basic {status} unavailable; old metadata preserved") from e
    if not frames:
        raise RuntimeError("stock metadata unavailable")
    meta = pd.concat(frames, ignore_index=True).drop_duplicates("ts_code")
    for col in ("delist_date", "is_hs", "list_date"):
        meta[col] = meta[col].astype("string").fillna("")
    con.register("meta_df", meta)
    con.execute("DELETE FROM core_stock_meta WHERE ts_code IN (SELECT ts_code FROM meta_df)")
    con.execute(
        """
        INSERT INTO core_stock_meta
        SELECT ts_code, symbol, name, area, industry, market, exchange, list_status,
               list_date, delist_date, is_hs
        FROM meta_df
        WHERE ts_code NOT IN (SELECT ts_code FROM core_stock_meta)
        """
    )
    con.unregister("meta_df")
    return len(meta)


def _load_calendar(pro, con: duckdb.DuckDBPyConnection, start: str, end: str) -> list[str]:
    cal = pro.trade_cal(exchange="SSE", start_date=start, end_date=end)
    if cal is None or cal.empty:
        raise RuntimeError("trade calendar unavailable")
    con.register("cal_df", cal)
    con.execute("DELETE FROM core_trade_cal WHERE cal_date IN (SELECT cal_date::VARCHAR FROM cal_df)")
    con.execute(
        """
        INSERT INTO core_trade_cal
        SELECT cal_date::VARCHAR, strptime(cal_date, '%Y%m%d')::DATE,
               pretrade_date::VARCHAR, is_open::INT
        FROM cal_df
        WHERE cal_date::VARCHAR NOT IN (SELECT cal_date FROM core_trade_cal)
        """
    )
    con.unregister("cal_df")
    return [
        r[0]
        for r in con.execute(
            "SELECT cal_date FROM core_trade_cal WHERE is_open = 1 AND cal_date BETWEEN ? AND ? ORDER BY cal_date",
            [start, end],
        ).fetchall()
    ]


def _run(start: str, end: str, db_path: str | None = None) -> dict:
    from .build_marts import SQL_VIEW
    end = end or _today()
    datetime.strptime(start, "%Y%m%d")
    datetime.strptime(end, "%Y%m%d")
    if start > end or end > _today():
        raise ValueError("invalid bootstrap date interval")
    con = duckdb.connect(db_path or str(settings.LAKE))
    total = 0
    warnings: list[str] = []
    sources_by_date = {}
    try:
        _init(con)
        _checkpoint_schema(con)
        pro = tushare_pro()
        con.execute("BEGIN TRANSACTION")
        try:
            n_meta = _load_meta(pro, con)
            days = _load_calendar(pro, con, start, end)
            if not days:
                raise RuntimeError("bootstrap interval has no verified trading days")
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
        bridge = (settings.ROOT / "config" / "industry_bridge.csv").as_posix().replace("'", "''")
        con.execute(SQL_VIEW.format(bridge=bridge))
        log(f"meta={n_meta} trading_days={len(days)} range={start}..{end}")
        for i, day in enumerate(days, 1):
            complete = con.execute("""SELECT count(*) FROM core_dataset_checkpoint
                WHERE trade_date=?::DATE AND completed AND dataset IN ('daily','daily_basic','adj_factor','stk_limit')""",
                [datetime.strptime(day, "%Y%m%d").date()]).fetchone()[0]
            # Always replay recent days, including late T+1 data.
            if complete == 4 and i <= len(days) - 20:
                continue
            con.execute("BEGIN TRANSACTION")
            transaction_active = True
            try:
                affected = 0
                day_sources = {}
                for ds in DATASETS:
                    try:
                        df = fetch(pro, ds, day)
                        if df is None or df.empty:
                            raise RuntimeError("empty response")
                        affected += insert(con, ds, df, day)
                        _checkpoint(con, day, ds, "tushare")
                        day_sources[ds] = "tushare"
                    except Exception as exc:
                        if ds in ("daily", "daily_basic", "adj_factor", "stk_limit"):
                            raise RuntimeError(f"{day} required {ds} failed") from exc
                        warnings.append(f"{day} {ds}: {type(exc).__name__}")
                        day_sources[ds] = "unavailable"
                    time.sleep(0.35)
                update_indices(pro, con, day, day)
                n_indices = con.execute("SELECT count(DISTINCT ts_code) FROM core_index_day WHERE trade_date=?::DATE",
                                        [datetime.strptime(day, "%Y%m%d").date()]).fetchall()[0][0]
                day_sources["index"] = "tushare" if n_indices == 4 else "incomplete"
                prev = con.execute("SELECT max(cal_date) FROM core_trade_cal WHERE is_open=1 AND cal_date<?", [day]).fetchone()[0]
                gate = run_gates(con, day, prev, persist=False)
                if not gate["passed"]:
                    raise RuntimeError(f"{day} quality gates failed: {gate['blocking']}")
                warnings.extend(f"{day}: gate {g['id']} {g['name']}" for g in gate["gates"]
                                if not g["pass"] and g["level"] == "warn")
                con.execute("COMMIT")
                transaction_active = False
                total += affected
                sources_by_date[day] = day_sources
                atomic_write_json(settings.META / "quality" / f"{day}.json", gate)
                atomic_write_json(settings.META / "quality" / "latest.json", gate)
            except Exception:
                if transaction_active:
                    con.execute("ROLLBACK")
                raise
            if i % 20 == 0 or i == len(days):
                log(f"{i}/{len(days)} days, affected_rows={total:,}")
        result = {"status": "ok", "days": len(days), "affected_rows": total,
                  "warnings": warnings, "sources_by_date": sources_by_date}
        atomic_write_json(settings.META / "bootstrap.json", result)
        atomic_write_json(settings.META / "status.json", {
            "status": "ok", "last_trade_date": days[-1] if days else None,
            "sources": sources_by_date.get(days[-1], {}) if days else {}, "warnings": warnings})
        return result
    finally:
        con.close()


def run(start: str, end: str, db_path: str | None = None) -> dict:
    with publish_lock():
        try:
            return _run(start, end, db_path)
        except Exception:
            from . import alerts
            alerts.write("bootstrap", "API建库未完成，请检查本机日志并重试同一区间")
            atomic_write_json(settings.META / "status.json", {
                "status": "failed", "warnings": ["bootstrap incomplete; retry the same date interval"]})
            raise


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="20240101", help="起始日期 YYYYMMDD")
    ap.add_argument("--end", default=_today())
    ap.add_argument("--db", default=None, help="目标 DuckDB（默认 data/lake.duckdb）")
    args = ap.parse_args()
    result = run(args.start, args.end, args.db)
    print(result)
