"""Repair statistically incomplete dates in an explicitly isolated database copy.

Never chooses the production database implicitly, never reads/prints credentials.
Each dataset/day is retried up to three times; each date commits atomically.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import time

from . import settings
from .db import session
from .io_utils import atomic_write_json
from .locking import publish_lock
from .update_daily import fetch, insert, tushare_pro, _checkpoint_schema, _checkpoint


def incomplete_dates(con, ratio: float = .85) -> list[dict]:
    """A local median detects partial days even when a row exists for the date."""
    return [dict(zip(("date", "rows", "typical_rows"), r)) for r in con.execute("""
        WITH counts AS (SELECT trade_date,count(*) n FROM core_stock_day GROUP BY 1),
        nearby AS (SELECT *,median(n) OVER(ORDER BY trade_date
            ROWS BETWEEN 10 PRECEDING AND 10 FOLLOWING) typical FROM counts)
        SELECT strftime(trade_date,'%Y%m%d'),n,typical FROM nearby
        WHERE n < ?*typical ORDER BY trade_date
    """, [ratio]).fetchall()]


def require_copy() -> None:
    production = (settings.ROOT / "data").resolve()
    if settings.DATA.resolve() == production or not settings.LAKE.is_file():
        raise RuntimeError("set BREADTHLAB_DATA_DIR to an existing isolated database copy")


def run(apply: bool = False) -> dict:
    require_copy()
    with publish_lock(), session(wait=True) as con:
        plan = incomplete_dates(con)
        report = {"status": "planned", "planned_dates": plan, "repaired": [], "failed": [],
                  "generated_at": datetime.now().astimezone().isoformat(timespec="seconds")}
        if not apply:
            atomic_write_json(settings.META / "history_repair.json", report)
            return report
        pro = tushare_pro()
        _checkpoint_schema(con)
        for item in plan:
            day = item["date"]
            frames = {}
            try:
                # Network happens before the transaction; an unavailable core
                # dataset must not erase any old date or leave half a correction.
                for ds in ("daily", "daily_basic", "adj_factor", "stk_limit"):
                    for attempt in range(3):
                        try:
                            frame = fetch(pro, ds, day)
                            break
                        except Exception:
                            if attempt == 2:
                                raise
                            time.sleep(1 + attempt)
                    if frame is None or frame.empty:
                        raise RuntimeError(f"empty required {ds}")
                    frames[ds] = frame
                    time.sleep(.15)
                if len(frames["daily"]) < .85 * item["typical_rows"]:
                    raise RuntimeError("source daily response is still incomplete")
                con.execute("BEGIN TRANSACTION")
                try:
                    con.execute("DELETE FROM core_stock_day WHERE trade_date=?::DATE",
                                [datetime.strptime(day, "%Y%m%d").date()])
                    for ds, frame in frames.items():
                        insert(con, ds, frame, day)
                        _checkpoint(con, day, ds, "tushare")
                    n, valid = con.execute("""SELECT count(*),count(*) FILTER (
                        WHERE close>0 AND isfinite(close) AND pct_chg IS NOT NULL AND isfinite(pct_chg)
                          AND adj_factor>0 AND isfinite(adj_factor) AND circ_mv>0 AND isfinite(circ_mv))
                        FROM core_stock_day WHERE trade_date=?::DATE""",
                        [datetime.strptime(day, "%Y%m%d").date()]).fetchall()[0]
                    if not n or valid/n < .95:
                        raise RuntimeError("repaired historical core coverage below 95%")
                    con.execute("COMMIT")
                except BaseException:
                    con.execute("ROLLBACK")
                    raise
                report["repaired"].append({**item, "new_rows": n, "coverage": valid/n})
            except Exception as exc:
                # No upstream error strings: they can contain request credentials.
                report["failed"].append({"date": day, "error_type": type(exc).__name__})
                report["status"] = "failed"
                atomic_write_json(settings.META / "history_repair.json", report)
                raise RuntimeError(f"history repair failed for {day}; see sanitized report") from None
            report["status"] = "running"
            atomic_write_json(settings.META / "history_repair.json", report)
            print(f"[repair] {day}: {item['rows']} -> {n}; {len(report['repaired'])}/{len(plan)}", flush=True)
        report["status"] = "ok"
        atomic_write_json(settings.META / "history_repair.json", report)
        return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="otherwise only write a plan")
    args = parser.parse_args()
    result = run(args.apply)
    print(json.dumps({"status": result["status"], "planned": len(result["planned_dates"]),
                      "repaired": len(result["repaired"])}))
