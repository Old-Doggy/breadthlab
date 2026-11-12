"""源间对账：抽样比较 Tushare 与 akshare 的日收益。

用法：python -m pipeline.reconcile_sources --stocks 30 --days 3
输出：当前数据目录的 meta/reconcile.json、meta/reconcile.md
"""
from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime

import akshare as ak
import pandas as pd

from . import settings
from .db import session
from .update_daily import tushare_pro
from .io_utils import atomic_write_json, atomic_write_text


def main(stocks: int = 30, days: int = 3) -> dict:
    with session() as con:
        latest = con.execute("SELECT max(trade_date) FROM feat_stock").fetchall()[0][0]
        dates = [
            r[0]
            for r in con.execute(
                "SELECT DISTINCT trade_date FROM mart_market_day WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT ?",
                [latest, days],
            ).fetchall()
        ]
        codes = [
            r[0]
            for r in con.execute(
                "SELECT ts_code FROM feat_stock WHERE trade_date = ? ORDER BY ts_code", [latest]
            ).fetchall()
        ]
    random.seed(42)
    if not dates or not codes:
        raise RuntimeError("no dated stock observations available for reconciliation")
    sample = sorted(random.sample(codes, min(stocks, len(codes))))

    pro = tushare_pro()
    ts_frames = []
    for d in dates:
        df = pro.daily(trade_date=d.strftime("%Y%m%d"))
        if df is None or df.empty:
            continue
        df = df[df.ts_code.isin(sample)][["ts_code", "trade_date", "pct_chg"]].copy()
        df["trade_date"] = pd.to_datetime(df.trade_date.astype(str), format="%Y%m%d").dt.date
        ts_frames.append(df)
    ts = pd.concat(ts_frames, ignore_index=True) if ts_frames else pd.DataFrame(columns=["ts_code", "trade_date", "pct_chg"])

    ak_rows = []
    start = min(dates).strftime("%Y%m%d")
    end = max(dates).strftime("%Y%m%d")
    for code in sample:
        symbol = code.split(".")[0]
        try:
            df = ak.stock_zh_a_hist(symbol=symbol, period="daily", start_date=start, end_date=end, adjust="")
            if df is None or df.empty:
                continue
            df = df[["日期", "涨跌幅"]].copy()
            df.columns = ["trade_date", "ak_pct"]
            df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
            df["ts_code"] = code
            ak_rows.append(df)
        except Exception as e:
            print(f"[reconcile] {code} failed: {type(e).__name__}")
        time.sleep(0.25)
    aks = pd.concat(ak_rows, ignore_index=True) if ak_rows else pd.DataFrame(columns=["trade_date", "ak_pct", "ts_code"])

    m = ts.merge(aks, on=["ts_code", "trade_date"], how="inner")
    if m.empty:
        out = {"generated_at": datetime.now().isoformat(timespec="seconds"), "n": 0, "error": "no overlap"}
    else:
        m["diff"] = (m.pct_chg - m.ak_pct).abs()
        out = {
            "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "stocks": len(sample),
            "days": [str(d) for d in dates],
            "pairs": int(len(m)),
            "mae_pp": round(float(m["diff"].mean()), 4),
            "p95_pp": round(float(m["diff"].quantile(0.95)), 4),
            "max_pp": round(float(m["diff"].max()), 4),
            "share_gt_0_1pp": round(float((m["diff"] > 0.1).mean()), 4),
            "worst": m.sort_values("diff", ascending=False).head(5)[["ts_code", "trade_date", "pct_chg", "ak_pct", "diff"]].assign(
                trade_date=lambda x: x.trade_date.astype(str)
            ).to_dict("records"),
        }
    atomic_write_json(settings.META / "reconcile.json", out)

    md = f"""# 源间对账（Tushare vs akshare）

- 生成时间：{out.get('generated_at')}
- 样本：{out.get('stocks')} 只股票 × {len(out.get('days', []))} 个交易日，共 {out.get('pairs', 0)} 对
- MAE：{out.get('mae_pp', '—')} pp ｜ P95：{out.get('p95_pp', '—')} pp ｜ 最大：{out.get('max_pp', '—')} pp
- 差异 > 0.1pp 的占比：{out.get('share_gt_0_1pp', '—')}

结论：{'无重合记录，无法核验源间差异' if not out.get('pairs') else '两源在抽样范围内一致（MAE < 0.05pp）' if out.get('mae_pp', 9) < 0.05 else '存在源间差异，页面需标注'}。

> 口径：akshare 取不复权日线的“涨跌幅”，Tushare 取 `daily.pct_chg`；仅抽样校验，不作为主数据源。
"""
    atomic_write_text(settings.META / "reconcile.md", md)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stocks", type=int, default=30)
    ap.add_argument("--days", type=int, default=3)
    args = ap.parse_args()
    main(args.stocks, args.days)
