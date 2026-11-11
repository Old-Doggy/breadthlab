"""DuckDB 连接与通用工具。"""
from __future__ import annotations

import time
from contextlib import contextmanager

import duckdb

from . import settings

_LOCK_HINTS = ("being used", "Cannot open file", "Could not set lock", "Conflicting lock", "different configuration")


def connect(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(settings.LAKE), read_only=read_only)
    con.execute("SET threads=16")
    con.execute("SET memory_limit='12GB'")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET temp_directory='%s'" % (settings.DATA / "tmp").as_posix())
    return con


def connect_wait(
    read_only: bool = False, timeout_sec: float = 300, interval: float = 5
) -> duckdb.DuckDBPyConnection:
    """等锁连接：更新任务与运行中的 API 共存时，等对方释放锁而不是直接失败。"""
    deadline = time.time() + timeout_sec
    last: Exception | None = None
    while True:
        try:
            return connect(read_only=read_only)
        except Exception as e:  # DuckDB 的文件锁在 Windows 上表现为 IOException
            if not any(h.lower() in str(e).lower() for h in _LOCK_HINTS):
                raise
            last = e
            if time.time() >= deadline:
                raise TimeoutError(f"等待 DuckDB 锁超过 {timeout_sec}s") from last
            time.sleep(interval)


@contextmanager
def session(read_only: bool = False, wait: bool = False, timeout_sec: float = 300, interval: float = 5):
    con = connect_wait(read_only=read_only, timeout_sec=timeout_sec, interval=interval) if wait else connect(read_only=read_only)
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
