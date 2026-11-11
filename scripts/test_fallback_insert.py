"""在临时库上验证 akshare 备用源能正确写入 core 表（不碰主库）。"""
from __future__ import annotations

import sys
from pathlib import Path

import duckdb
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import settings  # noqa: E402
from pipeline.sources import akshare_fallback as fb  # noqa: E402
from pipeline.update_daily import insert  # noqa: E402


def main() -> None:
    tmp_path = settings.DATA / "tmp_fallback.duckdb"
    tmp_path.unlink(missing_ok=True)
    tmp = duckdb.connect(str(tmp_path))
    tmp.execute(f"ATTACH '{settings.LAKE}' AS l (READ_ONLY)")
    tmp.execute(
        "CREATE TABLE core_stock_day AS SELECT * FROM l.core_stock_day WHERE trade_date = '2026-11-10'"
    )
    tmp.execute("DETACH l")

    day = "20261111"
    daily = fb.daily(day)
    n1 = insert(tmp, "daily", daily, day)
    n2 = insert(tmp, "daily_basic", fb.daily_basic(day), day)
    n3 = insert(tmp, "stk_limit", fb.stk_limit(day), day)
    n4 = insert(tmp, "adj_factor", fb.adj_factor(tmp, day), day)

    row = tmp.execute(
        """
        SELECT count(*) n,
               count(*) FILTER (WHERE circ_mv IS NOT NULL) n_mv,
               count(*) FILTER (WHERE adj_factor IS NOT NULL) n_adj,
               count(*) FILTER (WHERE up_limit IS NOT NULL) n_lim,
               round(avg(pct_chg), 2) avg_ret,
               round(min(close), 2) min_close
        FROM core_stock_day WHERE trade_date = ?
        """,
        [date(2026, 11, 11)],
    ).fetchone()
    print({"inserted": {"daily": n1, "basic": n2, "limit": n3, "adj": n4}})
    print({"rows": row[0], "circ_mv": row[1], "adj": row[2], "up_limit": row[3], "avg_ret": row[4], "min_close": row[5]})
    tmp.close()
    tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
