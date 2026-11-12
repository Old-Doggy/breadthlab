from pathlib import Path

from pipeline import alerts, settings

TMP = settings.DATA / "tmp_tests"


def _setup(monkeypatch):
    TMP.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "META", TMP)
    alerts.clear()


def test_alert_roundtrip(monkeypatch):
    _setup(monkeypatch)
    assert alerts.read() is None

    payload = alerts.write("marts", "boom")
    assert payload["stage"] == "marts"
    assert payload["message"] == "boom"

    got = alerts.read()
    assert got is not None and got["stage"] == "marts"

    alerts.clear()
    assert alerts.read() is None


def test_alert_truncates_long_message(monkeypatch):
    _setup(monkeypatch)
    alerts.write("update", "x" * 1000)
    assert len(alerts.read()["message"]) == 300
    alerts.clear()
