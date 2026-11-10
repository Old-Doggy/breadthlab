"""DuckDB 连接与通用工具。"""
from __future__ import annotations

from contextlib import contextmanager

import duckdb

from . import settings


def connect(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(settings.LAKE), read_only=read_only)
    con.execute("SET threads=16")
    con.execute("SET memory_limit='12GB'")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET temp_directory='%s'" % (settings.DATA / "tmp").as_posix())
    return con


@contextmanager
def session(read_only: bool = False):
    con = connect(read_only=read_only)
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
