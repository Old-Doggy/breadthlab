"""回填两融（交易所级）缺口。"""
from __future__ import annotations

import time
from datetime import date

import pandas as pd

from .db import session
from .update_daily import open_days, tushare_pro


def main() -> None:
    pro = tushare_pro()
    with session() as con:
        last = con.execute("SELECT max(trade_date) FROM core_margin_day").fetchall()[0][0]
        start = last.strftime("%Y%m%d")
        end = date.today().strftime("%Y%m%d")
        maxcal = con.execute("SELECT max(cal_date) FROM core_trade_cal").fetchall()[0][0]
        days = open_days(con, start, min(end, maxcal))
        print(f"[margin] last={last} pending={len(days)}")
        total = 0
        for day in days:
            try:
                df = pro.margin(trade_date=day)
            except Exception as e:
                print(f"[margin] {day} failed: {e}")
                continue
            if df is None or df.empty:
                continue
            df = df.copy()
            df["trade_date"] = pd.to_datetime(df["trade_date"].astype(str), format="%Y%m%d").dt.date
            con.register("tmp_m", df[["trade_date", "exchange_id", "rzye", "rzmre", "rzche", "rqye", "rzrqye"]])
            n = con.execute(
                """
                INSERT INTO core_margin_day
                SELECT trade_date, exchange_id, rzye, rzmre, rzche, rqye, rzrqye
                FROM tmp_m t
                WHERE NOT EXISTS (
                    SELECT 1 FROM core_margin_day c
                    WHERE c.trade_date = t.trade_date AND c.exchange_id = t.exchange_id
                )
                """
            ).fetchall()
            total += n[0][0] if n else 0
            con.unregister("tmp_m")
            time.sleep(0.3)
        con.execute("CHECKPOINT")
        print(f"[margin] inserted {total}")


if __name__ == "__main__":
    main()
