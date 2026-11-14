"""Publication failures must preserve complete data and honest status."""
from contextlib import contextmanager
import json
import os
import subprocess
import sys

import duckdb
import pandas as pd
import pytest

from pipeline import alerts, build_marts, export_static, refresh_status, release, settings, update_daily
from pipeline.locking import publish_lock


@pytest.mark.parametrize("failure", ["update", "quality", "export", None])
def test_release_clears_alert_only_after_complete_export(tmp_path, monkeypatch, failure):
    monkeypatch.setattr(settings, "DATA", tmp_path)
    monkeypatch.setattr(settings, "META", tmp_path / "meta")
    alerts.write("old", "previous failure")
    calls = []
    monkeypatch.setattr(update_daily, "run", lambda *a, **k: {"status": "failed" if failure == "update" else "ok"})
    monkeypatch.setattr(refresh_status, "main", lambda: {"status": "failed" if failure == "quality" else "ok"})
    monkeypatch.setattr(build_marts, "run", lambda: calls.append("marts"))

    def export(**kwargs):
        assert kwargs == {"clear_alert": True}
        assert alerts.read() is not None
        calls.append("export")
        if failure == "export":
            raise ValueError("synthetic missing asset")

    monkeypatch.setattr(export_static, "main", export)
    if failure:
        with pytest.raises((RuntimeError, ValueError)):
            release.run()
        assert alerts.read()["stage"] == failure
        assert json.loads((settings.META / "status.json").read_text())["status"] == "failed"
        assert calls == (["marts", "export"] if failure == "export" else [])
    else:
        assert release.run()["status"] == "ok"
        assert calls == ["marts", "export"]
        assert alerts.read() is None


def test_os_lock_reentrant_but_rejects_other_process(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA", tmp_path)
    child = "from pipeline.locking import publish_lock\nwith publish_lock(): print('acquired')"
    env = dict(os.environ, ASHARE_RADAR_DATA_DIR=str(tmp_path), ASHARE_RADAR_LOAD_ENV="0", TUSHARE_TOKEN="")
    with publish_lock(), publish_lock():
        blocked = subprocess.run([sys.executable, "-c", child], env=env, capture_output=True, text=True, timeout=15)
        assert blocked.returncode != 0
        assert "another update is already running" in blocked.stderr
    available = subprocess.run([sys.executable, "-c", child], env=env, capture_output=True, text=True, timeout=15)
    assert available.returncode == 0
    assert "acquired" in available.stdout


def test_mart_failure_rolls_back_earlier_table_replacements(mutable_lake, monkeypatch):
    @contextmanager
    def session(**kwargs):
        with duckdb.connect(str(mutable_lake)) as con:
            yield con

    with duckdb.connect(str(mutable_lake)) as con:
        before = con.execute("SELECT count(*) FROM mart_market_day").fetchone()[0]
    monkeypatch.setattr(build_marts, "session", session)
    monkeypatch.setattr(build_marts, "STEPS", [
        ("mart_market_day", "CREATE OR REPLACE TABLE mart_market_day AS SELECT 123 AS changed"),
        ("broken", "SELECT * FROM nonexistent_synthetic_table"),
    ])
    with pytest.raises(duckdb.Error):
        build_marts.run()
    with duckdb.connect(str(mutable_lake)) as con:
        assert con.execute("SELECT count(*) FROM mart_market_day").fetchone()[0] == before
        assert con.execute("SELECT ew_ret FROM mart_market_day LIMIT 1").fetchone()[0] is not None


def test_insert_rejects_duplicate_or_wrong_dates_and_corrects_existing_ohlc(mutable_lake, synthetic_lake):
    day = synthetic_lake.days[-1].strftime("%Y%m%d")
    frame = pd.DataFrame({"ts_code": [synthetic_lake.codes[0]], "trade_date": [day],
                          "open": [10.0], "high": [12.0], "low": [10.0], "close": [12.0],
                          "pre_close": [10.0], "pct_chg": [20.0], "vol": [100.0], "amount": [1000.0]})
    with duckdb.connect(str(mutable_lake)) as con:
        before = con.execute("SELECT count(*) FROM core_stock_day").fetchall()[0][0]
        with pytest.raises(ValueError, match="duplicate"):
            update_daily.insert(con, "daily", pd.concat([frame, frame]), day)
        with pytest.raises(ValueError, match="different trade date"):
            update_daily.insert(con, "daily", frame, "20260610")
        update_daily.insert(con, "daily", frame, day)
        update_daily.insert(con, "daily", frame, day)
        assert con.execute("SELECT count(*) FROM core_stock_day").fetchone()[0] == before
        assert con.execute("SELECT close FROM core_stock_day WHERE ts_code=? AND trade_date=?",
                           [synthetic_lake.codes[0], synthetic_lake.days[-1]]).fetchone()[0] == 12


def test_calendar_failed_replacement_preserves_original(mutable_lake):
    class Source:
        def trade_cal(self, **kwargs):
            return pd.DataFrame({"cal_date": ["bad-date"], "pretrade_date": ["20260610"], "is_open": [1]})
    with duckdb.connect(str(mutable_lake)) as con:
        before = con.execute("SELECT * FROM core_trade_cal ORDER BY cal_date").fetchall()
        with pytest.raises(duckdb.InvalidInputException, match="Could not parse"):
            update_daily.ensure_calendar(Source(), con, "20260611")
        assert con.execute("SELECT * FROM core_trade_cal ORDER BY cal_date").fetchall() == before


def test_independent_derived_audit_detects_missing_snapshot(mutable_lake, synthetic_lake):
    from scripts import audit_all
    audit_all.RESULTS.clear()
    with duckdb.connect(str(mutable_lake)) as con:
        audit_all.audit_integrity(con, synthetic_lake.latest)
        assert all(r["ok"] for r in audit_all.RESULTS)
        con.execute("DELETE FROM mart_stock_latest WHERE ts_code=?", [synthetic_lake.codes[0]])
        audit_all.RESULTS.clear()
        audit_all.audit_integrity(con, synthetic_lake.latest)
        assert any(not r["ok"] for r in audit_all.RESULTS)


def test_index_corrections_are_idempotent(mutable_lake, synthetic_lake, monkeypatch):
    day = synthetic_lake.days[-1].strftime("%Y%m%d")
    class Source:
        def index_daily(self, ts_code, **kwargs):
            return pd.DataFrame({"ts_code": [ts_code], "trade_date": [day], "open": [10.0],
                                 "high": [12.0], "low": [10.0], "close": [12.0], "pre_close": [10.0],
                                 "pct_chg": [20.0], "vol": [100.0], "amount": [1000.0]})
    monkeypatch.setattr(update_daily.time, "sleep", lambda *a: None)
    with duckdb.connect(str(mutable_lake)) as con:
        before = con.execute("SELECT count(*) FROM core_index_day").fetchall()[0][0]
        assert update_daily.update_indices(Source(), con, day, day) == 4
        assert update_daily.update_indices(Source(), con, day, day) == 4
        assert con.execute("SELECT count(*) FROM core_index_day").fetchall()[0][0] == before
        assert con.execute("SELECT count(*) FROM core_index_day WHERE trade_date=? AND close=12",
                           [synthetic_lake.days[-1]]).fetchall()[0][0] == 4


def test_fallback_inserts_verified_calendar_without_fetching_market(mutable_lake, synthetic_lake, monkeypatch):
    from pipeline.sources import akshare_fallback as fb
    next_day = "20260612"
    verified = [d.strftime("%Y%m%d") for d in synthetic_lake.days] + [next_day]
    monkeypatch.setattr(fb, "trading_days", lambda: verified)
    monkeypatch.setattr(update_daily, "DATASETS", [])
    monkeypatch.setattr(update_daily, "run_gates", lambda *a, **k: {
        "date": next_day, "passed": True, "blocking": [], "gates": []})
    result = update_daily.run(next_day, source="akshare")
    assert result["status"] == "ok"
    with duckdb.connect(str(mutable_lake)) as con:
        assert con.execute("SELECT pretrade_date FROM core_trade_cal WHERE cal_date=?",
                           [next_day]).fetchall() == [(verified[-2],)]


@pytest.mark.parametrize("stage", ["update", "quality", None])
def test_rebuild_cannot_erase_an_unresolved_fetch_failure(mutable_lake, monkeypatch, stage):
    monkeypatch.setattr(refresh_status, "main", lambda: {"status": "failed", "failure_stage": stage})
    monkeypatch.setattr(build_marts, "run", lambda: pytest.fail("must not rebuild after unresolved failure"))
    with pytest.raises(RuntimeError, match="publishing refused"):
        release.run(rebuild=True)


def test_empty_listed_metadata_preserves_existing_table(mutable_lake):
    from pipeline import bootstrap_api
    class Source:
        def stock_basic(self, **kwargs):
            return pd.DataFrame()
    with duckdb.connect(str(mutable_lake)) as con:
        before = con.execute("SELECT * FROM core_stock_meta ORDER BY ts_code").fetchall()
        with pytest.raises(RuntimeError, match="old metadata preserved"):
            bootstrap_api._load_meta(Source(), con)
        assert con.execute("SELECT * FROM core_stock_meta ORDER BY ts_code").fetchall() == before


def test_api_rejected_second_update_does_not_write_shared_alert(monkeypatch):
    from backend import main as api
    monkeypatch.setattr(api, "_run_step", lambda *a: (1, "another update is already running"))
    monkeypatch.setattr(alerts, "write", lambda *a: pytest.fail("active publisher owns shared alert"))
    api._run_update_job()
    assert api._job_snapshot()["state"] == "failed"


@pytest.mark.parametrize("missing", ["daily", "moneyflow"])
def test_api_bootstrap_required_failure_or_optional_provenance(mutable_lake, synthetic_lake, monkeypatch, missing):
    from pipeline import bootstrap_api as bootstrap
    target = synthetic_lake.days[-1].strftime("%Y%m%d")
    monkeypatch.setattr(bootstrap, "tushare_pro", lambda: object())
    monkeypatch.setattr(bootstrap, "_load_meta", lambda *a: 0)
    monkeypatch.setattr(bootstrap, "_load_calendar", lambda *a: [target])
    monkeypatch.setattr(bootstrap, "DATASETS", ["daily", "moneyflow"])
    monkeypatch.setattr(bootstrap, "update_indices", lambda *a: None)
    monkeypatch.setattr(bootstrap, "run_gates", lambda *a, **k: {
        "date": target, "passed": True, "blocking": [], "gates": []})
    monkeypatch.setattr(bootstrap.time, "sleep", lambda *a: None)
    frame = pd.DataFrame({"ts_code": [synthetic_lake.codes[0]], "trade_date": [target],
                          "open": [10.0], "high": [12.0], "low": [10.0], "close": [12.0],
                          "pre_close": [10.0], "pct_chg": [20.0], "vol": [100.0], "amount": [1000.0]})
    monkeypatch.setattr(bootstrap, "fetch", lambda pro, ds, day: pd.DataFrame() if ds == missing else frame)
    if missing == "daily":
        with pytest.raises(RuntimeError, match="required daily failed"):
            bootstrap.run(target, target)
        assert alerts.read()["stage"] == "bootstrap"
        assert json.loads((settings.META / "status.json").read_text())["status"] == "failed"
    else:
        assert bootstrap.run(target, target)["status"] == "ok"
        status = json.loads((settings.META / "status.json").read_text())
        assert status["sources"]["moneyflow"] == "unavailable"
        assert status["warnings"]
