"""API 契约测试（Flask test client，不依赖网络）。"""
from __future__ import annotations

import pytest

from backend.main import app
from pipeline import settings

pytestmark = pytest.mark.skipif(not settings.LAKE.exists(), reason="lake not built")


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c


def test_meta(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.get_json()
    assert data["last_trade_date"] == "2026-05-22"
    assert data["n_stocks"] > 4000


def test_market_series(client):
    r = client.get("/api/market/series")
    assert r.status_code == 200
    rows = r.get_json()
    assert len(rows) > 2000
    assert "breadth" in rows[-1]


def test_market_day_detail(client):
    r = client.get("/api/market/day/2026-05-22")
    assert r.status_code == 200
    d = r.get_json()
    assert len(d["contributors"]) > 10
    assert len(d["sectors"]) >= 28


def test_distribution(client):
    r = client.get("/api/distribution/2026-05-22")
    assert r.status_code == 200
    d = r.get_json()
    assert len(d["bins"]) > 30
    assert d["stats"]["n"] > 4000


def test_stocks(client):
    r = client.get("/api/stocks?date=2026-05-22&limit=50")
    assert r.status_code == 200
    rows = r.get_json()
    assert 0 < len(rows) <= 50
    assert "ret" in rows[0]


def test_sectors(client):
    r = client.get("/api/sectors?date=2026-05-22")
    assert r.status_code == 200
    assert len(r.get_json()) >= 28


def test_watchlist_roundtrip(client):
    client.delete("/api/watchlist/000001.SZ")
    assert client.post("/api/watchlist", json={"ts_code": "000001.SZ"}).status_code == 200
    rows = client.get("/api/watchlist").get_json()
    assert any(r["ts_code"] == "000001.SZ" for r in rows)
    assert client.delete("/api/watchlist/000001.SZ").status_code == 200
