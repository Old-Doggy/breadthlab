"""为最新交易日重跑质量门禁并刷新 status.json（不拉数据）。"""
from __future__ import annotations

import json
from datetime import datetime

from . import settings
from .db import session
from .quality_gates import run_gates
from .io_utils import atomic_write_json
from .locking import publish_lock


def _refresh() -> dict:
    path = settings.META / "status.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    with session(wait=True, timeout_sec=600) as con:
        last = con.execute("SELECT max(trade_date) FROM core_stock_day").fetchall()[0][0]
        if last is None:
            raise RuntimeError("no daily data; bootstrap is required")
        prev = con.execute(
            "SELECT max(cal_date) FROM core_trade_cal WHERE is_open=1 AND cal_date < ? AND cal_date >= '20161201'",
            [last.strftime("%Y%m%d")],
        ).fetchall()[0][0]
        gate = run_gates(con, last.strftime("%Y%m%d"), prev)
        coverage = next((g["value"] for g in gate["gates"] if g["id"] == 5), None)
        status = {
            "status": "ok" if gate["passed"] else "failed",
            "last_trade_date": last.strftime("%Y%m%d"),
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "rows": {"daily": gate["rows"]},
            "coverage": coverage,
            "sources": previous.get("sources", {}),
            "gates": [{"id": g["id"], "pass": g["pass"]} for g in gate["gates"]],
            "warnings": previous.get("warnings", []),
            "duration_sec": None,
            "message": "",
            "failure_stage": previous.get("failure_stage"),
        }
        # A failed fetch cannot become successful merely by rechecking yesterday.
        if previous.get("status") == "failed":
            status["status"] = "failed"
        atomic_write_json(path, status)
    return status


def main() -> dict:
    with publish_lock():
        return _refresh()


if __name__ == "__main__":
    result = main()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["status"] == "ok" else 2)
