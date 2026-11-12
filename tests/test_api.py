"""API 契约测试（Flask test client，不依赖网络）。"""
from __future__ import annotations

import pytest

from backend.main import app
from pipeline import settings

@pytest.fixture()
def client(db_client):
    return db_client


def test_meta(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    data = r.get_json()
    assert data["last_trade_date"] == "2026-06-11"
    assert data["n_stocks"] == 6


def test_market_series(client):
    r = client.get("/api/market/series")
    assert r.status_code == 200
    rows = r.get_json()
    assert len(rows) == 30
    assert "breadth" in rows[-1]


def test_market_day_detail(client):
    r = client.get("/api/market/day/2026-05-22")
    assert r.status_code == 200
    d = r.get_json()
    assert len(d["contributors"]) == 6
    assert len(d["sectors"]) == 3


def test_distribution(client):
    r = client.get("/api/distribution/2026-05-22")
    assert r.status_code == 200
    d = r.get_json()
    assert sum(b["n"] for b in d["bins"]) == 6
    assert d["stats"]["n"] == 6


def test_stocks(client):
    r = client.get("/api/stocks?date=2026-05-22&limit=50")
    assert r.status_code == 200
    rows = r.get_json()
    assert 0 < len(rows) <= 50
    assert "ret" in rows[0]


def test_sectors(client):
    r = client.get("/api/sectors?date=2026-05-22")
    assert r.status_code == 200
    assert len(r.get_json()) == 3


def test_watchlist_roundtrip(client):
    client.delete("/api/watchlist/000001.SZ")
    assert client.post("/api/watchlist", json={"ts_code": "000001.SZ"}).status_code == 200
    rows = client.get("/api/watchlist").get_json()
    assert any(r["ts_code"] == "000001.SZ" for r in rows)
    assert client.delete("/api/watchlist/000001.SZ").status_code == 200

def test_connection_released_after_request(monkeypatch, tmp_path):
    """请求结束后必须释放 DuckDB 锁，否则 17:35 的更新任务打不开库。"""
    import duckdb as dd

    import backend.main as m

    db = tmp_path / "tmp_lock_test.duckdb"
    db.unlink(missing_ok=True)
    dd.connect(str(db)).close()
    monkeypatch.setattr(m, "LAKE", db)

    with m.app.app_context():
        assert m.con() is m.con()
    # 上下文退出后连接应已关闭，此时可以拿到写连接
    dd.connect(str(db)).close()
    db.unlink(missing_ok=True)

def test_meta_includes_alert(client):
    """失败告警应透传到 /api/meta，成功更新后清除。"""
    import json

    p = settings.META / "alert.json"
    backup = p.read_text(encoding="utf-8") if p.exists() else None
    try:
        p.write_text(
            json.dumps({"time": "2026-11-11T16:50:00+08:00", "stage": "export", "message": "simulated"}),
            encoding="utf-8",
        )
        r = client.get("/api/meta")
        assert r.status_code == 200
        assert r.get_json()["alert"]["stage"] == "export"
    finally:
        if backup is None:
            p.unlink(missing_ok=True)
        else:
            p.write_text(backup, encoding="utf-8")
