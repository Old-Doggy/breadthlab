"""刷新股票静态信息（新股 / 更名 / 退市），增量更新前后都可用。"""
from __future__ import annotations

import json

import pandas as pd

from . import settings
from .db import session
from .update_daily import tushare_pro

FIELDS = "ts_code,symbol,name,area,industry,market,exchange,list_status,list_date,delist_date,is_hs"
COLS = FIELDS.split(",")


def _repair_null_type(con) -> None:
    """快照里 delist_date 全为空，DuckDB 推断成 NULL 类型，重建为显式 VARCHAR。"""
    typ = con.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name='core_stock_meta' AND column_name='delist_date'"
    ).fetchall()
    if not typ or str(typ[0][0]).upper() != "NULL":
        return
    con.execute(
        """
        CREATE OR REPLACE TABLE core_stock_meta_new (
            ts_code VARCHAR, symbol VARCHAR, name VARCHAR, area VARCHAR, industry VARCHAR,
            market VARCHAR, exchange VARCHAR, list_status VARCHAR, list_date VARCHAR,
            delist_date VARCHAR, is_hs VARCHAR
        )
        """
    )
    con.execute(
        """
        INSERT INTO core_stock_meta_new
        SELECT ts_code, symbol, name, area, industry, market, exchange, list_status, list_date,
               CAST(NULL AS VARCHAR), is_hs
        FROM core_stock_meta
        """
    )
    con.execute("DROP TABLE core_stock_meta")
    con.execute("ALTER TABLE core_stock_meta_new RENAME TO core_stock_meta")


def run(pro=None) -> dict:
    pro = pro or tushare_pro()
    frames = []
    for status in ("L", "D", "P"):
        try:
            df = pro.stock_basic(exchange="", list_status=status, fields=FIELDS)
            if df is not None and not df.empty:
                frames.append(df[[c for c in COLS if c in df.columns]])
        except Exception as e:  # 权限/限频时跳过
            print(f"[meta] status={status} failed: {e}")
    if not frames:
        return {"inserted": 0, "total": 0}

    df = pd.concat(frames, ignore_index=True).drop_duplicates("ts_code")
    for c in COLS:
        if c not in df.columns:
            df[c] = None
        df[c] = df[c].astype("string")

    with session() as con:
        con.execute("DROP TABLE IF EXISTS core_stock_meta")
        con.execute(
            """
            CREATE TABLE core_stock_meta (
                ts_code VARCHAR, symbol VARCHAR, name VARCHAR, area VARCHAR, industry VARCHAR,
                market VARCHAR, exchange VARCHAR, list_status VARCHAR, list_date VARCHAR,
                delist_date VARCHAR, is_hs VARCHAR
            )
            """
        )
        con.register("tmp_meta", df[COLS])
        con.execute(
            """
            INSERT INTO core_stock_meta
            SELECT ts_code, symbol, name, area, industry, market, exchange, list_status, list_date, delist_date, is_hs
            FROM tmp_meta
            """
        )
        con.unregister("tmp_meta")
        total = con.execute("SELECT count(*) FROM core_stock_meta").fetchall()[0][0]
        con.execute("CHECKPOINT")

    out = {"inserted": int(total), "total": int(total)}
    (settings.META / "meta_refresh.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
