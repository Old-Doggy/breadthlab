"""DuckDB 连接与通用工具。"""
from __future__ import annotations

import os
import time
from contextlib import contextmanager

import duckdb

from . import settings

_LOCK_HINTS = (
    "being used",
    "Cannot open file",
    "Could not set lock",
    "Conflicting lock",
    "different configuration",
    "File is already open in",
)


def _default_timeout() -> float:
    try:
        return float(os.getenv("ASHARE_RADAR_LOCK_TIMEOUT", "300"))
    except ValueError:
        return 300.0


def connect(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(settings.LAKE), read_only=read_only)
    try:
        con.execute("SET threads=4")
        con.execute("SET memory_limit='4GB'")
        con.execute("SET preserve_insertion_order=false")
        directory = (settings.DATA / "tmp").as_posix().replace("'", "''")
        con.execute(f"SET temp_directory='{directory}'")
    except BaseException:
        con.close()
        raise
    return con


def connect_wait(
    read_only: bool = False, timeout_sec: float | None = None, interval: float = 5, label: str = ""
) -> duckdb.DuckDBPyConnection:
    """等锁连接：更新任务与运行中的 API 共存时，等对方释放锁而不是直接失败。

    只读连接（API）与写连接（更新）在 DuckDB 里互斥；API 每个请求结束即释放，
    因此更新任务通常几秒内就能拿到锁。超时由 ASHARE_RADAR_LOCK_TIMEOUT 控制。
    """
    timeout_sec = _default_timeout() if timeout_sec is None else timeout_sec
    deadline = time.time() + timeout_sec
    started = time.time()
    attempt = 0
    while True:
        try:
            return connect(read_only=read_only)
        except Exception as e:
            if not any(h.lower() in str(e).lower() for h in _LOCK_HINTS):
                raise
            attempt += 1
            waited = time.time() - started
            if time.time() >= deadline:
                raise TimeoutError(
                    f"等待 DuckDB 锁 {timeout_sec:.0f}s 超时（{label or 'writer'}）；"
                    "请确认 API 已重启为按请求释放连接"
                ) from e
            if attempt == 1 or attempt % 6 == 0:
                print(
                    f"[db] lake.duckdb 被占用，等待释放… {waited:.0f}s/{timeout_sec:.0f}s"
                    f"{(' (' + label + ')') if label else ''}",
                    flush=True,
                )
            time.sleep(interval)


@contextmanager
def session(
    read_only: bool = False,
    wait: bool = False,
    timeout_sec: float | None = None,
    interval: float = 5,
):
    con = (
        connect_wait(read_only=read_only, timeout_sec=timeout_sec, interval=interval)
        if wait
        else connect(read_only=read_only)
    )
    try:
        yield con
    finally:
        con.close()


def table_exists(con, name: str) -> bool:
    return bool(
        con.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]
        ).fetchone()[0]
    )
