"""从 Tushare API 构建 core 层（没有本地 parquet 快照时使用）。

用法：
    python -m pipeline.bootstrap_api --start 20240101
    python -m pipeline.bootstrap_api --start 20240101 --db data/lake.duckdb

说明：
- 每个交易日 7 个数据集各 1 次调用，历史越长耗时越久（约 1–2 秒/日）。
- `limit_list_d` 需要额外积分，无权限时自动跳过并记录 warning。
- 完成后运行 `python -m pipeline.build_marts` 生成 mart。
"""
from __future__ import annotations

import argparse
import time
from datetime import date, datetime

import duckdb
import pandas as pd

from . import settings
from .update_daily import DATASETS, fetch, insert, log, tushare_pro, update_indices

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
            if df is not None and not df.empty:
                frames.append(df)
        except Exception as e:
            log(f"stock_basic {status} failed: {type(e).__name__}")
    if not frames:
        return 0
    meta = pd.concat(frames, ignore_index=True).drop_duplicates("ts_code")
    for col in ("delist_date", "is_hs", "list_date"):
        meta[col] = meta[col].astype("string").fillna("")
    con.register("meta_df", meta)
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
        return []
    con.register("cal_df", cal)
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


def run(start: str, end: str, db_path: str | None = None) -> dict:
    end = end or date.today().strftime("%Y%m%d")
    con = duckdb.connect(db_path or str(settings.LAKE))
    _init(con)
    pro = tushare_pro()

    n_meta = _load_meta(pro, con)
    days = _load_calendar(pro, con, start, end)
    log(f"meta={n_meta} trading_days={len(days)} range={start}..{end}")
    if not days:
        con.close()
        return {"days": 0, "rows": 0}

    total = 0
    warnings: list[str] = []
    for i, day in enumerate(days, 1):
        for ds in DATASETS:
            try:
                df = fetch(pro, ds, day)
                total += insert(con, ds, df, day)
            except Exception as e:
                msg = f"{day} {ds}: {type(e).__name__}"
                if ds == "limit_list_d":
                    msg += " (no permission)"
                warnings.append(msg)
            time.sleep(0.15)
        if i % 20 == 0 or i == len(days):
            log(f"{i}/{len(days)} days, rows={total:,}")

    try:
        update_indices(pro, con, start, end)
    except Exception as e:
        warnings.append(f"index: {type(e).__name__}")

    con.close()
    log(f"done: rows={total:,}, warnings={len(warnings)}")
    return {"days": len(days), "rows": total, "warnings": warnings[-10:]}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="20240101", help="起始日期 YYYYMMDD")
    ap.add_argument("--end", default=date.today().strftime("%Y%m%d"))
    ap.add_argument("--db", default=None, help="目标 DuckDB（默认 data/lake.duckdb）")
    args = ap.parse_args()
    result = run(args.start, args.end, args.db)
    print(result)
