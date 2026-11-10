"""9 条数据质量门禁（规格 §7.4）。

block 级失败会阻断发布；warn 级只记录。
每次运行写 data/meta/quality/YYYYMMDD.json。
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import duckdb

from . import settings


def _scalar(con: duckdb.DuckDBPyConnection, sql: str, params=None):
    r = con.execute(sql, params or []).fetchall()
    return r[0][0] if r else None


def run_gates(con: duckdb.DuckDBPyConnection, day: str, prev_day: str | None = None) -> dict:
    """day / prev_day: YYYYMMDD。返回 {date, gates, blocking, passed}。"""
    d = datetime.strptime(day, "%Y%m%d").date()
    gates: list[dict] = []

    def add(gid: int, name: str, ok: bool, value, threshold, level: str, msg: str = ""):
        gates.append(
            {
                "id": gid,
                "name": name,
                "pass": bool(ok),
                "value": value,
                "threshold": threshold,
                "level": level,
                "message": msg,
            }
        )

    n = _scalar(con, "SELECT count(*) FROM core_stock_day WHERE trade_date = ?", [d]) or 0
    n_prev = (
        _scalar(con, "SELECT count(*) FROM core_stock_day WHERE trade_date = ?", [datetime.strptime(prev_day, "%Y%m%d").date()])
        if prev_day
        else None
    )
    # 1 当日股票数
    if n_prev:
        ratio_n = n / n_prev
        add(1, "row count vs prev day", 0.95 <= ratio_n <= 1.05, round(ratio_n, 4), "[0.95, 1.05]", "block",
            f"{n} vs {n_prev}")
    else:
        add(1, "row count vs prev day", n > 3000, n, "> 3000", "block")

    # 2 主键唯一
    dup = _scalar(
        con,
        "SELECT count(*) FROM (SELECT ts_code, trade_date FROM core_stock_day WHERE trade_date = ? GROUP BY 1,2 HAVING count(*) > 1)",
        [d],
    ) or 0
    add(2, "primary key unique", dup == 0, dup, "0 duplicates", "block")

    # 3 价格合法性：非正价格 / high<low / 老股单日 |pct|>44（新股上市前 30 日豁免）
    bad_price = _scalar(
        con,
        "SELECT count(*) FROM core_stock_day WHERE trade_date = ? AND (close <= 0 OR high < low)",
        [d],
    ) or 0
    extreme = _scalar(
        con,
        """
        SELECT count(*) FROM core_stock_day
        WHERE trade_date = ? AND abs(pct_chg) > 44
          AND ts_code IN (
              SELECT DISTINCT ts_code FROM core_stock_day
              WHERE trade_date >= ?::DATE - INTERVAL 30 DAY AND trade_date < ?::DATE
          )
        """,
        [d, d, d],
    ) or 0
    bad = bad_price + extreme
    add(3, "price sanity", bad == 0, bad, "0 invalid (new listings exempt)", "block")
    # 4 收益一致性
    conflict = _scalar(
        con,
        """
        SELECT count(*) FILTER (WHERE abs(pct_chg - (close / nullif(pre_close, 0) - 1) * 100) > 0.1)
        FROM core_stock_day WHERE trade_date = ? AND pre_close > 0 AND pct_chg IS NOT NULL
        """,
        [d],
    ) or 0
    share4 = conflict / n if n else 1
    add(4, "return consistency", share4 < 0.01, round(share4, 4), "< 1%", "block", f"{conflict} conflicts")

    # 5 覆盖率
    cov = _scalar(
        con,
        """
        SELECT count(*) FILTER (WHERE adj_factor IS NOT NULL AND circ_mv IS NOT NULL)::DOUBLE / nullif(count(*), 0)
        FROM core_stock_day WHERE trade_date = ?
        """,
        [d],
    ) or 0
    add(5, "field coverage", cov >= 0.99, round(cov, 4), ">= 0.99", "block")

    # 6 广度合理性
    breadth = _scalar(
        con,
        """
        SELECT count(*) FILTER (WHERE pct_chg > 0)::DOUBLE /
               nullif(count(*) FILTER (WHERE pct_chg > 0) + count(*) FILTER (WHERE pct_chg < 0), 0)
        FROM core_stock_day WHERE trade_date = ? AND pct_chg IS NOT NULL
        """,
        [d],
    ) or 0
    prev_b = (
        _scalar(con, "SELECT breadth FROM mart_market_day WHERE trade_date = ?", [datetime.strptime(prev_day, "%Y%m%d").date()])
        if prev_day
        else None
    )
    delta_b = abs(breadth - prev_b) if prev_b is not None else 0
    add(6, "breadth sanity", 0 <= breadth <= 1 and delta_b <= 0.30, round(breadth, 4), "0..1 and |Δ| <= 0.30",
        "block" if not (0 <= breadth <= 1) else "warn", f"prev {round(prev_b, 4) if prev_b is not None else None}")

    # 7 行业覆盖（v_stock 已存在）
    unmapped = _scalar(
        con,
        """
        SELECT count(*) FILTER (WHERE sw_l1 = '未分类')::DOUBLE / nullif(count(*), 0)
        FROM v_stock WHERE trade_date = ?
        """,
        [d],
    )
    unmapped = unmapped if unmapped is not None else 1
    add(7, "industry coverage", unmapped <= 0.03, round(1 - unmapped, 4), ">= 0.97", "block")

    # 8 复权因子
    bad_adj = _scalar(
        con,
        "SELECT count(*) FROM core_stock_day WHERE trade_date = ? AND (adj_factor IS NULL OR adj_factor <= 0)",
        [d],
    ) or 0
    add(8, "adj factor valid", bad_adj == 0, bad_adj, "0 invalid", "warn")

    # 9 与上一版差异（连续性告警）
    ew = _scalar(
        con,
        "SELECT avg(pct_chg) / 100 FROM core_stock_day WHERE trade_date = ? AND pct_chg IS NOT NULL",
        [d],
    ) or 0
    prev_ew = (
        _scalar(con, "SELECT ew_ret FROM mart_market_day WHERE trade_date = ?", [datetime.strptime(prev_day, "%Y%m%d").date()])
        if prev_day
        else None
    )
    delta_ew = abs(ew - prev_ew) if prev_ew is not None else 0
    add(9, "continuity vs prev day", delta_ew <= 0.08, round(delta_ew, 4), "|EW change| <= 8pp", "warn")

    blocking = [g for g in gates if g["level"] == "block" and not g["pass"]]
    out = {
        "date": day,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "rows": n,
        "gates": gates,
        "passed": len(blocking) == 0,
        "blocking": [g["id"] for g in blocking],
    }
    qdir = settings.META / "quality"
    qdir.mkdir(parents=True, exist_ok=True)
    (qdir / f"{day}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (qdir / "latest.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def latest() -> dict:
    p = settings.META / "quality" / "latest.json"
    return json.loads(p.read_text(encoding="utf-8")) if Path(p).exists() else {}
