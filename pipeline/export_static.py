"""把 DuckDB mart 导出成一个「单文件 HTML」dashboard。

产物：frontend/dist/BreadthLab.html
- 内联 CSS / JS / 字体 / 数据，双击即可打开（file://），无需服务器。
- 同时写出一份 data/static-data.json 便于排查。

用法：python -m pipeline.export_static
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

from . import settings
from .db import session

DIST = settings.ROOT / "frontend" / "dist"
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
        if isinstance(v, float) and v != v:
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
        "first_trade_date": str(base["f"]),
        "last_trade_date": str(base["d"]),
        "n_days": base["n"],
        "n_stocks": rows("SELECT count(*) n FROM mart_stock_latest")[0]["n"],
        "source": "Tushare Pro",
        "status": "ok",
        "updated_at": None,
        "warnings": [],
    }
    status_file = settings.META / "status.json"
    if status_file.exists():
        try:
            st = json.loads(status_file.read_text(encoding="utf-8"))
            meta["updated_at"] = st.get("updated_at")
            meta["status"] = st.get("status", "ok")
            meta["warnings"] = st.get("warnings", [])
        except Exception:
            pass

    market = rows("SELECT * FROM mart_market_day ORDER BY trade_date")
    sectors_rows = rows(
        """
        SELECT trade_date::VARCHAR AS trade_date, sw_l1, n, n_adv, n_dec, breadth, ew_ret, cw_ret,
               med_ret, q25, q75, iqr, csd, amount, turnover_rate, limit_up_n
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
        SELECT ts_code, name, sw_l1, market, trade_date::VARCHAR AS trade_date, close, ret,
               circ_mv, total_mv, turnover_rate, pe_ttm, pb, amount, is_limit_up, is_limit_down
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

    payload = {
        "meta": meta,
        "quality": quality,
        "market": market,
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
    }
    return _round(payload)


def _inline_assets(html: str, assets: dict[str, bytes]) -> str:
    # CSS：内联并把字体替换为 base64
    def repl_css(match: re.Match) -> str:
        href = match.group(1).lstrip("./").split("/")[-1]
        raw = assets.get(href)
        if raw is None:
            return ""
        css = raw.decode("utf-8")
        for name, blob in assets.items():
            if not name.endswith(".woff2"):
                continue
            b64 = base64.b64encode(blob).decode()
            pattern = r"url\(\s*[\"']?(?:\./|/assets/|assets/)?" + re.escape(name) + r"[\"']?\s*\)"
            css = re.sub(pattern, f"url(data:font/woff2;base64,{b64})", css)
        return f"<style>{css}</style>"

    html = re.sub(r'<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', repl_css, html)
    html = re.sub(r'<link[^>]+rel="modulepreload"[^>]*>', "", html)

    # JS：内联模块
    def repl_js(match: re.Match) -> str:
        src = match.group(1)
        name = src.split("/")[-1]
        raw = assets.get(name)
        if raw is None:
            return ""
        js = raw.decode("utf-8").replace("</script", "<\\/script")
        return f'<script type="module">{js}</script>'

    html = re.sub(r'<script[^>]+type="module"[^>]*src="([^"]+)"[^>]*></script>', repl_js, html)
    return html


def main() -> None:
    with session(read_only=True) as con:
        payload = build_payload(con)

    data_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (settings.DATA / "static-data.json").write_text(data_json, encoding="utf-8")

    index = (DIST / "index.html").read_text(encoding="utf-8")
    assets = {p.name: p.read_bytes() for p in (DIST / "assets").iterdir() if p.is_file()}
    html = _inline_assets(index, assets)

    data_script = f"<script>window.__BL_DATA__={data_json};</script>"
    if "</head>" in html:
        html = html.replace("</head>", data_script + "</head>", 1)
    else:
        html = data_script + html

    OUT.write_text(html, encoding="utf-8")
    size = OUT.stat().st_size / 1e6
    print(f"[export] {OUT}  {size:.1f} MB  (json {len(data_json)/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
