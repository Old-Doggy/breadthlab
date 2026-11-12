"""Release regressions use only synthetic data and mocked external boundaries."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date
import json
from statistics import stdev

import duckdb
import pandas as pd
import pytest


def test_market_numbers_match_independent_six_stock_example(mutable_lake, synthetic_lake):
    """A small example catches plausible-but-wrong denominators and units."""
    with duckdb.connect(str(mutable_lake)) as con:
        row = con.execute(
            "SELECT n_valid,n_adv,n_dec,n_flat,breadth,ew_ret,cw_ret,hhi,amount,csd,q10,q90,iqr "
            "FROM mart_market_day WHERE trade_date=?", [synthetic_lake.days[-1]],
        ).fetchone()
    assert row[:4] == (6, 3, 2, 1)
    returns = [0.01, -0.01, 0.0, 0.02, -0.02, 0.005]
    assert row[4] == pytest.approx(3 / 5)
    assert row[5] == pytest.approx(sum(returns) / 6)
    assert row[6] == pytest.approx(0.0006)
    assert row[7] == pytest.approx(95500 / 750 ** 2 * 10000)
    assert row[8] == 60_000_000
    assert row[9] == pytest.approx(stdev(returns))
    assert row[10:] == pytest.approx((-0.015, 0.015, 0.01625))


def test_cw_uses_previous_day_cap_not_current_cap(mutable_lake, synthetic_lake):
    from pipeline import build_marts

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_day SET circ_mv=1e12 WHERE ts_code=? AND trade_date=?",
                    [synthetic_lake.codes[0], synthetic_lake.days[-1]])
        con.execute(build_marts.SQL_FEAT)
        con.execute(build_marts.SQL_MARKET)
        value = con.execute("SELECT cw_ret FROM mart_market_day WHERE trade_date=?",
                            [synthetic_lake.days[-1]]).fetchone()[0]
    assert value == pytest.approx(0.0006)


def test_missing_cap_exits_cw_but_remains_in_equal_weight(mutable_lake, synthetic_lake):
    from pipeline import build_marts

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_day SET circ_mv=NULL WHERE ts_code=? AND trade_date=?",
                    [synthetic_lake.codes[0], synthetic_lake.days[-2]])
        con.execute(build_marts.SQL_FEAT)
        con.execute(build_marts.SQL_MARKET)
        n, ew, cw = con.execute("SELECT n_valid,ew_ret,cw_ret FROM mart_market_day WHERE trade_date=?",
                                [synthetic_lake.days[-1]]).fetchone()
    assert n == 6
    assert ew == pytest.approx(0.005 / 6)
    assert cw == pytest.approx((-110 * 0.01 + 130 * 0.02 - 140 * 0.02 + 150 * 0.005) / 650)


def test_zero_total_move_gives_null_concentration_share(mutable_lake, synthetic_lake):
    from pipeline import build_marts

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_day SET pct_chg=0 WHERE trade_date=?", [synthetic_lake.days[-1]])
        con.execute(build_marts.SQL_FEAT)
        con.execute(build_marts.SQL_MARKET)
        breadth, share = con.execute("SELECT breadth,top10_share FROM mart_market_day WHERE trade_date=?",
                                     [synthetic_lake.days[-1]]).fetchone()
    assert breadth is None
    assert share is None


def test_301_and_301_st_use_twenty_percent_limit():
    from pipeline.sources.akshare_fallback import _rate

    assert _rate("301001.SZ", "Synthetic") == 0.20
    assert _rate("301001.SZ", "ST Synthetic") == 0.20


def test_fallback_does_not_call_dynamic_pe_ttm(monkeypatch):
    from pipeline.sources import akshare_fallback as fb

    monkeypatch.setattr(fb, "_guard", lambda day: None)
    monkeypatch.setattr(fb, "snapshot", lambda: pd.DataFrame({
        "ts_code": ["301001.SZ"], "换手率": [3.0], "量比": [1.1],
        "市盈率-动态": [99.0], "市净率": [2.0], "总市值": [2e9], "流通市值": [1e9],
    }))
    row = fb.daily_basic("20260522").iloc[0]
    assert pd.isna(row.pe_ttm)
    assert pd.isna(row.turnover_rate_f)
    assert row.circ_mv == 100000


def test_established_stock_is_not_new_at_history_start(mutable_lake, synthetic_lake):
    with duckdb.connect(str(mutable_lake)) as con:
        n, fresh = con.execute(
            "SELECT count(*), count(*) FILTER (WHERE is_new_stock) FROM feat_stock WHERE trade_date = ?",
            [synthetic_lake.days[0]],
        ).fetchone()
    assert n == len(synthetic_lake.codes)
    assert fresh == 0


@pytest.mark.parametrize("column,value", [("close", 0), ("adj_factor", 0), ("adj_factor", None)])
def test_invalid_prices_cannot_enter_feat(mutable_lake, synthetic_lake, column, value):
    from pipeline import build_marts, settings

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute(f"UPDATE core_stock_day SET {column} = ? WHERE ts_code = ? AND trade_date = ?",
                    [value, synthetic_lake.codes[0], synthetic_lake.days[-1]])
        con.execute(build_marts.SQL_VIEW.format(bridge=(settings.ROOT / "config/industry_bridge.csv").as_posix()))
        con.execute(build_marts.SQL_FEAT)
        n = con.execute("SELECT count(*) FROM feat_stock WHERE ts_code = ? AND trade_date = ?",
                        [synthetic_lake.codes[0], synthetic_lake.days[-1]]).fetchone()[0]
    assert n == 0


@pytest.mark.parametrize("column,value,gate_id", [
    ("close", None, 3), ("amount", -1, 10), ("up_limit", None, 11),
])
def test_quality_blocks_missing_price_negative_amount_or_missing_limits(
    mutable_lake, synthetic_lake, column, value, gate_id,
):
    from pipeline.quality_gates import run_gates

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute(f"UPDATE core_stock_day SET {column}=? WHERE trade_date=?",
                    [value, synthetic_lake.days[-1]])
        report = run_gates(con, synthetic_lake.days[-1].strftime("%Y%m%d"),
                           synthetic_lake.days[-2].strftime("%Y%m%d"), persist=False)
    assert gate_id in report["blocking"]


def test_ipo_second_day_extreme_return_is_not_treated_as_old_stock(mutable_lake, synthetic_lake):
    from pipeline.quality_gates import run_gates

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE core_stock_meta SET list_date=? WHERE ts_code=?",
                    [synthetic_lake.days[-2].strftime("%Y%m%d"), synthetic_lake.codes[0]])
        con.execute("UPDATE core_stock_day SET pct_chg=60,close=16,high=16,adj_close=16 "
                    "WHERE ts_code=? AND trade_date=?", [synthetic_lake.codes[0], synthetic_lake.days[-1]])
        report = run_gates(con, synthetic_lake.days[-1].strftime("%Y%m%d"),
                           synthetic_lake.days[-2].strftime("%Y%m%d"), persist=False)
    price = next(gate for gate in report["gates"] if gate["id"] == 3)
    assert price["pass"]


def test_missing_market_day_breaks_price_streak(mutable_lake, synthetic_lake):
    from pipeline import build_marts

    code = synthetic_lake.codes[0]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("DELETE FROM core_stock_day WHERE ts_code = ? AND trade_date = ?",
                    [code, synthetic_lake.days[-2]])
        for d in (synthetic_lake.days[-3], synthetic_lake.days[-1]):
            con.execute("UPDATE core_stock_day SET close=11, adj_close=11, pct_chg=10, up_limit=11 "
                        "WHERE ts_code=? AND trade_date=?", [code, d])
        con.execute(build_marts.SQL_FEAT)
        streak = con.execute("SELECT limit_streak FROM feat_stock WHERE ts_code=? AND trade_date=?",
                             [code, synthetic_lake.days[-1]]).fetchone()[0]
    assert streak == 1


def test_missing_index_day_does_not_become_zero_monthly_return(mutable_lake, synthetic_lake):
    from pipeline import build_marts

    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE mart_market_day SET hs300_ret=NULL WHERE trade_date=?", [synthetic_lake.days[3]])
        con.execute(build_marts.SQL_MONTH)
        value = con.execute("SELECT hs300_ret_cum FROM mart_market_month WHERE month='2026-05-01'").fetchone()[0]
    assert value is None


def test_api_stock_returns_real_ohlcv(db_client, synthetic_lake):
    response = db_client.get(f"/api/stock/{synthetic_lake.codes[0]}")
    assert response.status_code == 200
    bar = response.get_json()[-1]
    assert {"open", "high", "low", "close", "vol"} <= bar.keys()
    assert [bar[k] for k in ("open", "high", "low", "close", "vol")] == [10, 10.1, 10, 10.1, 1000]


@pytest.mark.parametrize("latest_pe", [-5.0, None])
def test_invalid_current_pe_does_not_reuse_last_positive_pe(db_client, mutable_lake, synthetic_lake, latest_pe):
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("UPDATE feat_stock SET pe_ttm=? WHERE ts_code=? AND trade_date=?",
                    [latest_pe, synthetic_lake.codes[0], synthetic_lake.days[-1]])
    response = db_client.get(f"/api/valuation/{synthetic_lake.codes[0]}")
    assert response.status_code == 200
    data = response.get_json()
    assert not data or data.get("pct") is None


@pytest.mark.parametrize("query", ["date=not-a-date", "date=2026-05-22&limit=no", "date=2026-05-22&limit=-1"])
def test_invalid_stock_query_is_400(db_client, query):
    assert db_client.get(f"/api/stocks?{query}").status_code == 400


def test_health_hides_internal_database_error(db_client, monkeypatch):
    import backend.main as backend

    def broken(*args, **kwargs):
        raise duckdb.CatalogException("secret-path/internal-table-name")

    monkeypatch.setattr(backend, "one", broken)
    response = db_client.get("/api/health")
    assert response.status_code == 500
    assert "secret-path" not in response.get_data(as_text=True)
    assert "internal-table-name" not in response.get_data(as_text=True)


def test_missing_quote_position_remains_visible(db_client, mutable_lake, synthetic_lake):
    from pipeline import build_marts

    code = synthetic_lake.codes[0]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("DELETE FROM feat_stock WHERE ts_code=? AND trade_date=?", [code, synthetic_lake.days[-1]])
        con.execute(build_marts.SQL_LATEST)
    assert db_client.post("/api/watchlist", json={"ts_code": code, "shares": 100, "cost": 10}).status_code == 200
    rows = db_client.get("/api/watchlist").get_json()
    assert len(rows) == 1
    assert rows[0]["ts_code"] == code
    assert rows[0]["shares"] == 100
    assert rows[0]["quote_date"] == synthetic_lake.days[-2].isoformat()
    assert rows[0]["trade_date"] == synthetic_lake.latest
    assert rows[0]["is_suspended"] is None
    assert rows[0]["is_stale"] is True
    assert rows[0]["ret"] == 0


@pytest.mark.parametrize("shares,cost", [(-1, 10), (1, -10), ("Infinity", 10), ("NaN", 10)])
def test_invalid_position_values_are_rejected(db_client, shares, cost):
    response = db_client.post("/api/watchlist", json={"ts_code": "000001.SZ", "shares": shares, "cost": cost})
    assert response.status_code == 400


def test_failed_daily_gate_rolls_back_and_retries_same_date(mutable_lake, synthetic_lake, monkeypatch):
    from pipeline import settings, update_daily as update
    from pipeline import bootstrap_api

    target = date(2026, 6, 15)
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("INSERT INTO core_trade_cal (cal_date,trade_date,pretrade_date,is_open) "
                    "VALUES ('20260615','2026-06-15',?,1)", [synthetic_lake.days[-1].strftime("%Y%m%d")])

    @contextmanager
    def local_session(**kwargs):
        con = duckdb.connect(str(mutable_lake), read_only=kwargs.get("read_only", False))
        try:
            yield con
        finally:
            con.close()

    calls = []

    def fetch(pro, ds, day):
        calls.append((ds, day))
        return pd.DataFrame({"ts_code": ["000001.SZ"], "trade_date": [day], "open": [10],
                             "high": [11], "low": [10], "close": [11], "pre_close": [10],
                             "pct_chg": [10], "vol": [100], "amount": [1000]})

    passed = False

    def gates(*args, **kwargs):
        result = {"date": args[1], "passed": passed, "blocking": [] if passed else [5], "gates": [], "rows": 1}
        (settings.META / "quality").mkdir(exist_ok=True)
        (settings.META / "quality/latest.json").write_text(json.dumps(result), encoding="utf-8")
        return result

    monkeypatch.setattr(update, "session", local_session)
    monkeypatch.setattr(update, "tushare_pro", lambda: object())
    monkeypatch.setattr(update, "ensure_calendar", lambda *args: None)
    monkeypatch.setattr(update, "open_days", lambda *args: ["20260615"])
    monkeypatch.setattr(bootstrap_api, "_load_meta", lambda *args: 0)
    monkeypatch.setattr(update, "update_indices", lambda *args: 0)
    monkeypatch.setattr(update, "DATASETS", ["daily"])
    monkeypatch.setattr(update, "fetch", fetch)
    monkeypatch.setattr(update, "run_gates", gates)
    monkeypatch.setattr(update.time, "sleep", lambda seconds: None)
    result = update.run(target.strftime("%Y%m%d"), source="tushare")
    assert result["status"] == "failed"
    with duckdb.connect(str(mutable_lake)) as con:
        assert con.execute("SELECT count(*) FROM core_stock_day WHERE trade_date=?", [target]).fetchone()[0] == 0
    passed = True
    result = update.run(target.strftime("%Y%m%d"), source="tushare")
    assert result["status"] == "ok"
    assert calls.count(("daily", "20260615")) == 2


def test_export_payload_cannot_close_inline_script(tmp_path, monkeypatch):
    from pipeline import export_static as export, settings

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "assets").mkdir()
    (dist / "index.html").write_text("<!doctype html><html><head></head><body></body></html>", encoding="utf-8")
    payload = {
        "meta": {"status": "ok", "n_days": 1, "last_trade_date": "2026-05-22"},
        "quality": {"date": "20260522", "passed": True},
        "name": "</script><script>alert('fixture')</script>",
    }

    class DummyConnection:
        def execute(self, *args, **kwargs):
            return self

    @contextmanager
    def no_database(**kwargs):
        yield DummyConnection()

    monkeypatch.setattr(settings, "DATA", tmp_path)
    monkeypatch.setattr(export, "DIST", dist)
    monkeypatch.setattr(export, "OUT", dist / "BreadthLab.html")
    monkeypatch.setattr(export, "session", no_database)
    monkeypatch.setattr(export, "build_payload", lambda con: payload)
    export.main()
    html = (dist / "BreadthLab.html").read_text(encoding="utf-8")
    assert "</script><script>alert" not in html
    assert "window.__BL_DATA__=" in html


def test_export_missing_asset_preserves_previous_html(tmp_path, monkeypatch):
    from pipeline import export_static as export, settings

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "assets").mkdir()
    (dist / "index.html").write_text(
        '<html><head></head><body><script type="module" src="/assets/missing.js"></script></body></html>',
        encoding="utf-8",
    )
    out = dist / "BreadthLab.html"
    out.write_text("previous-complete-export", encoding="utf-8")

    class DummyConnection:
        def execute(self, *args, **kwargs):
            return self

    @contextmanager
    def no_database(**kwargs):
        yield DummyConnection()

    monkeypatch.setattr(settings, "DATA", tmp_path)
    monkeypatch.setattr(export, "DIST", dist)
    monkeypatch.setattr(export, "OUT", out)
    monkeypatch.setattr(export, "session", no_database)
    monkeypatch.setattr(export, "build_payload", lambda con: {
        "meta": {"status": "ok", "n_days": 1, "last_trade_date": "2026-05-22"},
        "quality": {"date": "20260522", "passed": True},
    })
    with pytest.raises((FileNotFoundError, RuntimeError, ValueError)):
        export.main()
    assert out.read_text(encoding="utf-8") == "previous-complete-export"
