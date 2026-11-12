"""The shared fetch → verify → build → publish entry point for API and tasks."""
from __future__ import annotations

import argparse
import json

from . import alerts, settings
from .io_utils import atomic_write_json
from .locking import publish_lock


def run(rebuild=False, target=None, source="auto"):
    from . import build_marts, export_static, refresh_status, update_daily

    with publish_lock():
        stage = "update"
        try:
            if not rebuild:
                result = update_daily.run(target, source=source)
                if result["status"] != "ok":
                    raise RuntimeError("quality gates or required datasets failed")
            stage = "quality"
            status = refresh_status.main()
            if (rebuild and status.get("status") == "failed"
                    and status.get("failure_stage") in ("marts", "export")):
                # A previous export failure may be retried without fetching;
                # never override a failed current gate or incomplete core day.
                from .db import session, table_exists
                from .quality_gates import latest
                quality = latest()
                incomplete = False
                with session(read_only=True) as con:
                    if table_exists(con, "core_dataset_checkpoint"):
                        incomplete = bool(con.execute("""SELECT count(*) FROM core_dataset_checkpoint
                            WHERE NOT completed AND dataset IN ('daily','daily_basic','adj_factor','stk_limit')""").fetchone()[0])
                if quality.get("passed") and not incomplete:
                    status["status"] = "ok"
                    status.pop("failure_stage", None)
                    atomic_write_json(settings.META / "status.json", status)
            if status["status"] != "ok":
                raise RuntimeError("quality gates failed; publishing refused")
            stage = "marts"
            build_marts.run()
            stage = "export"
            # Keep the old alert until the final export succeeds. The candidate
            # payload excludes it, but the on-disk alert survives export failure.
            export_static.main(clear_alert=True)
            alerts.clear()
            return status
        except Exception:
            alerts.write(stage, "本次更新或发布未完成，保留上一次完整产物；请检查本机日志")
            status_path = settings.META / "status.json"
            try:
                status = json.loads(status_path.read_text(encoding="utf-8")) if status_path.exists() else {}
            except (ValueError, OSError):
                status = {}
            status["status"] = "failed"
            status["failure_stage"] = stage
            atomic_write_json(status_path, status)
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true")
    parser.add_argument("--date")
    parser.add_argument("--source", choices=["auto", "tushare", "akshare"], default="auto")
    args = parser.parse_args()
    run(args.rebuild, args.date, args.source)
