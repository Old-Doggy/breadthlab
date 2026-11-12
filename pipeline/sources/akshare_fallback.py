"""akshare（东方财富）备用源：免费、无需 token，与 Tushare 独立。

限制：spot 快照只对“当天收盘后”有效，不能回补历史；历史回补仍用 Tushare
或本地快照。用途：Tushare 限流/故障/积分不足时，保证当日广度不断更。
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

import akshare as ak
import pandas as pd

_CACHE: dict[str, pd.DataFrame] = {}


def _ts_code(code: str) -> str:
    code = str(code).zfill(6)
    if code.startswith(("60", "68", "90")):
        return f"{code}.SH"
    if code.startswith(("00", "30", "20")):
        return f"{code}.SZ"
    return f"{code}.BJ"


def _rate(ts_code: str, name: str) -> float:
    if ts_code.endswith(".BJ"):
        base = 0.30
    elif ts_code.startswith(("688", "300", "301")):
        base = 0.20
    else:
        base = 0.10
    if "ST" in str(name).upper() and base == 0.10:
        base = 0.05
    return base


def _round2(v: float) -> float:
    return float(Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def snapshot() -> pd.DataFrame:
    """全市场快照（约 60s，进程内缓存一次）。"""
    if "snap" not in _CACHE:
        df = ak.stock_zh_a_spot_em()
        df = df[df["最新价"].notna() & (df["最新价"] > 0)
                & (pd.to_numeric(df["成交量"], errors="coerce") > 0)].copy()
        df["ts_code"] = df["代码"].map(_ts_code)
        _CACHE["snap"] = df
    return _CACHE["snap"]


def trading_days() -> list[str]:
    try:
        cal = ak.tool_trade_date_hist_sina()
        return sorted(set(pd.to_datetime(cal["trade_date"]).dt.strftime("%Y%m%d")))
    except Exception as exc:
        raise RuntimeError("备用交易日历不可用，不能以工作日代替交易日") from exc


def is_trading_day(day: str) -> bool:
    return day in trading_days()


def _guard(day: str) -> None:
    now = datetime.now(timezone(timedelta(hours=8)))
    today = now.strftime("%Y%m%d")
    if day != today:
        raise ValueError(f"akshare 快照只支持当天（{today}），收到 {day}")
    if now.time() < time(15, 10):
        raise ValueError("akshare 日线备用快照仅允许上海时间15:10后使用")
    if not is_trading_day(day):
        raise ValueError("akshare 快照日期不是确认的交易日")


def daily(day: str) -> pd.DataFrame:
    _guard(day)
    s = snapshot()
    out = pd.DataFrame(
        {
            "ts_code": s["ts_code"],
            "trade_date": day,
            "open": pd.to_numeric(s["今开"], errors="coerce"),
            "high": pd.to_numeric(s["最高"], errors="coerce"),
            "low": pd.to_numeric(s["最低"], errors="coerce"),
            "close": pd.to_numeric(s["最新价"], errors="coerce"),
            "pre_close": pd.to_numeric(s["昨收"], errors="coerce"),
            "pct_chg": pd.to_numeric(s["涨跌幅"], errors="coerce"),
            "vol": pd.to_numeric(s["成交量"], errors="coerce"),
            "amount": pd.to_numeric(s["成交额"], errors="coerce") / 1000.0,  # 元 -> 千元
        }
    )
    return out.dropna(subset=["close", "pre_close"])


def daily_basic(day: str) -> pd.DataFrame:
    _guard(day)
    s = snapshot()
    out = pd.DataFrame(
        {
            "ts_code": s["ts_code"],
            "trade_date": day,
            "turnover_rate": pd.to_numeric(s["换手率"], errors="coerce"),
            # Ordinary turnover and dynamic PE are not substitutes for these fields.
            "turnover_rate_f": float("nan"),
            "volume_ratio": pd.to_numeric(s["量比"], errors="coerce"),
            "pe_ttm": float("nan"),
            "pb": pd.to_numeric(s["市净率"], errors="coerce"),
            "total_mv": pd.to_numeric(s["总市值"], errors="coerce") / 1e4,  # 元 -> 万元
            "circ_mv": pd.to_numeric(s["流通市值"], errors="coerce") / 1e4,
        }
    )
    return out.dropna(subset=["circ_mv"])


def stk_limit(day: str, con=None) -> pd.DataFrame:
    _guard(day)
    s = snapshot()
    # Without a trustworthy listing date/calendar, leave limits unavailable.
    seasoned = set()
    if con is not None:
        seasoned = {r[0] for r in con.execute(
            """WITH m AS (
                SELECT ts_code, coalesce(try_cast(list_date AS DATE),
                       try_strptime(list_date::VARCHAR,'%Y%m%d')::DATE) AS listed_on
                FROM core_stock_meta
            ) SELECT ts_code FROM m WHERE listed_on IS NOT NULL AND (
              listed_on < (SELECT min(trade_date) FROM core_trade_cal WHERE is_open=1)
              OR (SELECT count(*) FROM core_trade_cal c WHERE c.is_open=1
                  AND c.trade_date BETWEEN m.listed_on AND ?::DATE)>5)""",
            [datetime.strptime(day, "%Y%m%d").date()],
        ).fetchall()}
    rows = []
    for code, name, pre in zip(s["ts_code"], s["名称"], pd.to_numeric(s["昨收"], errors="coerce")):
        if code not in seasoned or pd.isna(pre) or pre <= 0:
            continue
        r = _rate(code, name)
        rows.append((code, _round2(pre * (1 + r)), _round2(pre * (1 - r))))
    out = pd.DataFrame(rows, columns=["ts_code", "up_limit", "down_limit"])
    out["trade_date"] = day
    return out


def adj_factor(con, day: str) -> pd.DataFrame:
    """Carry factors provisionally; callers must record degradation and backfill."""
    _guard(day)
    df = con.execute(
        """
        SELECT ts_code, adj_factor
        FROM core_stock_day
        WHERE trade_date = (SELECT max(trade_date) FROM core_stock_day WHERE trade_date < ?)
          AND adj_factor > 0 AND isfinite(adj_factor)
        """,
        [datetime.strptime(day, "%Y%m%d").date()],
    ).fetchdf()
    df["trade_date"] = day
    return df[["ts_code", "trade_date", "adj_factor"]]


def fetch(con, ds: str, day: str) -> pd.DataFrame | None:
    if ds == "daily":
        return daily(day)
    if ds == "daily_basic":
        return daily_basic(day)
    if ds == "stk_limit":
        return stk_limit(day, con)
    if ds == "adj_factor":
        return adj_factor(con, day)
    return None
