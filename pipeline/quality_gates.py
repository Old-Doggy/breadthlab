"""Quality gates. Failed block gates prevent publication; warnings remain visible."""
from __future__ import annotations

import json
from datetime import datetime

import duckdb

from . import settings
from .io_utils import atomic_write_json


def _scalar(con, sql: str, params=None):
    row = con.execute(sql, params or []).fetchone()
    return row[0] if row else None


SAMPLE_SQL = """
WITH calendar AS (
    SELECT trade_date, row_number() OVER (ORDER BY trade_date) AS trade_num
    FROM core_trade_cal WHERE is_open=1
), listing_age AS (
    SELECT m.ts_code,
           coalesce(try_cast(m.list_date AS DATE),try_strptime(m.list_date::VARCHAR,'%Y%m%d')::DATE) AS listed_on,
           min(c.trade_num) AS listing_num
    FROM core_stock_meta m LEFT JOIN calendar c ON c.trade_date >=
        coalesce(try_cast(m.list_date AS DATE),try_strptime(m.list_date::VARCHAR,'%Y%m%d')::DATE)
    GROUP BY m.ts_code,m.list_date
), eligible AS (
    SELECT *, coalesce(try_cast(list_date AS DATE),
              try_strptime(list_date::VARCHAR, '%Y%m%d')::DATE) AS listed_on
    FROM v_stock
    WHERE exchange IN ('SSE', 'SZSE') AND market IN ('主板', '创业板', '科创板')
      AND ret IS NOT NULL AND isfinite(ret) AND ret > -1
      AND close > 0 AND isfinite(close) AND adj_factor > 0 AND isfinite(adj_factor)
      AND adj_close > 0 AND isfinite(adj_close)
), sample AS (
    SELECT e.* FROM eligible e JOIN listing_age a USING(ts_code)
    JOIN calendar c ON c.trade_date=e.trade_date
    WHERE e.listed_on IS NOT NULL AND (
      e.listed_on < (SELECT min(trade_date) FROM calendar)
      OR c.trade_num-a.listing_num >= 5)
)
"""


def run_gates(con: duckdb.DuckDBPyConnection, day: str, prev_day: str | None = None,
              *, persist: bool = True) -> dict:
    """Validate a YYYYMMDD day. persist=False supports a caller-owned transaction."""
    d = datetime.strptime(day, "%Y%m%d").date()
    previous = datetime.strptime(prev_day, "%Y%m%d").date() if prev_day else None
    gates = []

    def add(gid, name, ok, value, threshold, level, message=""):
        gates.append({"id": gid, "name": name, "pass": bool(ok), "value": value,
                      "threshold": threshold, "level": level, "message": message})

    n = _scalar(con, "SELECT count(*) FROM core_stock_day WHERE trade_date=?", [d]) or 0
    n_prev = _scalar(con, "SELECT count(*) FROM core_stock_day WHERE trade_date=?", [previous]) if previous else None
    ratio = n / n_prev if n_prev else None
    count_ok = n >= 3000 and (ratio is None or 0.95 <= ratio <= 1.05)
    add(1, "row count", count_ok, n, ">=3000; previous-day ratio 0.95..1.05", "block",
        f"previous={n_prev}, ratio={ratio}")
    dup = _scalar(con, """SELECT count(*) FROM (
        SELECT ts_code FROM core_stock_day WHERE trade_date=? GROUP BY ts_code HAVING count(*)>1
    )""", [d]) or 0
    add(2, "primary key unique", dup == 0, dup, "0 duplicate keys", "block")

    bad = _scalar(con, """SELECT count(*) FROM core_stock_day d
        LEFT JOIN core_stock_meta m USING(ts_code)
        WHERE trade_date=? AND (
          close IS NULL OR NOT isfinite(close) OR close<=0 OR
          high IS NULL OR low IS NULL OR NOT isfinite(high) OR NOT isfinite(low) OR
          low<=0 OR high<low OR close<low-0.011 OR close>high+0.011 OR
          pct_chg IS NULL OR NOT isfinite(pct_chg) OR pct_chg<=-100 OR
          (abs(pct_chg)>44
           AND NOT coalesce(up_limit>=999999 AND down_limit<=0.01, FALSE) AND (
             coalesce(try_cast(m.list_date AS DATE), try_strptime(m.list_date::VARCHAR,'%Y%m%d')::DATE)
               IS NULL OR trade_date > coalesce(try_cast(m.list_date AS DATE),
                 try_strptime(m.list_date::VARCHAR,'%Y%m%d')::DATE) + INTERVAL 30 DAY))
        )""", [d]) or 0
    add(3, "price sanity", bad == 0, bad,
        "finite positive OHLC; low<=close<=high; IPO 30-day or authoritative unlimited-price sentinel exemption", "block")

    comparable, conflict = con.execute("""SELECT count(*), count(*) FILTER (
        WHERE abs(pct_chg-(close/pre_close-1)*100)>0.1)
        FROM core_stock_day WHERE trade_date=? AND pre_close>0 AND isfinite(pre_close)
        AND close>0 AND isfinite(close) AND pct_chg IS NOT NULL AND isfinite(pct_chg)
    """, [d]).fetchone()
    share = conflict / comparable if comparable else 1.0
    add(4, "return consistency", share < 0.01, share, "<1% of comparable rows", "block",
        f"{conflict}/{comparable} comparable rows")
    cov = _scalar(con, """SELECT count(*) FILTER (
        WHERE adj_factor>0 AND isfinite(adj_factor) AND circ_mv>0 AND isfinite(circ_mv)
        AND adj_close>0 AND isfinite(adj_close))::DOUBLE/nullif(count(*),0)
        FROM core_stock_day WHERE trade_date=?""", [d]) or 0
    add(5, "positive field coverage", cov >= settings.GATE_MIN_COVERAGE, cov,
        f">={settings.GATE_MIN_COVERAGE}", "block")

    def stats(dt):
        return con.execute(SAMPLE_SQL + """SELECT
            count(*) FILTER(WHERE ret>0)::DOUBLE/nullif(count(*) FILTER(WHERE ret<>0),0),
            avg(ret) FROM sample WHERE trade_date=?""", [dt]).fetchone()

    breadth, ew = stats(d)
    prev_b, prev_ew = stats(previous) if previous else (None, None)
    delta_b = abs(breadth-prev_b) if breadth is not None and prev_b is not None else None
    add(6, "breadth continuity", delta_b is None or delta_b <= 0.30, breadth,
        "|breadth change|<=0.30; all-flat breadth is undefined", "warn", f"previous={prev_b}")
    unmapped = _scalar(con, """SELECT count(*) FILTER(WHERE sw_l1='未分类')::DOUBLE/
        nullif(count(*),0) FROM v_stock WHERE trade_date=?
        AND exchange IN ('SSE','SZSE') AND market IN ('主板','创业板','科创板')""", [d])
    coverage = 1-unmapped if unmapped is not None else 0
    add(7, "industry coverage", coverage >= settings.GATE_MIN_INDUSTRY_COVERAGE,
        coverage, f">={settings.GATE_MIN_INDUSTRY_COVERAGE}", "block")
    bad_adj = _scalar(con, """SELECT count(*) FROM core_stock_day WHERE trade_date=?
        AND (adj_factor IS NULL OR NOT isfinite(adj_factor) OR adj_factor<=0)""", [d]) or 0
    add(8, "adj factor valid", bad_adj == 0, bad_adj, "0 invalid factors", "warn")
    delta_ew = abs(ew-prev_ew) if ew is not None and prev_ew is not None else None
    add(9, "EW continuity", delta_ew is None or delta_ew <= 0.08, delta_ew,
        "|EW change|<=0.08", "warn", "not comparable" if delta_ew is None else "")
    bad_amount = _scalar(con, """SELECT count(*) FROM core_stock_day WHERE trade_date=?
        AND (amount IS NULL OR NOT isfinite(amount) OR amount<0 OR vol IS NULL
             OR NOT isfinite(vol) OR vol<0)""", [d]) or 0
    add(10, "amount and volume", bad_amount == 0, bad_amount, "finite nonnegative; amount in thousand CNY", "block")
    limit_cov = _scalar(con, SAMPLE_SQL + """SELECT count(*) FILTER (
        WHERE up_limit>0 AND isfinite(up_limit) AND down_limit>0 AND isfinite(down_limit)
        AND up_limit>=down_limit)::DOUBLE/nullif(count(*),0) FROM sample WHERE trade_date=?""", [d])
    add(11, "limit-price coverage", limit_cov is not None and limit_cov >= 0.99,
        limit_cov, ">=0.99 of seasoned valid sample", "block")
    n_indices = _scalar(con, """SELECT count(DISTINCT ts_code) FROM core_index_day WHERE trade_date=?
        AND ts_code IN ('000300.SH','000905.SH','000852.SH','000001.SH')
        AND pct_chg IS NOT NULL AND isfinite(pct_chg) AND close>0 AND isfinite(close)""", [d]) or 0
    add(12, "index completeness", n_indices == 4, n_indices, "4 benchmark indices", "warn")
    bad_indices = _scalar(con, """SELECT count(*) FROM core_index_day WHERE trade_date=?
        AND pre_close>0 AND pct_chg IS NOT NULL
        AND abs(pct_chg-(close/pre_close-1)*100)>0.1""", [d]) or 0
    add(13, "index return consistency", bad_indices == 0, bad_indices, "0 conflicts >0.1pp", "block")
    missing_listing = _scalar(con, """SELECT count(*) FROM v_stock WHERE trade_date=?
        AND exchange IN ('SSE','SZSE') AND market IN ('主板','创业板','科创板')
        AND coalesce(try_cast(list_date AS DATE),try_strptime(list_date::VARCHAR,'%Y%m%d')::DATE) IS NULL""", [d]) or 0
    add(14, "listing dates available", missing_listing == 0, missing_listing, "0 missing listing dates", "block")
    blocking = [g["id"] for g in gates if g["level"] == "block" and not g["pass"]]
    out = {"date": day, "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
           "rows": n, "gates": gates, "passed": not blocking, "blocking": blocking}
    if persist:
        persist_report(out)
    return out


def persist_report(out: dict) -> None:
    qdir = settings.META / "quality"
    atomic_write_json(qdir / f"{out['date']}.json", out)
    atomic_write_json(qdir / "latest.json", out)


def latest() -> dict:
    p = settings.META / "quality" / "latest.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
