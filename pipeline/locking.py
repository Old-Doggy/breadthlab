"""OS-owned publication lock, held across fetch, rebuild and export.

The file is deliberately not unlinked: deleting it permits locking two inodes.
The operating system releases ownership when the process exits or crashes.
"""
from __future__ import annotations

import os
import threading
from contextlib import contextmanager

from . import settings

_mutex = threading.RLock()
_local = threading.local()


@contextmanager
def publish_lock():
    with _mutex:
        if getattr(_local, "held", False):
            yield
            return
        settings.DATA.mkdir(parents=True, exist_ok=True)
        with (settings.DATA / ".publish.lock").open("a+b") as stream:
            stream.seek(0, os.SEEK_END)
            if stream.tell() == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise RuntimeError("another update is already running") from exc
            _local.held = True
            try:
                yield
            finally:
                _local.held = False
                stream.seek(0)
                if os.name == "nt":
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
