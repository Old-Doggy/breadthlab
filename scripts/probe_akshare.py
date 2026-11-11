"""备用源探测：验证 akshare 快照与 Tushare 前一交易日收盘价是否一致。"""
from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline.sources import akshare_fallback as fb  # noqa: E402


def main() -> None:
    con = duckdb.connect(str(ROOT / "data" / "lake.duckdb"), read_only=True)
    last = con.execute("SELECT max(trade_date) FROM core_stock_day").fetchall()[0][0]
    print("lake last:", last)

    s = fb.snapshot()
    print("snapshot rows:", len(s))

    snap = pd.DataFrame({"ts_code": s["ts_code"], "pre_close": pd.to_numeric(s["昨收"], errors="coerce")})
    ref = con.execute(
        "SELECT ts_code, close FROM core_stock_day WHERE trade_date = ?", [last]
    ).fetchdf()
    m = snap.merge(ref, on="ts_code", how="inner")
    m["diff"] = (m.pre_close - m.close).abs()
    ok = (m["diff"] < 0.011).mean()
    print(f"matched {len(m)} codes; within 0.01: {ok:.2%}; MAE: {m['diff'].mean():.4f}")
    bad = m[m["diff"] > 0.011].sort_values("diff", ascending=False).head(5)
    if len(bad):
        print(bad.to_string(index=False))
    con.close()


if __name__ == "__main__":
    main()
