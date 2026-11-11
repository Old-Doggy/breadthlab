"""等锁逻辑测试：读连接释放后，写连接应能拿到锁。"""
from __future__ import annotations

import threading
import time

import duckdb

from pipeline import db, settings
from pathlib import Path
TMP = Path(__file__).resolve().parents[1] / "data" / "tmp_tests"


def test_connect_wait_blocks_then_succeeds(monkeypatch):
    TMP.mkdir(parents=True, exist_ok=True)
    lake = TMP / "lock.duckdb"
    duckdb.connect(str(lake)).close()
    monkeypatch.setattr(settings, "LAKE", lake)
    monkeypatch.setattr(db.settings, "LAKE", lake)

    reader = duckdb.connect(str(lake), read_only=True)

    def release():
        time.sleep(1.0)
        reader.close()

    t = threading.Thread(target=release)
    t.start()
    started = time.time()
    con = db.connect_wait(timeout_sec=10, interval=0.1)
    elapsed = time.time() - started
    con.close()
    t.join()
    assert elapsed >= 0.8, elapsed


def test_connect_wait_times_out(monkeypatch):
    import pytest

    TMP.mkdir(parents=True, exist_ok=True)
    lake = TMP / "lock2.duckdb"
    duckdb.connect(str(lake)).close()
    monkeypatch.setattr(settings, "LAKE", lake)
    monkeypatch.setattr(db.settings, "LAKE", lake)
    reader = duckdb.connect(str(lake), read_only=True)
    try:
        with pytest.raises(TimeoutError):
            db.connect_wait(timeout_sec=0.3, interval=0.1)
    finally:
        reader.close()
