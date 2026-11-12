"""把 DuckDB mart 导出成一个「单文件 HTML」dashboard。

产物：frontend/dist/BreadthLab.html
- 内联 CSS / JS / 字体 / 数据，双击即可打开（file://），无需服务器。
- 同时写出一份 data/static-data.json 便于排查。

用法：python -m pipeline.export_static
"""
from __future__ import annotations

import base64
import argparse
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path

from . import settings
from .db import session
from .io_utils import atomic_write_text
from .locking import publish_lock

DIST = Path(os.getenv("BREADTHLAB_DIST_DIR", str(settings.ROOT / "frontend" / "dist"))).resolve()
OUT = DIST / "BreadthLab.html"


def _round(v):
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, dict):
        return {k: _round(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_round(x) for x in v]
    return v


def build_payload(con) -> dict:
    def norm(v):
        if isinstance(v, float) and not math.isfinite(v):
            return None
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return v

    def rows(sql: str, params=None):
        cur = con.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        return [{c: norm(v) for c, v in zip(cols, r)} for r in cur.fetchall()]

    base = rows("SELECT min(trade_date) f, max(trade_date) d, count(*) n FROM mart_market_day")[0]
    meta = {
        "first_trade_date": str(base["f"]) if base["f"] else None,
        "last_trade_date": str(base["d"]) if base["d"] else None,
        "n_days": base["n"],
        "n_stocks": rows("SELECT n_valid n FROM mart_market_day ORDER BY trade_date DESC LIMIT 1")[0]["n"] if base["n"] else 0,
        "source": "unknown",
        "sources": {},
        "status": "unknown",
        "updated_at": None,
        "warnings": [],
        "alert": None,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    alert_file = settings.META / "alert.json"
    if alert_file.exists():
        try:
            meta["alert"] = json.loads(alert_file.read_text(encoding="utf-8"))
            if isinstance(meta["alert"], dict):
                meta["alert"].pop("log", None)
        except Exception:
            pass
    status_file = settings.META / "status.json"
    if status_file.exists():
        try:
            st = json.loads(status_file.read_text(encoding="utf-8"))
            meta["updated_at"] = st.get("updated_at")
            meta["status"] = st.get("status", "unknown")
            meta["warnings"] = st.get("warnings", [])
            meta["sources"] = st.get("sources", {})
            meta["source"] = ", ".join(sorted(set(meta["sources"].values()))) or "unknown"
        except Exception:
            pass

    market = rows("SELECT * FROM mart_market_day ORDER BY trade_date")
    sectors_rows = rows(
        """
        SELECT trade_date::VARCHAR AS trade_date, sw_l1, n, n_adv, n_dec, breadth, ew_ret, cw_ret,
               med_ret, q10, q25, q75, q90, iqr, csd, amount, turnover_rate, limit_up_n
        FROM mart_sector_day
        WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 3 YEAR FROM mart_sector_day)
        ORDER BY trade_date, sw_l1
        """
    )
    sectors: dict[str, list] = {}
    for r in sectors_rows:
        sectors.setdefault(r["trade_date"], []).append(r)

    monthly = rows(
        """
        SELECT month::VARCHAR AS month, sw_l1, n_days, breadth, ew_ret, cw_ret, iqr, amount, ew_ret_cum
        FROM mart_sector_month ORDER BY month, sw_l1
        """
    )

    rotation = rows(
        """
        SELECT trade_date::VARCHAR AS trade_date, rotation_intensity
        FROM mart_rotation_day
        WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 3 YEAR FROM mart_rotation_day)
        ORDER BY trade_date
        """
    )

    limit_quality = rows(
        """
        SELECT trade_date::VARCHAR AS trade_date, fd_ratio, open_share, avg_open_times, n_limit_up
        FROM mart_limit_quality
        WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 400 DAY FROM mart_limit_quality)
        ORDER BY trade_date
        """
    )

    sector_ranks = rows(
        """
        SELECT trade_date::VARCHAR AS trade_date, sw_l1, rank20
        FROM mart_sector_rank
        WHERE trade_date >= (SELECT max(trade_date) - INTERVAL 1 YEAR FROM mart_sector_rank)
        ORDER BY trade_date, sw_l1
        """
    )

    contrib_rows = rows(
        """
        WITH days AS (
            SELECT DISTINCT trade_date FROM mart_market_day ORDER BY trade_date DESC LIMIT 130
        ),
        f AS (
            SELECT s.trade_date, s.ts_code, s.name, s.sw_l1, s.ret, s.prev_circ_mv
            FROM feat_stock s JOIN days USING (trade_date)
            WHERE NOT s.is_new_stock AND s.prev_circ_mv > 0
        ),
        w AS (
            SELECT *, prev_circ_mv / sum(prev_circ_mv) OVER (PARTITION BY trade_date) AS weight FROM f
        ),
        r AS (
            SELECT *, weight * ret AS contrib,
                   row_number() OVER (PARTITION BY trade_date ORDER BY abs(weight * ret) DESC) AS rn
            FROM w
        )
        SELECT trade_date::VARCHAR AS trade_date, ts_code, name, sw_l1, ret, weight, contrib
        FROM r WHERE rn <= 24 ORDER BY trade_date, rn
        """
    )
    contrib: dict[str, list] = {}
    for r in contrib_rows:
        contrib.setdefault(r["trade_date"], []).append(r)

    dist_rows = rows(
        """
        WITH f AS (
            SELECT ret FROM feat_stock
            WHERE trade_date = (SELECT max(trade_date) FROM feat_stock)
              AND NOT is_new_stock AND ret BETWEEN -0.11 AND 0.11
        )
        SELECT least(43, greatest(0, cast(floor((ret + 0.11) / 0.22 * 44) AS INTEGER))) AS b, count(*) AS n, min(ret) AS lo, max(ret) AS hi
        FROM f GROUP BY b ORDER BY b
        """
    )
    dist_stats = rows(
        """
        SELECT count(*) n, median(ret) med, quantile_cont(ret,0.05) p05, quantile_cont(ret,0.25) p25,
               quantile_cont(ret,0.75) p75, quantile_cont(ret,0.95) p95, avg(ret) mean, stddev_samp(ret) sd
        FROM feat_stock
        WHERE trade_date = (SELECT max(trade_date) FROM feat_stock) AND NOT is_new_stock
        """
    )[0]

    stocks = rows(
        """
        SELECT ts_code, name, sw_l1, market, trade_date::VARCHAR AS trade_date, close, ret,
               circ_mv, total_mv, turnover_rate, pe_ttm, pb, amount * 1000 AS amount,
               is_limit_up, is_limit_down
        FROM feat_stock
        WHERE trade_date = (SELECT max(trade_date) FROM feat_stock) AND NOT is_new_stock
        ORDER BY ret DESC
        """
    )
    watch_pool = rows(
        """
        SELECT *
        FROM mart_stock_latest
        """
    )

    quality = {}
    qfile = settings.META / "quality" / "latest.json"
    if qfile.exists():
        try:
            quality = json.loads(qfile.read_text(encoding="utf-8"))
        except Exception:
            quality = {}

    top_codes = [
        r["ts_code"]
        for r in rows(
            "SELECT ts_code FROM feat_stock WHERE trade_date = (SELECT max(trade_date) FROM feat_stock) "
            "ORDER BY amount DESC LIMIT 60"
        )
    ]
    sample_codes = ["600519.SH", "300750.SZ", "688981.SH", "600036.SH", "002594.SZ", "300059.SZ"]
    series_codes = sorted(set(top_codes) | set(sample_codes))
    ph = ",".join(["?"] * len(series_codes))
    series_rows = rows(
        f"""
        SELECT ts_code, trade_date::VARCHAR AS trade_date, open, high, low, close, vol
        FROM feat_stock
        WHERE ts_code IN ({ph})
          AND trade_date >= (SELECT max(trade_date) - INTERVAL 190 DAY FROM feat_stock)
        ORDER BY ts_code, trade_date
        """,
        series_codes,
    )
    stock_series: dict[str, list] = {}
    for r in series_rows:
        stock_series.setdefault(r["ts_code"], []).append(
            [r["trade_date"], r["open"], r["high"], r["low"], r["close"], r["vol"]]
        )

    updates = []
    for p in sorted(settings.META.glob("update_*.json"), reverse=True)[:30]:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            updates.append(
                {
                    "date": p.stem.replace("update_", ""),
                    "status": d.get("status"),
                    "days": len(d.get("days", [])),
                    "duration": d.get("duration_sec"),
                    "warnings": len(d.get("warnings", [])),
                }
            )
        except Exception:
            continue

    reconcile = {}
    rfile = settings.META / "reconcile.json"
    if rfile.exists():
        try:
            rj = json.loads(rfile.read_text(encoding="utf-8"))
            reconcile = {k: rj.get(k) for k in ("generated_at", "stocks", "pairs", "mae_pp", "p95_pp", "max_pp", "share_gt_0_1pp")}
        except Exception:
            reconcile = {}

    pe_rows = rows(
        f"""
        SELECT ts_code, trade_date::VARCHAR AS trade_date, pe_ttm
        FROM feat_stock
        WHERE ts_code IN ({ph})
          AND trade_date >= (SELECT max(trade_date) - INTERVAL 3 YEAR FROM feat_stock)
        ORDER BY ts_code, trade_date
        """,
        series_codes,
    )
    pe_hist: dict[str, list] = {}
    for r in pe_rows:
        pe_hist.setdefault(r["ts_code"], []).append(r)
    pe_percentile = {}
    for code, vals in pe_hist.items():
        current = vals[-1]
        last = current["pe_ttm"]
        if last is None or not math.isfinite(last) or last <= 0:
            pe_percentile[code] = {"pe": None, "pct": None, "n": 0, "quote_date": current["trade_date"]}
            continue
        vals = [r["pe_ttm"] for r in vals if r["pe_ttm"] is not None and math.isfinite(r["pe_ttm"]) and r["pe_ttm"] > 0]
        pe_percentile[code] = {
            "pe": round(last, 2),
            "pct": round(100 * sum(v <= last for v in vals) / len(vals)),
            "n": len(vals),
            "quote_date": current["trade_date"],
        }
    payload = {
        "meta": meta,
        "quality": quality,
        "updates": updates,
        "reconcile": reconcile,
        "market": market,
        "market_monthly": rows("SELECT month::VARCHAR AS trade_date, * EXCLUDE(month) FROM mart_market_month ORDER BY month"),
        "sectors": sectors,
        "sector_monthly": monthly,
        "rotation": rotation,
        "sector_ranks": sector_ranks,
        "limit_quality": limit_quality,
        "contrib": contrib,
        "distribution": {meta["last_trade_date"]: {"bins": dist_rows, "stats": dist_stats}},
        "stocks": stocks,
        "watch_pool": watch_pool,
        "stock_series": stock_series,
        "pe_percentile": pe_percentile,
        "coverage": {
            "stocks": "latest day only",
            "distribution": "latest day only",
            "sectors": "last three years",
            "contributors": "last 130 trading days",
            "stock_series": "top-60 and sample stocks, last 190 calendar days",
        },
    }
    return _round(payload)


def _inline_assets(html: str, assets: dict[str, bytes]) -> str:
    # CSS：内联并把字体替换为 base64
    def repl_css(match: re.Match) -> str:
        href = match.group(1).lstrip("./").split("/")[-1]
        raw = assets.get(href)
        if raw is None:
            raise ValueError(f"missing stylesheet asset: {href}")
        css = raw.decode("utf-8")
        for name, blob in assets.items():
            if not name.endswith((".woff2", ".woff")):
                continue
            b64 = base64.b64encode(blob).decode()
            pattern = r"url\(\s*[\"']?(?:\./|/assets/|assets/)?" + re.escape(name) + r"[\"']?\s*\)"
            mime = "woff2" if name.endswith(".woff2") else "woff"
            css = re.sub(pattern, f"url(data:font/{mime};base64,{b64})", css)
        for url in re.findall(r"url\(([^)]*)\)", css):
            if not url.strip().strip("\"'").startswith(("data:", "#")):
                raise ValueError("stylesheet contains non-inlined asset URLs")
        return f"<style>{css}</style>"

    html = re.sub(r'<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', repl_css, html)
    html = re.sub(r'<link[^>]+rel="modulepreload"[^>]*>', "", html)

    # JS：内联模块
    def repl_js(match: re.Match) -> str:
        src = match.group(1)
        name = src.split("/")[-1]
        raw = assets.get(name)
        if raw is None:
            raise ValueError(f"missing JavaScript asset: {name}")
        js = re.sub(r"</script", lambda _: "<\\/script", raw.decode("utf-8"), flags=re.IGNORECASE)
        for icon in ("favicon.png", "app-icon.png"):
            if icon in assets:
                encoded = "data:image/png;base64," + base64.b64encode(assets[icon]).decode("ascii")
                for quote in ('"', "'", '`'):
                    for path in (icon, '/' + icon, './' + icon):
                        js = js.replace(quote + path + quote, json.dumps(encoded))
        return f'<script type="module">{js}</script>'

    html = re.sub(r'<script[^>]+type="module"[^>]*src="([^"]+)"[^>]*></script>', repl_js, html)
    for icon in ("favicon.png", "app-icon.png"):
        pattern = rf'href="(?:/|\./)?{re.escape(icon)}"'
        if re.search(pattern, html):
            if icon not in assets:
                raise ValueError(f"missing icon asset: {icon}")
            encoded = "data:image/png;base64," + base64.b64encode(assets[icon]).decode("ascii")
            html = re.sub(pattern, f'href="{encoded}"', html)
    return html


def _script_json(payload: dict) -> str:
    return (json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            .replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def main(allow_failed: bool = False, clear_alert: bool = False) -> None:
    with publish_lock():
        _export(allow_failed, clear_alert)


def _export(allow_failed: bool, clear_alert: bool = False) -> None:
    with session(read_only=True) as con:
        con.execute("BEGIN TRANSACTION")
        payload = build_payload(con)
    if clear_alert:
        payload["meta"]["alert"] = None
    quality = payload.get("quality", {})
    if not payload["meta"]["n_days"]:
        raise RuntimeError("cannot export empty market data")
    quality_day = str(quality.get("date") or "").replace("-", "")
    latest_day = str(payload["meta"]["last_trade_date"] or "").replace("-", "")
    if not allow_failed and (not quality.get("passed") or quality_day != latest_day
                             or payload["meta"]["status"] != "ok"):
        raise RuntimeError("quality gates/status must pass for the exported trade date")

    data_json = _script_json(payload)
    index = (DIST / "index.html").read_text(encoding="utf-8")
    assets = {p.name: p.read_bytes() for p in (DIST / "assets").iterdir() if p.is_file()}
    for icon in ("favicon.png", "app-icon.png"):
        icon_path = DIST / icon
        if icon_path.is_file():
            assets[icon] = icon_path.read_bytes()
    html = _inline_assets(index, assets)
    data_script = f"<script>window.__BL_DATA__={data_json};</script>"
    html = html.replace("</head>", data_script + "</head>", 1) if "</head>" in html else data_script + html
    atomic_write_text(settings.DATA / "static-data.json", data_json)
    atomic_write_text(OUT, html)
    size = OUT.stat().st_size / 1e6
    print(f"[export] {OUT}  {size:.1f} MB  (json {len(data_json)/1e6:.1f} MB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-failed", action="store_true", help="re-export existing marts with a failure warning")
    main(parser.parse_args().allow_failed)
