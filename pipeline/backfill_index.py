"""用 akshare 补齐指数日线缺口（本地快照 index_daily 只到 2026-05-08）。

只补缺口，不覆盖已有行；写入 core_index_day 后需重跑 mart。
"""
from __future__ import annotations

import time
from datetime import date

import akshare as ak
import pandas as pd

from .db import session

INDICES = {
    "000300": "000300.SH",
    "000905": "000905.SH",
    "000852": "000852.SH",
    "000001": "000001.SH",
}


def fetch(symbol: str, start: str, end: str) -> pd.DataFrame:
    df = ak.index_zh_a_hist(symbol=symbol, period="daily", start_date=start, end_date=end)
    if df is None or df.empty:
        return pd.DataFrame()
    out = pd.DataFrame(
        {
            "trade_date": pd.to_datetime(df["日期"]).dt.date,
            "open": df["开盘"].astype(float),
            "high": df["最高"].astype(float),
            "low": df["最低"].astype(float),
            "close": df["收盘"].astype(float),
            "pre_close": df["收盘"].astype(float) - df["涨跌额"].astype(float),
            "pct_chg": df["涨跌幅"].astype(float),
            "vol": df["成交量"].astype(float),
            "amount": df["成交额"].astype(float) / 1000.0,  # 元 -> 千元（与 Tushare 一致）
        }
    )
    return out


def main() -> None:
    with session() as con:
        last = con.execute("SELECT max(trade_date) FROM core_index_day").fetchall()[0][0]
        print(f"[index] local last = {last}")
        start = last.strftime("%Y%m%d")
        end = date.today().strftime("%Y%m%d")
        total = 0
        for symbol, ts_code in INDICES.items():
            df = fetch(symbol, start, end)
            if df.empty:
                print(f"[index] {ts_code}: no data")
                continue
            df["ts_code"] = ts_code
            con.register("tmp_idx", df)
            n = con.execute(
                """
                INSERT INTO core_index_day
                SELECT ts_code, trade_date, open, high, low, close, pre_close, pct_chg, vol, amount
                FROM tmp_idx t
                WHERE NOT EXISTS (
                    SELECT 1 FROM core_index_day c
                    WHERE c.ts_code = t.ts_code AND c.trade_date = t.trade_date
                )
                """
            ).fetchall()
            total += (n[0][0] if n else 0)
            print(f"[index] {ts_code}: +{(n[0][0] if n else 0)} rows")
            con.unregister("tmp_idx")
            time.sleep(0.3)
        con.execute("CHECKPOINT")
        print(f"[index] inserted {total} rows")


if __name__ == "__main__":
    main()
