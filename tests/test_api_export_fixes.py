"""Isolated API and static-export regression checks; no market services required."""
import json
from contextlib import contextmanager

import duckdb
import pytest

from backend import main as api
from pipeline import export_static


@pytest.fixture()
def local_client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "DB", tmp_path / "watch.sqlite")
    monkeypatch.setattr(api, "LAKE", tmp_path / "missing.duckdb")
    with api.app.test_client() as client:
        yield client


@pytest.mark.parametrize("payload", [
    {"shares": -1}, {"cost": "NaN"}, {"shares": "Infinity"},
    {"cost": []}, {"shares": True},
])
def test_watch_rejects_invalid_quantities(local_client, payload):
    response = local_client.post("/api/watchlist", json={"ts_code": "000001.SZ", **payload})
    assert response.status_code == 400


def test_watch_upsert_can_reset_positions_to_zero(local_client):
    assert local_client.post("/api/watchlist", json={"ts_code": "000001.SZ", "shares": 100, "cost": 10}).status_code == 200
    assert local_client.post("/api/watchlist", json={"ts_code": "000001.SZ", "shares": 0, "cost": 0}).status_code == 200
    import sqlite3
    with sqlite3.connect(api.DB) as con:
        assert con.execute("SELECT shares,cost FROM watchlist").fetchone() == (0, 0)


@pytest.mark.parametrize("base_url,origin", [
    ("http://malicious.example", None),
    ("http://localhost", "https://malicious.example"),
    ("http://localhost", "null"),
])
def test_mutations_reject_untrusted_host_and_origin(local_client, base_url, origin):
    headers = {"X-Ashare-Radar": "1"}
    if origin:
        headers["Origin"] = origin
    response = local_client.post("/api/update", base_url=base_url, headers=headers)
    assert response.status_code == 403


@pytest.mark.parametrize("url", [
    "/api/stocks?date=2026-02-30", "/api/stocks?limit=abc", "/api/stocks?limit=-1",
    "/api/market/day/not-a-date", "/api/distribution/2026-13-01",
    "/api/market/series?start=2026-02-01&end=2026-01-01",
    "/api/stock/invalid", "/api/market/series?freq=year",
])
def test_bad_arguments_are_400_not_database_busy(local_client, url):
    assert local_client.get(url).status_code == 400


def test_health_does_not_expose_exception_details(local_client, monkeypatch):
    def fail(*args, **kwargs):
        raise duckdb.CatalogException("private /internal/database.sql")
    monkeypatch.setattr(api, "one", fail)
    response = local_client.get("/api/health")
    assert response.status_code == 500
    assert "Secret" not in response.get_data(as_text=True)
    assert response.json == {"error": "internal server error"}


def test_lock_conflict_is_503_with_retry_header(local_client, monkeypatch):
    def fail(*args, **kwargs):
        raise duckdb.IOException("Could not set lock on file")
    monkeypatch.setattr(api, "one", fail)
    response = local_client.get("/api/health")
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "10"


def test_windows_file_open_lock_is_503_without_localized_message_dependency(local_client, monkeypatch):
    def fail(*args, **kwargs):
        raise duckdb.IOException('Cannot open file "private-path": localized message. File is already open in process')
    monkeypatch.setattr(api, "one", fail)
    response = local_client.get("/api/health")
    assert response.status_code == 503
    assert "private-path" not in response.get_data(as_text=True)


def test_update_uses_complete_publication_chain(monkeypatch):
    invocations = []
    def step(args, *rest):
        invocations.append(args)
        return 0, ""
    monkeypatch.setattr(api, "_run_step", step)
    monkeypatch.setattr(api, "_status_trade_date", lambda: "2026-11-11")
    api._run_update_job()
    assert invocations == [[api.sys.executable, "-m", "pipeline.release"]]
    assert api._job_snapshot()["state"] == "done"


def test_inline_json_cannot_close_the_script():
    original = {"name": '</ScRiPt><img src=x onerror=alert(1)>\u2028'}
    encoded = export_static._script_json(original)
    assert "<" not in encoded
    assert "\u2028" not in encoded
    assert json.loads(encoded) == original


def test_export_inlines_icons_css_javascript_and_fonts():
    html = ('<link rel="icon" href="/favicon.png">'
            '<link rel="stylesheet" href="/assets/style.css">'
            '<script type="module" src="/assets/app.js"></script>')
    assets = {"favicon.png": b"icon", "style.css": b'@font-face{src:url("/assets/font.woff2")}',
              "font.woff2": b"font", "app.js": b'console.log("ok")'}
    result = export_static._inline_assets(html, assets)
    assert "data:image/png;base64," in result
    assert "data:font/woff2;base64," in result
    assert "console.log" in result
    assert "/assets/" not in result


def test_vite_template_literal_icon_is_inlined():
    html = '<script type="module" src="/assets/app.js"></script>'
    assets = {"app.js": b'const image={src:`/favicon.png`}', "favicon.png": b"icon"}
    result = export_static._inline_assets(html, assets)
    assert "/favicon.png" not in result
    assert "data:image/png;base64," in result


def test_real_fontsource_woff_fallback_is_also_inlined():
    html = '<link rel="stylesheet" href="/assets/style.css">'
    assets = {"style.css": b'@font-face{src:url(/assets/font.woff2) format("woff2"),url(/assets/font.woff) format("woff")}',
              "font.woff2": b"font2", "font.woff": b"font1"}
    result = export_static._inline_assets(html, assets)
    assert "data:font/woff;base64," in result
    assert "/assets/" not in result


@pytest.mark.parametrize("html,assets", [
    ('<link rel="stylesheet" href="missing.css">', {}),
    ('<script type="module" src="missing.js"></script>', {}),
    ('<link rel="icon" href="/favicon.png">', {}),
    ('<link rel="stylesheet" href="style.css">', {"style.css": b"x{background:url(missing.png)}"}),
])
def test_export_rejects_missing_assets_instead_of_silently_dropping_them(html, assets):
    with pytest.raises(ValueError):
        export_static._inline_assets(html, assets)


@pytest.fixture()
def export_fixture(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "assets").mkdir()
    (dist / "index.html").write_text('<head></head><script type="module" src="/assets/app.js"></script>', encoding="utf-8")
    (dist / "assets" / "app.js").write_text('console.log("ok")', encoding="utf-8")
    out = dist / "ashare-radar.html"
    out.write_text("previous complete publication", encoding="utf-8")
    payload = {
        "meta": {"n_days": 1, "last_trade_date": "2026-11-11", "status": "ok"},
        "quality": {"passed": True, "date": "20261111"},
        "name": "</script><img src=x>",
    }
    class DummyConnection:
        def execute(self, sql):
            assert sql == "BEGIN TRANSACTION"
    @contextmanager
    def session(**kwargs):
        yield DummyConnection()
    monkeypatch.setattr(export_static, "session", session)
    monkeypatch.setattr(export_static, "DIST", dist)
    monkeypatch.setattr(export_static, "OUT", out)
    monkeypatch.setattr(export_static.settings, "DATA", tmp_path)
    monkeypatch.setattr(export_static, "build_payload", lambda con: payload)
    return out, payload


def test_failed_quality_does_not_replace_previous_publication(export_fixture):
    out, payload = export_fixture
    payload["quality"]["passed"] = False
    with pytest.raises(RuntimeError, match="quality"):
        export_static._export(False)
    assert out.read_text(encoding="utf-8") == "previous complete publication"


def test_missing_asset_does_not_replace_previous_publication(export_fixture):
    out, _ = export_fixture
    (out.parent / "assets" / "app.js").unlink()
    with pytest.raises(ValueError, match="missing"):
        export_static._export(False)
    assert out.read_text(encoding="utf-8") == "previous complete publication"


def test_complete_export_contains_safe_self_contained_payload(export_fixture):
    out, _ = export_fixture
    export_static._export(False)
    rendered = out.read_text(encoding="utf-8")
    assert "window.__BL_DATA__=" in rendered
    assert "\\u003c/script>" in rendered
    assert '<img src=x>' not in rendered
    assert "console.log" in rendered
