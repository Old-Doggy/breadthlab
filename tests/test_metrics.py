"""指标口径的不变量与 golden values。"""
from __future__ import annotations

import duckdb
import pytest

@pytest.fixture(scope="session")
def con(synthetic_lake):
    c = duckdb.connect(str(synthetic_lake.path), read_only=True)
    yield c
    c.close()


def test_market_rows(con):
    n = con.execute("SELECT count(*) FROM mart_market_day").fetchone()[0]
    assert n == 30


def test_breadth_bounds(con):
    bad = con.execute(
        "SELECT count(*) FROM mart_market_day WHERE breadth < 0 OR breadth > 1 OR breadth IS NULL"
    ).fetchone()[0]
    assert bad == 0


def test_top10_share_bounds(con):
    bad = con.execute(
        "SELECT count(*) FROM mart_market_day WHERE top10_share < 0 OR top10_share > 1"
    ).fetchone()[0]
    assert bad == 0


def test_hhi_positive(con):
    bad = con.execute("SELECT count(*) FROM mart_market_day WHERE hhi <= 0").fetchone()[0]
    assert bad == 0


def test_ew_ret_sane(con):
    bad = con.execute(
        "SELECT count(*) FROM mart_market_day WHERE abs(ew_ret) > 0.12"
    ).fetchone()[0]
    assert bad == 0


def test_latest_snapshot(con):
    row = con.execute(
        "SELECT trade_date, n_valid, breadth, ew_ret FROM mart_market_day ORDER BY trade_date DESC LIMIT 1"
    ).fetchone()
    assert str(row[0]) == "2026-06-11"
    assert row[1] == 6
    assert row[2] == pytest.approx(3 / 5)
    assert row[3] == pytest.approx(0.005 / 6)


def test_sector_coverage(con):
    latest = con.execute("SELECT max(trade_date) FROM mart_sector_day").fetchone()[0]
    n_sectors, n_stocks = con.execute(
        """
        SELECT count(DISTINCT sw_l1), sum(n) FROM mart_sector_day WHERE trade_date = ?
        """,
        [latest],
    ).fetchone()
    assert n_sectors == 3
    market_n = con.execute(
        "SELECT n_valid FROM mart_market_day WHERE trade_date = ?", [latest]
    ).fetchone()[0]
    # 行业覆盖应接近市场样本（允许未分类/停牌差异 2%）
    assert abs(n_stocks - market_n) / market_n < 0.02


def test_limit_counts_consistent(con):
    bad = con.execute(
        "SELECT count(*) FROM mart_market_day WHERE limit_up_n < 0 OR limit_down_n < 0"
    ).fetchone()[0]
    assert bad == 0
