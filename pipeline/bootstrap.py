"""Bootstrap：把 F: 的按股票 parquet 快照构建成 DuckDB core 层。

只读取项目需要的列与时间窗口，不做全库扫描。

用法:
    python -m pipeline.bootstrap                  # 全部
    python -m pipeline.bootstrap --only stock_day
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from . import settings
from .db import session
from .settings import BOOTSTRAP_START, SOURCE_ROOT

START_COMPACT = BOOTSTRAP_START.replace("-", "")  # 20161201

SRC = Path(SOURCE_ROOT).as_posix()

DDL: dict[str, str] = {
    # ---------------------------------------------------------------- 交易日历
    "core_trade_cal": f"""
        CREATE OR REPLACE TABLE core_trade_cal AS
        SELECT cal_date::VARCHAR AS cal_date,
               strptime(cal_date, '%Y%m%d')::DATE AS trade_date,
               pretrade_date::VARCHAR AS pretrade_date,
               is_open::INT AS is_open
        FROM read_parquet('{SRC}/trade_cal/all.parquet')
        WHERE exchange = 'SSE' AND cal_date >= '{START_COMPACT}'
        ORDER BY cal_date
    """,
    # ---------------------------------------------------------------- 股票静态信息
    "core_stock_meta": f"""
        CREATE OR REPLACE TABLE core_stock_meta AS
        SELECT ts_code, symbol, name, area, industry,
               market, exchange, list_status,
               list_date, delist_date, is_hs
        FROM read_parquet('{SRC}/stock_basic/*.parquet', union_by_name=true)
        QUALIFY row_number() OVER (PARTITION BY ts_code ORDER BY _fetched_at DESC) = 1
    """,
    # ---------------------------------------------------------------- 股票-日（核心事实表）
    "core_stock_day": f"""
        CREATE OR REPLACE TABLE core_stock_day AS
        WITH d AS (
            SELECT ts_code,
                   strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
                   open, high, low, close, pre_close, pct_chg, vol, amount
            FROM read_parquet('{SRC}/daily/*.parquet', union_by_name=true)
            WHERE trade_date >= '{START_COMPACT}'
        ),
        a AS (
            SELECT ts_code,
                   strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
                   adj_factor
            FROM read_parquet('{SRC}/adj_factor/*.parquet', union_by_name=true)
            WHERE trade_date >= '{START_COMPACT}'
        ),
        b AS (
            SELECT ts_code,
                   strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
                   turnover_rate, turnover_rate_f, volume_ratio,
                   pe_ttm, pb, total_mv, circ_mv
            FROM read_parquet('{SRC}/daily_basic/*.parquet', union_by_name=true)
            WHERE trade_date >= '{START_COMPACT}'
        ),
        l AS (
            SELECT ts_code,
                   strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
                   up_limit, down_limit
            FROM read_parquet('{SRC}/stk_limit/*.parquet', union_by_name=true)
            WHERE trade_date >= '{START_COMPACT}'
        )
        SELECT d.ts_code, d.trade_date, d.open, d.high, d.low, d.close, d.pre_close,
               d.pct_chg, d.vol, d.amount,
               a.adj_factor,
               b.turnover_rate, b.turnover_rate_f, b.volume_ratio,
               b.pe_ttm, b.pb, b.total_mv, b.circ_mv,
               l.up_limit, l.down_limit,
               (d.close * a.adj_factor) AS adj_close
        FROM d
        LEFT JOIN a USING (ts_code, trade_date)
        LEFT JOIN b USING (ts_code, trade_date)
        LEFT JOIN l USING (ts_code, trade_date)
    """,
    # ---------------------------------------------------------------- 指数
    "core_index_day": f"""
        CREATE OR REPLACE TABLE core_index_day AS
        SELECT ts_code,
               strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
               open, high, low, close, pre_close, pct_chg, vol, amount
        FROM read_parquet(
            ['{SRC}/index_daily/000300.SH.parquet',
             '{SRC}/index_daily/000905.SH.parquet',
             '{SRC}/index_daily/000852.SH.parquet',
             '{SRC}/index_daily/000001.SH.parquet'],
            union_by_name=true)
        WHERE trade_date >= '{START_COMPACT}'
    """,
    # ---------------------------------------------------------------- 涨跌停事件
    "core_limit_event": f"""
        CREATE OR REPLACE TABLE core_limit_event AS
        SELECT ts_code,
               strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
               industry, name, close, pct_chg, amount,
               limit_amount, float_mv, total_mv, turnover_ratio,
               fd_amount, first_time, last_time, open_times,
               up_stat, limit_times,
               CASE WHEN "limit" = 'U' THEN 1 ELSE 0 END AS is_up,
               CASE WHEN "limit" = 'D' THEN 1 ELSE 0 END AS is_down,
               CASE WHEN "limit" = 'Z' THEN 1 ELSE 0 END AS is_broken
        FROM read_parquet('{SRC}/limit_list_d/*.parquet', union_by_name=true)
        WHERE trade_date >= '{START_COMPACT}'
    """,
    # ---------------------------------------------------------------- 资金流
    "core_flow_day": f"""
        CREATE OR REPLACE TABLE core_flow_day AS
        SELECT ts_code,
               strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
               net_mf_amount,
               (buy_lg_amount + buy_elg_amount - sell_lg_amount - sell_elg_amount) AS main_net_amount,
               (buy_lg_amount + buy_elg_amount + buy_md_amount + buy_sm_amount) AS total_buy_amount
        FROM read_parquet('{SRC}/moneyflow/*.parquet', union_by_name=true)
        WHERE trade_date >= '{START_COMPACT}'
    """,
    # ---------------------------------------------------------------- 两融（交易所级）
    "core_margin_day": f"""
        CREATE OR REPLACE TABLE core_margin_day AS
        SELECT strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
               exchange_id,
               rzye, rzmre, rzche, rqye, rzrqye
        FROM read_parquet('{SRC}/margin/*.parquet', union_by_name=true)
        WHERE trade_date >= '{START_COMPACT}'
    """,
    # ---------------------------------------------------------------- 申万行业指数
    "core_sw_day": f"""
        CREATE OR REPLACE TABLE core_sw_day AS
        SELECT ts_code,
               strptime(trade_date, '%Y%m%d')::DATE AS trade_date,
               name, close, pct_change, vol, amount, pe, pb, float_mv, total_mv
        FROM read_parquet('{SRC}/sw_daily/*.parquet', union_by_name=true)
        WHERE trade_date >= '{START_COMPACT}'
    """,
}


def run(only: list[str] | None = None) -> dict:
    report: dict[str, dict] = {}
    with session() as con:
        for name, sql in DDL.items():
            if only and not any(o in name for o in only):
                continue
            t0 = time.time()
            print(f"[bootstrap] {name} ...", flush=True)
            con.execute(sql)
            rows = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
            sec = round(time.time() - t0, 1)
            report[name] = {"rows": int(rows), "sec": sec}
            print(f"[bootstrap] {name}: {rows:,} rows in {sec}s", flush=True)
        con.execute("CHECKPOINT")

    report["_meta"] = {
        "source": str(SOURCE_ROOT),
        "window_start": BOOTSTRAP_START,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "lake": str(settings.LAKE),
        "lake_mb": round(settings.LAKE.stat().st_size / 1e6, 1) if settings.LAKE.exists() else None,
    }
    out = settings.META / "bootstrap.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append", help="只构建指定表（可多次）")
    args = ap.parse_args()
    run(args.only)

