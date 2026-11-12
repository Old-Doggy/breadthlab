import duckdb
import pytest

from pipeline import repair_history, settings


def test_partial_day_with_existing_rows_is_detected(mutable_lake, synthetic_lake):
    day = synthetic_lake.days[12]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("DELETE FROM core_stock_day WHERE trade_date=? AND ts_code<>?", [day, synthetic_lake.codes[0]])
        plan = repair_history.incomplete_dates(con)
    assert plan == [{"date": day.strftime("%Y%m%d"), "rows": 1, "typical_rows": 6.0}]


def test_repair_refuses_production_directory(monkeypatch):
    monkeypatch.setattr(settings, "DATA", settings.ROOT / "data")
    with pytest.raises(RuntimeError, match="isolated"):
        repair_history.require_copy()


def test_required_fetch_failure_preserves_existing_date(mutable_lake, synthetic_lake, monkeypatch):
    day = synthetic_lake.days[12]
    with duckdb.connect(str(mutable_lake)) as con:
        con.execute("DELETE FROM core_stock_day WHERE trade_date=? AND ts_code<>?", [day, synthetic_lake.codes[0]])
        before = con.execute("SELECT * FROM core_stock_day WHERE trade_date=?", [day]).fetchall()
    monkeypatch.setattr(repair_history, "tushare_pro", lambda: object())
    def denied(*args):
        raise ValueError("synthetic upstream credential=must-not-appear")
    monkeypatch.setattr(repair_history, "fetch", denied)
    with pytest.raises(RuntimeError, match="history repair failed"):
        repair_history.run(apply=True)
    assert "must-not-appear" not in (settings.META / "history_repair.json").read_text()
    with duckdb.connect(str(mutable_lake)) as con:
        assert con.execute("SELECT * FROM core_stock_day WHERE trade_date=?", [day]).fetchall() == before


def test_credentials_are_passed_in_memory_without_persistence(monkeypatch):
    import tushare
    from pipeline.update_daily import tushare_pro
    monkeypatch.setattr(settings, "TUSHARE_TOKEN", "synthetic-not-a-private-token")
    monkeypatch.setattr(tushare, "set_token", lambda *a: pytest.fail("must not persist credentials"))
    monkeypatch.setattr(tushare, "pro_api", lambda token, timeout: (token, timeout))
    assert tushare_pro() == ("synthetic-not-a-private-token", 25)
