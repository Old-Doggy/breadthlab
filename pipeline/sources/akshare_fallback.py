"""akshare（东方财富）备用源：免费、无需 token，与 Tushare 独立。

限制：spot 快照只对“当天收盘后”有效，不能回补历史；历史回补仍用 Tushare
或本地快照。用途：Tushare 限流/故障/积分不足时，保证当日广度不断更。
"""
from __future__ import annotations

from datetime import datetime
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
    elif ts_code.startswith(("688", "300")):
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
        df = df[df["最新价"].notna() & (df["最新价"] > 0)].copy()
        df["ts_code"] = df["代码"].map(_ts_code)
        _CACHE["snap"] = df
    return _CACHE["snap"]


def is_trading_day(day: str) -> bool:
    try:
        cal = ak.tool_trade_date_hist_sina()
        dates = set(pd.to_datetime(cal["trade_date"]).dt.strftime("%Y%m%d"))
        return day in dates
    except Exception:
        return datetime.strptime(day, "%Y%m%d").weekday() < 5


def _guard(day: str) -> None:
    today = datetime.now().strftime("%Y%m%d")
    if day != today:
        raise ValueError(f"akshare 快照只支持当天（{today}），收到 {day}")


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
            "turnover_rate_f": pd.to_numeric(s["换手率"], errors="coerce"),
            "volume_ratio": pd.to_numeric(s["量比"], errors="coerce"),
            "pe_ttm": pd.to_numeric(s["市盈率-动态"], errors="coerce"),
            "pb": pd.to_numeric(s["市净率"], errors="coerce"),
            "total_mv": pd.to_numeric(s["总市值"], errors="coerce") / 1e4,  # 元 -> 万元
            "circ_mv": pd.to_numeric(s["流通市值"], errors="coerce") / 1e4,
        }
    )
    return out.dropna(subset=["circ_mv"])


def stk_limit(day: str) -> pd.DataFrame:
    _guard(day)
    s = snapshot()
    rows = []
    for code, name, pre in zip(s["ts_code"], s["名称"], pd.to_numeric(s["昨收"], errors="coerce")):
        if not pre or pre <= 0:
            continue
        r = _rate(code, name)
        rows.append((code, _round2(pre * (1 + r)), _round2(pre * (1 - r))))
    out = pd.DataFrame(rows, columns=["ts_code", "up_limit", "down_limit"])
    out["trade_date"] = day
    return out


def adj_factor(con, day: str) -> pd.DataFrame:
    """前一交易日因子顺延：当日无除权则正确，除权日会偏一天（已记录为已知限制）。"""
    df = con.execute(
        """
        SELECT ts_code, adj_factor
        FROM core_stock_day
        WHERE trade_date = (SELECT max(trade_date) FROM core_stock_day WHERE trade_date < ?)
          AND adj_factor IS NOT NULL
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
        return stk_limit(day)
    if ds == "adj_factor":
        return adj_factor(con, day)
    return None
