"""BreadthLab API（Flask 同步版）。

运行：python -m backend.main  （默认 127.0.0.1:8000）
设计：口径在 mart 层算好，接口只做筛选与序列化；DuckDB 单连接 + 锁。
"""
from __future__ import annotations

import json
import math
import sqlite3
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb
from flask import Flask, abort, g, jsonify, request, send_from_directory
from flask.json.provider import DefaultJSONProvider

ROOT = Path(__file__).resolve().parents[1]
LAKE = ROOT / "data" / "lake.duckdb"
META = ROOT / "data" / "meta"
DB = ROOT / "data" / "app.sqlite"
DIST = ROOT / "frontend" / "dist"


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

_lock = threading.Lock()


def con() -> duckdb.DuckDBPyConnection:
    """每请求一个只读连接，请求结束即释放，避免长期占锁让更新任务打不开库。"""
    c = getattr(g, "_con", None)
    if c is None:
        if not LAKE.exists():
            abort(503, "lake.duckdb 尚未构建")
        c = duckdb.connect(str(LAKE), read_only=True)
        c.execute("SET threads=4")
        g._con = c
    return c


@app.errorhandler(duckdb.Error)
def _db_busy(e):  # 更新任务持有写锁时，接口返回 503 而不是 500
    return (
        jsonify({"error": "database busy", "detail": "数据更新中，请稍后重试"}),
        503,
        {"Retry-After": "10"},
    )


@app.teardown_appcontext
def _release_con(exc: BaseException | None) -> None:
    c = g.pop("_con", None)
    if c is not None:
        c.close()


def _clean(v: Any) -> Any:
    if isinstance(v, float) and math.isnan(v):
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


@app.get("/api/meta")
def meta():
    base = one("SELECT min(trade_date) f, max(trade_date) d, count(*) n FROM mart_market_day")
    n_stocks = one("SELECT count(*) n FROM mart_stock_latest")["n"]
    status = {"status": "ok", "updated_at": None, "warnings": []}
    p = META / "status.json"
    if p.exists():
        try:
            import json

            status.update(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            pass
    return jsonify(
        {
            "first_trade_date": str(base["f"]) if base.get("f") else None,
            "last_trade_date": str(base["d"]) if base.get("d") else None,
            "n_days": base.get("n"),
            "n_stocks": n_stocks,
            "source": "Tushare Pro",
            "status": status.get("status", "ok"),
            "updated_at": status.get("updated_at"),
            "warnings": status.get("warnings", []),
        }
    )


@app.get("/api/market/series")
def market_series():
    start = request.args.get("start")
    end = request.args.get("end")
    freq = request.args.get("freq", "day")
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
    limit = int(request.args.get("limit", 400))
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
    start, end = request.args.get("start"), request.args.get("end")
    return jsonify(
        rows(
            """
            SELECT trade_date::VARCHAR AS trade_date, close, adj_close, ret, circ_mv, turnover_rate,
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
    c = sqlite3.connect(DB)
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
    if not pos:
        return jsonify([])
    codes = list(pos.keys())
    ph = ",".join("?" * len(codes))
    data = rows(
        f"""
        SELECT ts_code, name, sw_l1, market, trade_date, close, ret, circ_mv, total_mv,
               turnover_rate, pe_ttm, pb, amount, is_limit_up, is_limit_down
        FROM mart_stock_latest WHERE ts_code IN ({ph})
        """,
        codes,
    )
    for r in data:
        p = pos.get(r["ts_code"], {})
        r["shares"] = p.get("shares", 0.0)
        r["cost"] = p.get("cost", 0.0)
    return jsonify(data)


@app.post("/api/watchlist")
def add_watch():
    payload = request.get_json(silent=True) or {}
    code = str(payload.get("ts_code", "")).strip()
    if not code:
        abort(400, "ts_code required")
    shares = float(payload.get("shares") or 0)
    cost = float(payload.get("cost") or 0)
    c = wdb()
    c.execute(
        "INSERT OR IGNORE INTO watchlist (ts_code, shares, cost, added_at) VALUES (?, ?, ?, ?)",
        (code, shares, cost, datetime.now().isoformat()),
    )
    if shares or cost:
        c.execute("UPDATE watchlist SET shares = ?, cost = ? WHERE ts_code = ?", (shares, cost, code))
    c.commit()
    c.close()
    return jsonify({"ok": True})


@app.patch("/api/watchlist/<code>")
def patch_watch(code: str):
    payload = request.get_json(silent=True) or {}
    c = wdb()
    if "shares" in payload:
        c.execute("UPDATE watchlist SET shares = ? WHERE ts_code = ?", (float(payload["shares"] or 0), code))
    if "cost" in payload:
        c.execute("UPDATE watchlist SET cost = ? WHERE ts_code = ?", (float(payload["cost"] or 0), code))
    c.commit()
    c.close()
    return jsonify({"ok": True})


@app.delete("/api/watchlist/<code>")
def del_watch(code: str):
    c = wdb()
    c.execute("DELETE FROM watchlist WHERE ts_code = ?", (code,))
    c.commit()
    c.close()
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
    data = rows(
        """
        SELECT pe_ttm
        FROM feat_stock
        WHERE ts_code = ?
          AND trade_date >= (SELECT max(trade_date) - INTERVAL 3 YEAR FROM feat_stock)
          AND pe_ttm > 0
        ORDER BY trade_date
        """,
        [code],
    )
    if not data:
        return jsonify({})
    vals = [r["pe_ttm"] for r in data]
    last = vals[-1]
    return jsonify(
        {"pe": round(last, 2), "pct": round(100 * sum(v <= last for v in vals) / len(vals)), "n": len(vals)}
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
    try:
        n = one("SELECT count(*) n FROM mart_market_day")["n"]
        return jsonify({"ok": True, "rows": n})
    except Exception as e:  # pragma: no cover
        return jsonify({"ok": False, "error": str(e)}), 500


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
