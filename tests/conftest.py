"""Synthetic, network-free test data; never import production settings first."""
from __future__ import annotations

import atexit
from dataclasses import dataclass
from datetime import date, timedelta
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory

import pytest


_TEST_ROOT = TemporaryDirectory(prefix="ashare-radar-tests-")
atexit.register(_TEST_ROOT.cleanup)
os.environ["ASHARE_RADAR_DATA_DIR"] = _TEST_ROOT.name
os.environ["ASHARE_RADAR_LOAD_ENV"] = "0"
os.environ["TUSHARE_TOKEN"] = ""


def pytest_configure(config):
    if not config.option.basetemp:
        config.option.basetemp = str(Path(_TEST_ROOT.name) / "pytest")


@dataclass(frozen=True)
class SyntheticLake:
    path: Path
    days: tuple[date, ...]
    codes: tuple[str, ...]

    @property
    def latest(self) -> str:
        return self.days[-1].isoformat()


@pytest.fixture(scope="session")
def synthetic_lake(tmp_path_factory):
    """Six established stocks, three sectors and thirty synthetic trading days."""
    import duckdb

    from pipeline import build_marts
    from pipeline.bootstrap_api import _init
    from pipeline import settings

    root = tmp_path_factory.mktemp("synthetic-source")
    lake = root / "source.duckdb"
    days = []
    d = date(2026, 5, 1)
    while len(days) < 30:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    codes = ("000001.SZ", "600000.SH", "300001.SZ", "301001.SZ", "688001.SH", "600001.SH")
    industries = ("银行", "银行", "种植业", "种植业", "化工原料", "化工原料")
    returns = (1.0, -1.0, 0.0, 2.0, -2.0, 0.5)
    with duckdb.connect(str(lake)) as con:
        _init(con)
        con.executemany(
            "INSERT INTO core_trade_cal (cal_date, trade_date, pretrade_date, is_open) VALUES (?, ?, ?, 1)",
            [(d.strftime("%Y%m%d"), d, (days[i - 1] if i else d - timedelta(days=1)).strftime("%Y%m%d"))
             for i, d in enumerate(days)],
        )
        for i, code in enumerate(codes):
            con.execute(
                "INSERT INTO core_stock_meta (ts_code, symbol, name, industry, list_date, list_status) "
                "VALUES (?, ?, ?, ?, '20000101', 'L')",
                [code, code[:6], f"Synthetic {i}", industries[i]],
            )
            for d in days:
                close = 10 * (1 + returns[i] / 100)
                con.execute(
                    """INSERT INTO core_stock_day
                    (ts_code, trade_date, open, high, low, close, pre_close, pct_chg,
                     vol, amount, adj_factor, adj_close, turnover_rate, turnover_rate_f,
                     volume_ratio, pe_ttm, pb, total_mv, circ_mv, up_limit, down_limit)
                    VALUES (?, ?, 10, ?, ?, ?, 10, ?, 1000, 10000, 1, ?, 1, 2, 1, 20, 1,
                            200000, ?, 12, 8)""",
                    [code, d, max(10, close), min(10, close), close, returns[i], close, 100000 + i * 10000],
                )
        for d in days:
            for code in ("000300.SH", "000905.SH", "000852.SH", "000001.SH"):
                con.execute(
                    "INSERT INTO core_index_day "
                    "(ts_code, trade_date, open, high, low, close, pre_close, pct_chg, vol, amount) "
                    "VALUES (?, ?, 100, 101, 100, 101, 100, 1, 1000, 10000)",
                    [code, d],
                )
        bridge = (settings.ROOT / "config" / "industry_bridge.csv").as_posix()
        for _, sql in build_marts.STEPS:
            con.execute(sql.format(bridge=bridge) if "{bridge}" in sql else sql)
    return SyntheticLake(lake, tuple(days), codes)


@pytest.fixture()
def mutable_lake(synthetic_lake, tmp_path, monkeypatch):
    """A fresh copy per test, so SQL changes cannot leak into another test."""
    from pipeline import settings

    lake = tmp_path / "lake.duckdb"
    shutil.copyfile(synthetic_lake.path, lake)
    meta = tmp_path / "meta"
    meta.mkdir()
    monkeypatch.setattr(settings, "DATA", tmp_path)
    monkeypatch.setattr(settings, "LAKE", lake)
    monkeypatch.setattr(settings, "META", meta)
    return lake


@pytest.fixture()
def db_client(mutable_lake, tmp_path, monkeypatch):
    import backend.main as backend
    from pipeline import settings

    monkeypatch.setattr(backend, "LAKE", mutable_lake)
    monkeypatch.setattr(backend, "META", settings.META)
    monkeypatch.setattr(backend, "DB", tmp_path / "app.sqlite")
    backend.app.config.update(TESTING=True)
    with backend.app.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def block_external_network(monkeypatch):
    """A missed mock must fail locally rather than call a market-data endpoint."""
    import socket

    def denied(*args, **kwargs):
        raise AssertionError("External network access is forbidden in isolated tests")

    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(socket.socket, "connect", denied)


@pytest.fixture(autouse=True)
def fresh_update_job(monkeypatch):
    """Background-job assertions must not depend on another test's job state."""
    import backend.main as backend

    monkeypatch.setattr(backend, "_update_job", {
        "id": None, "state": "idle", "progress": 0, "stage": "", "message": "",
        "started_at": None, "finished_at": None, "trade_date": None,
    })
