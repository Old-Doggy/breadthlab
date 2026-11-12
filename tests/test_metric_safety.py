"""Regression cases for market samples, time alignment and nullable metrics."""
from __future__ import annotations

import duckdb
import pytest

from pipeline import build_marts
from pipeline.quality_gates import run_gates


def rebuild(con, *names):
    for name in names:
        con.execute(getattr(build_marts, name))


def test_market_previous_day_missing_weight_and_streak_break(mutable_lake, synthetic_lake):
    code = synthetic_lake.codes[0]
    before, missing, after = synthetic_lake.days[-3:]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("DELETE FROM core_stock_day WHERE ts_code=? AND trade_date=?", [code, missing])
        con.execute("UPDATE core_stock_day SET close=up_limit, adj_close=up_limit, pct_chg=20 "
                    "WHERE ts_code=? AND trade_date IN (?,?)", [code, before, after])
        rebuild(con, "SQL_FEAT")
        weight, streak = con.execute("SELECT prev_circ_mv,limit_streak FROM feat_stock "
                                     "WHERE ts_code=? AND trade_date=?", [code, after]).fetchone()
        assert weight is None
        assert streak == 1


def test_missing_limits_do_not_become_zero_limit_counts(mutable_lake, synthetic_lake):
    day = synthetic_lake.days[-1]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_day SET up_limit=NULL, down_limit=NULL WHERE trade_date=?", [day])
        rebuild(con, "SQL_FEAT", "SQL_MARKET")
        assert con.execute("SELECT limit_up_n,limit_down_n,max_streak,streak_n,first_board_n "
                           "FROM mart_market_day WHERE trade_date=?", [day]).fetchone() == (None,) * 5
        gate = run_gates(con, day.strftime("%Y%m%d"), persist=False)
        assert 11 in gate["blocking"]


def test_monthly_index_missing_day_is_not_assumed_flat(mutable_lake, synthetic_lake):
    with duckdb.connect(str(mutable_lake)) as con:
        day = synthetic_lake.days[-1]
        con.execute("DELETE FROM core_index_day WHERE ts_code='000300.SH' AND trade_date=?", [day])
        rebuild(con, "SQL_MARKET", "SQL_MONTH")
        assert con.execute("SELECT hs300_ret_cum FROM mart_market_month ORDER BY month DESC LIMIT 1").fetchone()[0] is None


def test_funds_use_the_same_stock_pool(mutable_lake, synthetic_lake):
    with duckdb.connect(str(mutable_lake)) as con:
        day = synthetic_lake.days[-1]
        con.execute("INSERT INTO core_flow_day VALUES (?,?,1,2,3),('920001.BJ',?,-100,-100,100)",
                    [synthetic_lake.codes[0], day, day])
        rebuild(con, "SQL_MARKET")
        breadth, amount = con.execute("SELECT flow_breadth,net_mf_amount FROM mart_market_day WHERE trade_date=?", [day]).fetchone()
        assert breadth == 1
        assert amount == 10000


def test_recent_listing_exclusion_is_independent_of_loaded_rows(mutable_lake, synthetic_lake):
    day = synthetic_lake.days[-1]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_meta SET list_date=? WHERE ts_code=?",
                    [synthetic_lake.days[-4].strftime("%Y%m%d"), synthetic_lake.codes[0]])
        rebuild(con, "SQL_FEAT")
        assert con.execute("SELECT is_new_stock FROM feat_stock WHERE ts_code=? AND trade_date=?",
                           [synthetic_lake.codes[0], day]).fetchone()[0] is True
        # An established stock with just one loaded observation remains eligible.
        code = synthetic_lake.codes[1]
        con.execute("DELETE FROM core_stock_day WHERE ts_code=? AND trade_date<>?", [code, day])
        rebuild(con, "SQL_FEAT")
        assert con.execute("SELECT is_new_stock FROM feat_stock WHERE ts_code=?", [code]).fetchone()[0] is False


@pytest.mark.parametrize("column,value", [("close", "NULL"), ("adj_factor", "0"), ("pct_chg", "'nan'::DOUBLE")])
def test_invalid_values_cannot_enter_market_sample(mutable_lake, synthetic_lake, column, value):
    with duckdb.connect(str(mutable_lake)) as con:
        day = synthetic_lake.days[-1]
        con.execute(f"UPDATE core_stock_day SET {column}={value} WHERE ts_code=? AND trade_date=?",
                    [synthetic_lake.codes[0], day])
        rebuild(con, "SQL_FEAT", "SQL_MARKET")
        assert con.execute("SELECT n_valid FROM mart_market_day WHERE trade_date=?", [day]).fetchone()[0] == 5


def test_ipo_extreme_return_exemption_uses_list_date(mutable_lake, synthetic_lake):
    day = synthetic_lake.days[-1]
    code = synthetic_lake.codes[0]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_meta SET list_date=? WHERE ts_code=?", [day.strftime("%Y%m%d"), code])
        con.execute("UPDATE core_stock_day SET close=20,high=20,low=10,adj_close=20,pct_chg=100 "
                    "WHERE ts_code=? AND trade_date=?", [code, day])
        result = run_gates(con, day.strftime("%Y%m%d"), persist=False)
        price_gate = next(g for g in result["gates"] if g["id"] == 3)
        assert price_gate["pass"]
        con.execute("UPDATE core_stock_meta SET list_date='20000101' WHERE ts_code=?", [code])
        result = run_gates(con, day.strftime("%Y%m%d"), persist=False)
        assert not next(g for g in result["gates"] if g["id"] == 3)["pass"]


def test_exchange_unlimited_price_sentinel_allows_delisting_extreme(mutable_lake, synthetic_lake):
    day = synthetic_lake.days[-1]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_day SET close=0.31,high=0.38,low=0.30,pre_close=0.77,"
                    "pct_chg=-59.7403,up_limit=999999.999,down_limit=0.01 WHERE ts_code=? AND trade_date=?",
                    [synthetic_lake.codes[0], day])
        result = run_gates(con, day.strftime("%Y%m%d"), persist=False)
        assert next(g for g in result["gates"] if g["id"] == 3)["pass"]
        con.execute("UPDATE core_stock_day SET up_limit=0.85,down_limit=0.69 WHERE ts_code=? AND trade_date=?",
                    [synthetic_lake.codes[0], day])
        result = run_gates(con, day.strftime("%Y%m%d"), persist=False)
        assert not next(g for g in result["gates"] if g["id"] == 3)["pass"]
