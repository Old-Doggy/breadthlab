"""为最新交易日重跑质量门禁并刷新 status.json（不拉数据）。"""
from __future__ import annotations

import json
from datetime import datetime

from . import settings
from .db import session
from .quality_gates import run_gates


def main() -> dict:
    with session(wait=True, timeout_sec=600) as con:
        last = con.execute("SELECT max(trade_date) FROM core_stock_day").fetchall()[0][0]
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
            "sources": {
                "daily": "tushare",
                "daily_basic": "tushare",
                "adj_factor": "tushare",
                "stk_limit": "tushare",
                "moneyflow": "tushare",
                "margin": "tushare",
                "index": "akshare",
                "limit_list_d": "tushare (no permission)",
            },
            "gates": [{"id": g["id"], "pass": g["pass"]} for g in gate["gates"]],
            "warnings": [],
            "duration_sec": None,
            "message": "",
        }
        (settings.META / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    return status


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False, indent=2))
