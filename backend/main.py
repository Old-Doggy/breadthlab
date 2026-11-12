"""BreadthLab API（Flask 同步版）。

运行：python -m backend.main  （默认 127.0.0.1:8000）
设计：口径在 mart 层算好，接口只做筛选与序列化；DuckDB 单连接 + 锁。
"""
from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import subprocess
import sys
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import duckdb
from flask import Flask, abort, g, jsonify, request, send_from_directory
from flask.json.provider import DefaultJSONProvider
from werkzeug.exceptions import HTTPException

from pipeline import settings

ROOT = settings.ROOT
LAKE = settings.LAKE
META = settings.META
DB = settings.DATA / "app.sqlite"
DIST = Path(os.getenv("BREADTHLAB_DIST_DIR", str(ROOT / "frontend" / "dist"))).resolve()


class ISOJSONProvider(DefaultJSONProvider):
    """DuckDB DATE/DATETIME 默认会被 Flask 序列化成 RFC 822，前端和图表要 ISO。"""

    def default(self, obj: Any) -> Any:
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return super().default(obj)


app = Flask(__name__, static_folder=None)
app.json = ISOJSONProvider(app)
app.json.ensure_ascii = False
app.json.sort_keys = False


@app.before_request
def validate_api_request():
    if not request.path.startswith("/api/"):
        return None
    for key in ("date", "start", "end"):
        raw = request.args.get(key)
        if raw is not None:
            _date_arg(raw)
    start, end = request.args.get("start"), request.args.get("end")
    if start and end and start > end:
        abort(400, "start must not be after end")
    if request.method in ("POST", "PATCH", "DELETE"):
        local = {"localhost", "127.0.0.1", "::1"}
        if urlsplit(request.host_url).hostname not in local:
            abort(403, "local host required")
        if request.remote_addr and request.remote_addr not in local:
            abort(403, "local client required")
        origin = request.headers.get("Origin")
        if origin and (urlsplit(origin).scheme not in {"http", "https"} or urlsplit(origin).hostname not in local):
            abort(403, "local origin required")
    return None


def _date_arg(raw: str) -> str:
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            raise ValueError
        date.fromisoformat(raw)
    except ValueError:
        abort(400, "date must be YYYY-MM-DD")
    return raw


def _code_arg(code: str) -> str:
    if not re.fullmatch(r"\d{6}\.(?:SH|SZ)", code):
        abort(400, "invalid A-share code")
    return code


def _quantity(value: Any, field: str) -> float:
    try:
        if isinstance(value, bool):
            raise ValueError
        number = float(value)
        if not math.isfinite(number) or number < 0:
            raise ValueError
    except (TypeError, ValueError, OverflowError):
        abort(400, f"{field} must be a finite non-negative number")
    return number


def _payload() -> dict:
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        abort(400, "JSON object required")
    return value


@app.errorhandler(HTTPException)
def http_error(error):
    return jsonify({"error": error.name, "detail": error.description}), error.code


@app.errorhandler(Exception)
def internal_error(error):
    app.logger.error("request failed: %s", type(error).__name__)
    return jsonify({"error": "internal server error"}), 500

_lock = threading.Lock()
_update_lock = threading.Lock()
_update_job: dict[str, Any] = {
    "id": None,
    "state": "idle",
    "progress": 0,
    "stage": "",
    "message": "",
    "started_at": None,
    "finished_at": None,
    "trade_date": None,
}



def con() -> duckdb.DuckDBPyConnection:
    """每请求一个只读连接，请求结束即释放，避免长期占锁让更新任务打不开库。"""
    c = getattr(g, "_con", None)
    if c is None:
        if not LAKE.exists():
            abort(503, "lake.duckdb 尚未构建")
        c = duckdb.connect(str(LAKE), read_only=True)
        try:
            c.execute("SET threads=4")
            c.execute("BEGIN TRANSACTION")
            g._con = c
        except Exception:
            c.close()
            raise
    return c


@app.errorhandler(duckdb.Error)
def _db_busy(e):
    if any(hint in str(e).lower() for hint in ("could not set lock", "conflicting lock", "being used",
                                               "file is already open in", "different configuration")):
        return (
            jsonify({"error": "database busy", "detail": "数据更新中，请稍后重试"}),
            503,
            {"Retry-After": "10"},
        )
    return internal_error(e)


@app.teardown_appcontext
def _release_con(exc: BaseException | None) -> None:
    c = g.pop("_con", None)
    if c is not None:
        c.close()
    watch = g.pop("_wdb", None)
    if watch is not None:
        watch.close()


def _clean(v: Any) -> Any:
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def rows(sql: str, params: list[Any] | None = None) -> list[dict]:
    with _lock:
        cur = con().execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [{c: _clean(v) for c, v in zip(cols, r)} for r in cur.fetchall()]


def one(sql: str, params: list[Any] | None = None) -> dict:
    r = rows(sql, params)
    return r[0] if r else {}


# ------------------------------------------------------------------ update job
class UpdateError(RuntimeError):
    pass


def _job_snapshot() -> dict:
    with _update_lock:
        return dict(_update_job)


def _job_set(**kw: Any) -> None:
    with _update_lock:
        _update_job.update(kw)


def _job_progress(value: int, stage: str | None = None, message: str | None = None) -> None:
    with _update_lock:
        if _update_job.get("state") != "running":
            return
        _update_job["progress"] = max(int(_update_job.get("progress") or 0), min(99, value))
        if stage:
            _update_job["stage"] = stage
        if message:
            _update_job["message"] = message


def _friendly_update_error(text: str) -> str:
    low = (text or "").lower()
    if "no module named 'duckdb'" in low or "no module named \"duckdb\"" in low:
        return "运行环境缺少数据依赖，请用 breadthlab 环境重新执行"
    if "tushare_token" in low or "token" in low and "not" in low:
        return "未配置 Tushare Token，暂时无法拉取数据"
    if "no permission" in low:
        return "Tushare 权限不足，部分数据源不可用"
    if "another update" in low or "already running" in low:
        return "已有更新任务正在运行，请稍后再试"
    if "quality" in low or "gate" in low:
        return "数据质量校验未通过，本次更新已中止"
    if "empty" in low or "no data" in low:
        return "数据源尚未返回今日数据，请稍后重试"
    if "traceback" in low:
        return "更新脚本执行失败，请稍后重试"
    if "timeout" in low or "timed out" in low:
        return "更新超时，任务已中止，请检查本地更新日志"
    return "更新失败，请检查本地更新日志后重试"


def _run_step(args: list[str], stage: str, start: int, end: int) -> tuple[int, str]:
    _job_progress(start, stage, "正在连接数据源" if stage == "fetching" else "正在重算指标")
    proc = subprocess.Popen(
        args,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    timed_out = threading.Event()

    def stop():
        timed_out.set()
        proc.kill()

    timer = threading.Timer(2700, stop)
    timer.daemon = True
    timer.start()
    lines: list[str] = []
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\r\n")
            if not line:
                continue
            lines.append(line)
            if len(lines) > 120:
                lines.pop(0)
            if line.startswith("[update]"):
                _job_progress(35, "fetching", "正在更新并校验行情")
            elif line.startswith("[marts]"):
                _job_progress(65, "building", "正在重算指标")
            elif line.startswith("[export]"):
                _job_progress(95, "export", "正在生成离线文件")
        code = proc.wait()
    finally:
        timer.cancel()
        if proc.stdout is not None:
            proc.stdout.close()
    return (124, "update timeout") if timed_out.is_set() else (code, "\n".join(lines))


def _status_trade_date() -> str | None:
    try:
        data = json.loads((META / "status.json").read_text(encoding="utf-8"))
        raw = str(data.get("last_trade_date") or "")
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}" if len(raw) == 8 else (raw or None)
    except Exception:
        return None


def _run_update_job() -> None:
    try:
        _job_set(state="running", progress=4, stage="preparing", message="准备更新数据")
        code, out = _run_step([sys.executable, "-m", "pipeline.release"], "fetching", 8, 97)
        if code != 0:
            raise UpdateError(out)
        if '"status": "skipped"' in out or "another update" in out:
            raise UpdateError("已有更新任务正在运行，请稍后再试")

        d = _status_trade_date()
        _job_set(
            state="done",
            progress=100,
            stage="done",
            message=f"已更新到 {d}" if d else "数据更新完成",
            trade_date=d,
            finished_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )
    except Exception as exc:
        msg = _friendly_update_error(str(exc))
        _job_set(
            state="failed",
            stage="failed",
            message=msg,
            finished_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )
        try:
            from pipeline import alerts
            # A rejected second updater must not overwrite the active publisher's
            # alert/status outside its publication lock.
            if "another update" not in str(exc).lower() and "already running" not in str(exc).lower():
                alerts.write("update", msg)
        except Exception:
            pass


@app.post("/api/update")
def start_update():
    # 自定义头会让跨站表单触发 CORS 预检而失败，避免任意网页触发本地更新
    if request.headers.get("X-BreadthLab") != "1":
        abort(403, "missing X-BreadthLab header")
    with _update_lock:
        if _update_job.get("state") == "running":
            return jsonify(dict(_update_job)), 202
        job_id = uuid.uuid4().hex[:10]
        _update_job.update(
            id=job_id,
            state="running",
            progress=1,
            stage="preparing",
            message="准备更新数据",
            started_at=datetime.now().astimezone().isoformat(timespec="seconds"),
            finished_at=None,
            trade_date=None,
        )
        snapshot = dict(_update_job)
    threading.Thread(target=_run_update_job, name="breadthlab-update", daemon=True).start()
    return jsonify(snapshot), 202


@app.get("/api/update/status")
def update_status():
    return jsonify(_job_snapshot())


@app.get("/api/meta")


def meta():
    base = one("SELECT min(trade_date) f, max(trade_date) d, count(*) n FROM mart_market_day")
    n_stocks = one("SELECT n_valid n FROM mart_market_day ORDER BY trade_date DESC LIMIT 1").get("n", 0)
    status = {"status": "unknown", "updated_at": None, "warnings": [], "sources": {}}
    p = META / "status.json"
    if p.exists():
        try:
            status.update(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            pass
    alert = None
    ap = META / "alert.json"
    if ap.exists():
        try:
            alert = json.loads(ap.read_text(encoding="utf-8"))
            if isinstance(alert, dict):
                alert.pop("log", None)
        except Exception:
            alert = None
    return jsonify(
        {
            "first_trade_date": str(base["f"]) if base.get("f") else None,
            "last_trade_date": str(base["d"]) if base.get("d") else None,
            "n_days": base.get("n"),
            "n_stocks": n_stocks,
            "source": ", ".join(sorted(set(status.get("sources", {}).values()))) or "unknown",
            "sources": status.get("sources", {}),
            "status": status.get("status", "unknown"),
            "updated_at": status.get("updated_at"),
            "warnings": status.get("warnings", []),
            "alert": alert,
        }
    )


@app.get("/api/market/series")
def market_series():
    start = request.args.get("start")
    end = request.args.get("end")
    freq = request.args.get("freq", "day")
    if freq not in ("day", "month"):
        abort(400, "freq must be day or month")
    if freq == "month":
        return jsonify(
            rows(
                """
                SELECT month::VARCHAR AS trade_date, n_days, breadth, ew_ret, cw_ret, med_ret,
                       csd, amount, hhi, top10_share, ew_ret_cum, hs300_ret_cum
                FROM mart_market_month
                WHERE (?::DATE IS NULL OR month >= ?::DATE) AND (?::DATE IS NULL OR month <= ?::DATE)
                ORDER BY month
                """,
                [start, start, end, end],
            )
        )
    return jsonify(
        rows(
            """
            SELECT * FROM mart_market_day
            WHERE (?::DATE IS NULL OR trade_date >= ?::DATE) AND (?::DATE IS NULL OR trade_date <= ?::DATE)
            ORDER BY trade_date
            """,
            [start, start, end, end],
        )
    )


@app.get("/api/market/day/<d>")
def market_day(d: str):
    _date_arg(d)
    m = one("SELECT * FROM mart_market_day WHERE trade_date = ?::DATE", [d])
    if not m:
        abort(404, "no data for this date")
    contrib = rows(
        """
        WITH f AS (
            SELECT ts_code, name, sw_l1, ret, prev_circ_mv
            FROM feat_stock
            WHERE trade_date = ?::DATE AND NOT is_new_stock AND prev_circ_mv > 0
        ),
        w AS (SELECT *, prev_circ_mv / sum(prev_circ_mv) OVER () AS weight FROM f)
        SELECT ts_code, name, sw_l1, ret, weight, weight * ret AS contrib
        FROM w ORDER BY abs(weight * ret) DESC LIMIT 24
        """,
        [d],
    )
    sectors = rows("SELECT * FROM mart_sector_day WHERE trade_date = ?::DATE ORDER BY ew_ret DESC", [d])
    m["contributors"] = contrib
    m["sectors"] = sectors
    return jsonify(m)


@app.get("/api/distribution/<d>")
def distribution(d: str):
    _date_arg(d)
    bins = rows(
        """
        WITH f AS (
            SELECT ret FROM feat_stock
            WHERE trade_date = ?::DATE AND NOT is_new_stock AND ret BETWEEN -0.11 AND 0.11
        )
        SELECT least(43, greatest(0, cast(floor((ret + 0.11) / 0.22 * 44) AS INTEGER))) AS b, count(*) AS n, min(ret) AS lo, max(ret) AS hi
        FROM f GROUP BY b ORDER BY b
        """,
        [d],
    )
    stats = one(
        """
        SELECT count(*) n, median(ret) med, quantile_cont(ret,0.05) p05, quantile_cont(ret,0.25) p25,
               quantile_cont(ret,0.75) p75, quantile_cont(ret,0.95) p95,
               avg(ret) mean, stddev_samp(ret) sd
        FROM feat_stock WHERE trade_date = ?::DATE AND NOT is_new_stock
        """,
        [d],
    )
    return jsonify({"bins": bins, "stats": stats})


@app.get("/api/sectors")
def sectors():
    d = request.args.get("date")
    return jsonify(rows("SELECT * FROM mart_sector_day WHERE trade_date = ?::DATE ORDER BY ew_ret DESC", [d]))


@app.get("/api/sectors/series")
def sector_series():
    start, end = request.args.get("start"), request.args.get("end")
    return jsonify(
        rows(
            """
            SELECT * FROM mart_sector_day
            WHERE (?::DATE IS NULL OR trade_date >= ?::DATE) AND (?::DATE IS NULL OR trade_date <= ?::DATE)
            ORDER BY trade_date, sw_l1
            """,
            [start, start, end, end],
        )
    )


@app.get("/api/sectors/monthly")
def sector_monthly():
    start, end = request.args.get("start"), request.args.get("end")
    return jsonify(
        rows(
            """
            SELECT month::VARCHAR AS month, sw_l1, n_days, breadth, ew_ret, cw_ret, iqr, amount, ew_ret_cum
            FROM mart_sector_month
            WHERE (?::DATE IS NULL OR month >= ?::DATE) AND (?::DATE IS NULL OR month <= ?::DATE)
            ORDER BY month, sw_l1
            """,
            [start, start, end, end],
        )
    )


@app.get("/api/stocks")
def stocks():
    d = request.args.get("date")
    sector = request.args.get("sector")
    try:
        limit = int(request.args.get("limit", 400))
        if not 1 <= limit <= 10000:
            raise ValueError
    except ValueError:
        abort(400, "limit must be an integer between 1 and 10000")
    return jsonify(
        rows(
            """
            SELECT ts_code, name, sw_l1, market, trade_date, close, ret, circ_mv, total_mv,
                   turnover_rate, pe_ttm, pb, amount * 1000 AS amount, is_limit_up, is_limit_down
            FROM feat_stock
            WHERE trade_date = ?::DATE AND NOT is_new_stock
              AND (? IS NULL OR sw_l1 = ?)
            ORDER BY ret DESC LIMIT ?
            """,
            [d, sector, sector, limit],
        )
    )


@app.get("/api/stock/<code>")
def stock_series(code: str):
    _code_arg(code)
    start, end = request.args.get("start"), request.args.get("end")
    return jsonify(
        rows(
            """
            SELECT trade_date::VARCHAR AS trade_date, open, high, low, close, vol,
                   adj_close, ret, circ_mv, turnover_rate,
                   amount * 1000 AS amount, sw_l1, name
            FROM feat_stock
            WHERE ts_code = ?
              AND (?::DATE IS NULL OR trade_date >= ?::DATE)
              AND (?::DATE IS NULL OR trade_date <= ?::DATE)
            ORDER BY trade_date
            """,
            [code, start, start, end, end],
        )
    )


def wdb() -> sqlite3.Connection:
    existing = getattr(g, "_wdb", None)
    if existing is not None:
        return existing
    c = sqlite3.connect(DB)
    g._wdb = c
    c.execute(
        "CREATE TABLE IF NOT EXISTS watchlist (ts_code TEXT PRIMARY KEY, shares REAL DEFAULT 0, cost REAL DEFAULT 0, added_at TEXT)"
    )
    cols = [r[1] for r in c.execute("PRAGMA table_info(watchlist)").fetchall()]
    if "shares" not in cols:
        c.execute("ALTER TABLE watchlist ADD COLUMN shares REAL DEFAULT 0")
    if "cost" not in cols:
        c.execute("ALTER TABLE watchlist ADD COLUMN cost REAL DEFAULT 0")
    return c


@app.get("/api/watchlist")
def watchlist():
    c = wdb()
    pos = {
        r[0]: {"shares": r[1] or 0.0, "cost": r[2] or 0.0}
        for r in c.execute("SELECT ts_code, shares, cost FROM watchlist ORDER BY added_at").fetchall()
    }
    c.close()
    g.pop("_wdb", None)
    if not pos:
        return jsonify([])
    codes = list(pos.keys())
    ph = ",".join("?" * len(codes))
    data = rows(
        f"""
        SELECT *
        FROM mart_stock_latest WHERE ts_code IN ({ph})
        """,
        codes,
    )
    present = {r["ts_code"] for r in data}
    data.extend(
        {"ts_code": code, "name": code, "close": None, "ret": None,
         "trade_date": None, "quote_date": None, "quote_missing": True}
        for code in codes if code not in present
    )
    for r in data:
        p = pos.get(r["ts_code"], {})
        r["shares"] = p.get("shares", 0.0)
        r["cost"] = p.get("cost", 0.0)
    return jsonify(data)


@app.post("/api/watchlist")
def add_watch():
    payload = _payload()
    code = _code_arg(str(payload.get("ts_code", "")).strip())
    shares = _quantity(payload.get("shares", 0), "shares")
    cost = _quantity(payload.get("cost", 0), "cost")
    c = wdb()
    c.execute(
        """INSERT INTO watchlist (ts_code, shares, cost, added_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(ts_code) DO UPDATE SET shares=excluded.shares, cost=excluded.cost""",
        (code, shares, cost, datetime.now().isoformat()),
    )
    c.commit()
    c.close()
    g.pop("_wdb", None)
    return jsonify({"ok": True})


@app.patch("/api/watchlist/<code>")
def patch_watch(code: str):
    _code_arg(code)
    payload = _payload()
    patch = {key: _quantity(payload[key], key) for key in ("shares", "cost") if key in payload}
    if not patch:
        abort(400, "shares or cost required")
    c = wdb()
    if not c.execute("SELECT 1 FROM watchlist WHERE ts_code=?", (code,)).fetchone():
        abort(404, "watch item not found")
    if "shares" in patch:
        c.execute("UPDATE watchlist SET shares = ? WHERE ts_code = ?", (patch["shares"], code))
    if "cost" in patch:
        c.execute("UPDATE watchlist SET cost = ? WHERE ts_code = ?", (patch["cost"], code))
    c.commit()
    c.close()
    g.pop("_wdb", None)
    return jsonify({"ok": True})


@app.delete("/api/watchlist/<code>")
def del_watch(code: str):
    _code_arg(code)
    c = wdb()
    c.execute("DELETE FROM watchlist WHERE ts_code = ?", (code,))
    c.commit()
    c.close()
    g.pop("_wdb", None)
    return jsonify({"ok": True})


@app.get("/api/rotation")
def rotation():
    return jsonify(
        rows(
            """
            SELECT trade_date::VARCHAR AS trade_date, rotation_intensity, n_sectors
            FROM mart_rotation_day
            WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 3 YEAR FROM mart_rotation_day)
            ORDER BY trade_date
            """
        )
    )


@app.get("/api/sector-ranks")
def sector_ranks():
    return jsonify(
        rows(
            """
            SELECT trade_date::VARCHAR AS trade_date, sw_l1, rank20, ret20
            FROM mart_sector_rank
            WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 1 YEAR FROM mart_sector_rank)
            ORDER BY trade_date, sw_l1
            """
        )
    )


@app.get("/api/limit-quality")
def limit_quality():
    return jsonify(
        rows(
            """
            SELECT trade_date::VARCHAR AS trade_date, fd_ratio, open_share, avg_open_times, n_limit_up
            FROM mart_limit_quality
            WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 400 DAY FROM mart_limit_quality)
            ORDER BY trade_date
            """
        )
    )


@app.get("/api/updates")
def updates():
    import glob

    out = []
    for p in sorted(glob.glob(str(META / "update_*.json")), reverse=True)[:30]:
        try:
            d = json.loads(Path(p).read_text(encoding="utf-8"))
            out.append(
                {
                    "date": Path(p).stem.replace("update_", ""),
                    "status": d.get("status"),
                    "days": len(d.get("days", [])),
                    "duration": d.get("duration_sec"),
                    "warnings": len(d.get("warnings", [])),
                }
            )
        except Exception:
            continue
    return jsonify(out)


@app.get("/api/reconcile")
def reconcile():
    p = META / "reconcile.json"
    if not p.exists():
        return jsonify({})
    d = json.loads(p.read_text(encoding="utf-8"))
    return jsonify(
        {k: d.get(k) for k in ("generated_at", "stocks", "pairs", "mae_pp", "p95_pp", "max_pp", "share_gt_0_1pp")}
    )


@app.get("/api/valuation/<code>")
def valuation(code: str):
    _code_arg(code)
    data = rows(
        """
        SELECT trade_date, pe_ttm
        FROM feat_stock
        WHERE ts_code = ?
          AND trade_date >= (SELECT max(trade_date) - INTERVAL 3 YEAR FROM feat_stock)
        ORDER BY trade_date
        """,
        [code],
    )
    if not data:
        return jsonify({})
    latest = data[-1]
    last = latest["pe_ttm"]
    if last is None or not math.isfinite(last) or last <= 0:
        return jsonify({"pe": None, "pct": None, "n": 0, "quote_date": latest["trade_date"]})
    vals = [r["pe_ttm"] for r in data if r["pe_ttm"] is not None and math.isfinite(r["pe_ttm"]) and r["pe_ttm"] > 0]
    return jsonify(
        {"pe": round(last, 2), "pct": round(100 * sum(v <= last for v in vals) / len(vals)),
         "n": len(vals), "quote_date": latest["trade_date"]}
    )


@app.get("/api/quality")
def quality():
    p = META / "quality" / "latest.json"
    if not p.exists():
        return jsonify({})
    import json

    return jsonify(json.loads(p.read_text(encoding="utf-8")))


@app.get("/api/health")
def health():
    n = one("SELECT count(*) n FROM mart_market_day")["n"]
    return jsonify({"ok": True, "rows": n})


# ------------------------------------------------------------------ static SPA
@app.get("/")
def index():
    if (DIST / "index.html").exists():
        return send_from_directory(DIST, "index.html")
    return jsonify({"app": "BreadthLab", "api": "/api/meta"})


@app.get("/<path:path>")
def static_files(path: str):
    target = DIST / path
    if target.is_file():
        return send_from_directory(DIST, path)
    if (DIST / "index.html").exists():
        return send_from_directory(DIST, "index.html")
    abort(404)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False, threaded=True)
