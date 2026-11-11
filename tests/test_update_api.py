from backend.main import app


def test_update_requires_custom_header():
    """跨站请求无法带自定义头，避免任意网页触发本地更新。"""
    with app.test_client() as c:
        r = c.post("/api/update")
    assert r.status_code == 403


def test_update_status_shape():
    with app.test_client() as c:
        r = c.get("/api/update/status")
    assert r.status_code == 200
    data = r.get_json()
    assert data["state"] in {"idle", "running", "done", "failed"}
    assert "progress" in data
