"""全量数据审计：从原始表独立重算，与 mart / 静态 payload / akshare 交叉验证。

用法：python scripts/audit_all.py [--date 2026-11-10] [--samples 20]
输出：docs/audit_report.md，控制台 PASS/FAIL 表。
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

RESULTS: list[dict] = []


def check(item: str, expected, actual, tol=0.0, note: str = "", kind="num") -> None:
    expected = None if pd.isna(expected) else expected
    actual = None if pd.isna(actual) else actual
    if kind == "num":
        if expected is None or actual is None:
            ok = bool(expected == actual)
            diff = None
        else:
            diff = float(actual) - float(expected)
            ok = bool(abs(diff) <= tol)
        RESULTS.append(
            {"item": item, "expected": expected, "actual": actual, "diff": diff, "ok": ok, "note": note}
        )
    else:
        ok = bool(expected == actual)
        RESULTS.append(
            {"item": item, "expected": expected, "actual": actual, "diff": None, "ok": ok, "note": note}
        )


def skip(item: str, reason: str) -> None:
    RESULTS.append({"item": item, "expected": None, "actual": None, "diff": None, "ok": None, "note": reason})


def audit_market(con, day: str) -> None:
    m = con.execute(
        "SELECT * FROM mart_market_day WHERE trade_date = ?", [day]
    ).fetchdf().iloc[0]

    raw = con.execute(
        """
        SELECT count(*) n,
               count(*) FILTER (WHERE ret > 0) adv,
               count(*) FILTER (WHERE ret < 0) dec,
               avg(ret) ew,
               median(ret) med,
               stddev_samp(ret) csd,
               quantile_cont(ret, 0.25) q25,
               quantile_cont(ret, 0.75) q75,
               sum(amount) * 1000 amt,
               CASE WHEN count(is_limit_up)>0 THEN count(*) FILTER (WHERE is_limit_up) END lim_up,
               CASE WHEN count(is_limit_down)>0 THEN count(*) FILTER (WHERE is_limit_down) END lim_dn
        FROM feat_stock WHERE trade_date = ? AND NOT is_new_stock
        """,
        [day],
    ).fetchdf().iloc[0]

    check("样本数 n_valid", raw.n, m.n_valid, 0)
    check("上涨家数", raw.adv, m.n_adv, 0)
    check("下跌家数", raw.dec, m.n_dec, 0)
    check("广度 = 涨/(涨+跌)", raw.adv / (raw.adv + raw.dec) if raw.adv+raw.dec else None, m.breadth, 1e-12)
    check("等权收益", raw.ew, m.ew_ret, 1e-12)
    check("中位数收益", raw.med, m.med_ret, 1e-12)
    check("横截面标准差", raw.csd, m.csd, 1e-9)
    check("IQR = q75-q25", raw.q75 - raw.q25, m.iqr, 1e-12)
    check("成交额（元）", raw.amt, m.amount, max(1.0, raw.amt * 1e-9))
    check("涨停家数（价格口径）", raw.lim_up, m.limit_up_n, 0)
    check("跌停家数（价格口径）", raw.lim_dn, m.limit_down_n, 0)

    # 市值加权：前一日流通市值
    cap = con.execute(
        """
        WITH previous AS (
            SELECT max(trade_date) AS d FROM core_trade_cal WHERE is_open=1 AND trade_date<?
        ), f AS (
            SELECT f.ts_code, f.trade_date, f.ret, c.circ_mv AS prev_cap
            FROM feat_stock f CROSS JOIN previous p
            LEFT JOIN core_stock_day c ON c.ts_code=f.ts_code AND c.trade_date=p.d
            WHERE f.trade_date = ? AND NOT f.is_new_stock
        ),
        w AS (SELECT *, prev_cap / sum(prev_cap) OVER () AS wt FROM f WHERE prev_cap > 0 AND isfinite(prev_cap)),
        r AS (SELECT *, row_number() OVER (ORDER BY prev_cap DESC) rn FROM w)
        SELECT sum(wt * ret) cw,
               sum(wt * wt) * 10000 hhi,
               sum(wt * ret) FILTER (WHERE rn <= 10) top10_pp,
               sum(abs(wt * ret)) FILTER (WHERE rn <= 10) / nullif(sum(abs(wt * ret)),0) top10_share
        FROM r
        """,
        [day, day],
    ).fetchdf().iloc[0]
    check("市值加权收益 cw_ret", cap.cw, m.cw_ret, 1e-6)
    check("HHI", cap.hhi, m.hhi, 0.01)
    check("Top10 贡献（pp）", cap.top10_pp * 100, m.top10_contrib_pct, 1e-5)
    check("Top10 波动占比", cap.top10_share, m.top10_share, 1e-5)

    # 指数收益
    idx = con.execute(
        "SELECT pct_chg / 100.0 FROM core_index_day WHERE trade_date = ? AND ts_code = '000300.SH'",
        [day],
    ).fetchdf()
    check("沪深300 收益", None if idx.empty else float(idx.iloc[0, 0]), m.hs300_ret, 1e-12)

    # 派生 UI 指标
    last250 = con.execute(
        "SELECT breadth FROM mart_market_day WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 250",
        [day],
    ).fetchdf()["breadth"]
    pctile = (last250 <= m.breadth).sum() / len(last250)

    avg20 = con.execute(
        "SELECT avg(breadth) FROM (SELECT breadth FROM mart_market_day WHERE trade_date <= ? ORDER BY trade_date DESC LIMIT 20)",
        [day],
    ).fetchall()[0][0]
    print(f"  [info] 广度较前20日均值 = {(m.breadth - avg20) * 100:.1f}pp")
    print(f"  [info] 广度分位 = {pctile:.1%}")


def audit_sectors(con, day: str) -> None:
    sec = con.execute(
        """
        SELECT sw_l1, count(*) n, avg(ret) ew,
               count(*) FILTER (WHERE ret > 0)::DOUBLE / nullif(count(*) FILTER (WHERE ret > 0) + count(*) FILTER (WHERE ret < 0), 0) breadth,
               quantile_cont(ret, 0.75) - quantile_cont(ret, 0.25) iqr
        FROM feat_stock WHERE trade_date = ? AND NOT is_new_stock
        GROUP BY sw_l1
        """,
        [day],
    ).fetchdf()
    mart = con.execute("SELECT sw_l1, n, ew_ret, breadth, iqr FROM mart_sector_day WHERE trade_date = ?", [day]).fetchdf()
    mm = mart.set_index("sw_l1")
    for name in ["电子", "银行", "医药生物"]:
        if name not in mm.index:
            continue
        row = sec[sec.sw_l1 == name].iloc[0]
        m = mm.loc[name]
        check(f"{name} n", row.n, m.n, 0)
        check(f"{name} 等权收益", row.ew, m.ew_ret, 1e-12)
        check(f"{name} 广度", row.breadth, m.breadth, 1e-12)
        check(f"{name} IQR", row.iqr, m.iqr, 1e-12)
    total = con.execute(
        "SELECT count(*) FROM feat_stock WHERE trade_date = ? AND NOT is_new_stock AND sw_l1 = '未分类'", [day]
    ).fetchall()[0][0]
    print(f"  [info] 未分类个股 = {total} / {int(sec.n.sum())}")

    m_amt = con.execute("SELECT amount FROM mart_market_day WHERE trade_date = ?", [day]).fetchall()[0][0]
    s_amt = con.execute(
        "SELECT sum(amount) FROM mart_sector_day WHERE trade_date = ?", [day]
    ).fetchall()[0][0]
    unmapped_amount = con.execute("""SELECT coalesce(sum(amount),0)*1000 FROM feat_stock
        WHERE trade_date=? AND NOT is_new_stock AND sw_l1='未分类'""", [day]).fetchone()[0]
    check("行业成交额合计 + 未分类 = 全市场", m_amt, (s_amt or 0) + unmapped_amount, m_amt * 0.001)


def audit_stocks_vs_akshare(con, day: str, n_samples: int) -> None:
    import akshare as ak

    codes = [
        r[0]
        for r in con.execute(
            "SELECT ts_code FROM feat_stock WHERE trade_date = ? AND NOT is_new_stock ORDER BY ts_code",
            [day],
        ).fetchall()
    ]
    random.seed(7)
    sample = sorted(random.sample(codes, min(n_samples, len(codes))))
    ref = con.execute(
        "SELECT ts_code, close, ret, amount, circ_mv FROM feat_stock WHERE trade_date = ?",
        [day],
    ).fetchdf().set_index("ts_code")
    d = pd.to_datetime(day).strftime("%Y%m%d")
    ok_price = ok_ret = ok_amt = 0
    checked = checked_ret = checked_em = checked_sina = 0
    for code in sample:
        r = ref.loc[code]
        em = None
        try:
            df = ak.stock_zh_a_hist(symbol=code.split(".")[0], period="daily", start_date=d, end_date=d, adjust="")
            if df is not None and not df.empty:
                row = df.iloc[0]
                em = (float(row["收盘"]), float(row["涨跌幅"]), float(row["成交额"]))
                checked_em += 1
        except Exception:
            pass

        if em is not None:
            close, pct, amt = em
            checked += 1
            checked_ret += 1
            ok_price += abs(close - r.close) < 0.011
            ok_ret += abs(pct - r.ret * 100) < 0.05
            ok_amt += abs(amt - r.amount * 1000) / max(1.0, r.amount * 1000) < 0.01
        else:
            # 东方财富限流时改用新浪日线：取前一日与当日收盘，自行计算涨跌幅
            try:
                sym = ("sh" if code.endswith(".SH") else "sz") + code.split(".")[0]
                prev = con.execute(
                    "SELECT max(cal_date) FROM core_trade_cal WHERE cal_date < ?", [day]
                ).fetchall()[0][0]
                df = ak.stock_zh_a_daily(symbol=sym, start_date=prev, end_date=d, adjust="")
                if df is not None and len(df) >= 2:
                    df = df.sort_values("date").reset_index(drop=True)
                    close = float(df.iloc[-1]["close"])
                    pct = (close / float(df.iloc[-2]["close"]) - 1) * 100
                    amt = float(df.iloc[-1]["amount"])
                    checked += 1
                    checked_ret += 1
                    checked_sina += 1
                    ok_price += abs(close - r.close) < 0.011
                    ok_ret += abs(pct - r.ret * 100) < 0.05
                    ok_amt += abs(amt - r.amount * 1000) / max(1.0, r.amount * 1000) < 0.01
            except Exception:
                pass
        time.sleep(0.1)

    src = f"东财 {checked_em} / 新浪 {checked_sina}"
    if checked == 0:
        skip("akshare 抽样收盘价一致", "东财与新浪均不可用（限流/网络）")
        skip("akshare 抽样成交额一致", "东财与新浪均不可用（限流/网络）")
    else:
        check("akshare 抽样收盘价一致", checked, ok_price, 0, note=f"{checked} 只，容差 0.01（{src}）")
        check("akshare 抽样成交额一致", checked, ok_amt, 0, note=f"{checked} 只，容差 1%（{src}）")
    if checked_ret == 0:
        skip("akshare 抽样涨跌幅一致", "仅新浪可用，未覆盖涨跌幅字段")
    else:
        check("akshare 抽样涨跌幅一致", checked_ret, ok_ret, 0, note=f"{checked_ret} 只，容差 0.05pp")


def audit_index_vs_akshare(con, day: str) -> None:
    import akshare as ak

    local = con.execute(
        "SELECT pct_chg / 100.0 FROM core_index_day WHERE trade_date = ? AND ts_code = '000300.SH'", [day]
    ).fetchall()
    if not local:
        skip("沪深300 与 akshare 一致", "本地无指数数据")
        return
    local_ret = local[0][0]

    try:
        df = ak.index_zh_a_hist(
            symbol="000300", period="daily",
            start_date=pd.to_datetime(day).strftime("%Y%m%d"),
            end_date=pd.to_datetime(day).strftime("%Y%m%d"),
        )
        if df is not None and not df.empty:
            ak_ret = float(df.iloc[0]["涨跌幅"]) / 100
            diff = abs(ak_ret - local_ret)
            check("沪深300 与 akshare 一致", 0.0, round(diff, 6), 0.0002, note=f"东财 {ak_ret:.4%} vs local {local_ret:.4%}")
            return
    except Exception as e:
        print(f"  [warn] 东财指数不可用: {type(e).__name__}")

    try:
        idx = ak.stock_zh_index_daily(symbol="sh000300")
        idx["date"] = pd.to_datetime(idx["date"]).dt.date
        idx = idx.sort_values("date").reset_index(drop=True)
        target = pd.to_datetime(day).date()
        pos = idx.index[idx["date"] == target]
        if len(pos) == 0 or pos[0] == 0:
            skip("沪深300 与 akshare 一致", "新浪指数无当日数据")
            return
        i = int(pos[0])
        ak_ret = float(idx.loc[i, "close"]) / float(idx.loc[i - 1, "close"]) - 1
        diff = abs(ak_ret - local_ret)
        check("沪深300 与 akshare 一致", 0.0, round(diff, 6), 0.0002, note=f"新浪 {ak_ret:.4%} vs local {local_ret:.4%}")
    except Exception as e:
        skip("沪深300 与 akshare 一致", f"akshare 不可用: {type(e).__name__}")


def audit_limit_method(con, day: str = "2026-05-22") -> None:
    official = con.execute(
        "SELECT count(*) FROM core_limit_event WHERE trade_date = ? AND is_up", [day]
    ).fetchall()[0][0]
    price = con.execute(
        "SELECT count(*) FROM feat_stock WHERE trade_date = ? AND is_limit_up", [day]
    ).fetchall()[0][0]
    both = con.execute(
        """
        SELECT count(*) FROM core_limit_event e
        JOIN feat_stock f USING (ts_code, trade_date)
        WHERE e.trade_date = ? AND e.is_up AND f.is_limit_up
        """,
        [day],
    ).fetchall()[0][0]
    price_ex_st = con.execute(
        """
        SELECT count(*) FROM feat_stock
        WHERE trade_date = ? AND is_limit_up AND (up_limit / pre_close - 1) >= 0.06
        """,
        [day],
    ).fetchall()[0][0]
    st_n = price - price_ex_st
    union = official + price - both
    jac = both / union if union else 0
    # Tushare limit_list_d 不含 ST/风险警示股；价格口径含 5% 涨停，剔除后再对比。
    check(
        "涨停口径 vs 官方（剔除5%）",
        official,
        price_ex_st,
        max(2, round(official * 0.03)),
        note=f"{day} 官方 {official} / 非5% {price_ex_st} / 含ST {st_n}",
    )

    print(f"  [info] {day}: official={official} price={price} ex_st={price_ex_st} st={st_n} overlap={both} jaccard={jac:.3f}")

    # 连板口径
    off_streak = con.execute(
        "SELECT max(limit_times) FROM core_limit_event WHERE trade_date = ? AND is_up", [day]
    ).fetchall()[0][0]
    our_streak = con.execute(
        "SELECT max(limit_streak) FROM feat_stock WHERE trade_date = ?", [day]
    ).fetchall()[0][0]
    print(f"  [info] {day}: 官方最高连板={off_streak} 价格口径={our_streak}")

    mrow = con.execute(
        "SELECT limit_up_non5pct_n, limit_up_5pct_n, broken_rate FROM mart_market_day WHERE trade_date = ?", [day]
    ).fetchdf()
    if len(mrow):
        r = mrow.iloc[0]
        check("5%限制涨停家数（非ST身份）", st_n, r.limit_up_5pct_n, 0, note=f"{day}")
        check("非5%涨停与官方差异", official, r.limit_up_non5pct_n, max(2, round(official * 0.03)))
        broken = con.execute(
            "SELECT count(*) FROM core_limit_event WHERE trade_date = ? AND is_broken", [day]
        ).fetchall()[0][0]
        if r.broken_rate == r.broken_rate:
            check("炸板率（官方分母）", broken / (official + broken), r.broken_rate, 1e-12)


def audit_integrity(con, day: str) -> None:
    """批量一致性：派生表 vs 原始表 / 聚合 vs 明细。"""
    # 1) feat_stock vs core_stock_day（价格、收益、成交额、复权）
    fv = con.execute(
        """
        SELECT count(*) n,
               count(*) FILTER (WHERE abs(f.close - c.close) > 0.001) bad_close,
               count(*) FILTER (WHERE abs(f.ret - c.pct_chg / 100.0) > 1e-9) bad_ret,
               count(*) FILTER (WHERE abs(f.amount - c.amount) > 0.001) bad_amt,
               count(*) FILTER (WHERE abs(f.adj_close - c.close * c.adj_factor) > 0.01) bad_adj
        FROM feat_stock f JOIN core_stock_day c USING (ts_code, trade_date)
        WHERE f.trade_date = ? AND NOT f.is_new_stock
        """,
        [day],
    ).fetchdf().iloc[0]
    missing = con.execute("""WITH expected AS (
        SELECT ts_code, trade_date FROM core_stock_day
        WHERE trade_date=? AND (ts_code LIKE '%.SH' OR ts_code LIKE '%.SZ')
          AND close>0 AND adj_factor>0 AND pct_chg>-100 AND adj_close>0
          AND isfinite(close) AND isfinite(adj_factor) AND isfinite(pct_chg) AND isfinite(adj_close)
    ), actual AS (SELECT ts_code,trade_date FROM feat_stock WHERE trade_date=?)
    SELECT count(*) FROM expected e FULL OUTER JOIN actual a USING(ts_code,trade_date)
    WHERE e.ts_code IS NULL OR a.ts_code IS NULL""", [day, day]).fetchone()[0]
    check("feat/core 有效键集合一致", 0, int(missing), 0)
    check("feat 收盘价 = core", 0, int(fv.bad_close), 0)
    check("feat 收益 = pct_chg/100", 0, int(fv.bad_ret), 0)
    check("feat 成交额 = core（千元）", 0, int(fv.bad_amt), 0)
    check("adj_close = close × adj_factor", 0, int(fv.bad_adj), 0)

    # 2) 行业聚合全量对比
    sec = con.execute(
        """
        WITH s AS (
            SELECT sw_l1,
                   count(*) n,
                   avg(ret) ew,
                   count(*) FILTER (WHERE ret > 0)::DOUBLE /
                       nullif(count(*) FILTER (WHERE ret > 0) + count(*) FILTER (WHERE ret < 0), 0) breadth,
                   quantile_cont(ret, 0.75) - quantile_cont(ret, 0.25) iqr
            FROM feat_stock
            WHERE trade_date = ? AND NOT is_new_stock AND sw_l1 <> '未分类'
            GROUP BY sw_l1
        )
        SELECT count(*) bad
        FROM s FULL OUTER JOIN (SELECT * FROM mart_sector_day WHERE trade_date=?) m USING (sw_l1)
        WHERE s.sw_l1 IS NULL OR m.sw_l1 IS NULL OR s.n <> m.n
          OR abs(s.ew - m.ew_ret) > 1e-9
          OR s.breadth IS DISTINCT FROM m.breadth AND
             (s.breadth IS NULL OR m.breadth IS NULL OR abs(s.breadth - m.breadth) > 1e-12)
          OR abs(s.iqr - m.iqr) > 1e-9
        """,
        [day, day],
    ).fetchall()[0][0]
    check("31 行业聚合全部一致", 0, int(sec), 0)

    # 3) 最新个股快照
    snap = con.execute(
        """
        WITH expected AS (
            SELECT * FROM feat_stock WHERE trade_date <= ?
            QUALIFY row_number() OVER (PARTITION BY ts_code ORDER BY trade_date DESC)=1
        )
        SELECT count(*) bad
        FROM mart_stock_latest l FULL OUTER JOIN expected f USING (ts_code)
        WHERE l.ts_code IS NULL OR f.ts_code IS NULL
           OR l.quote_date IS DISTINCT FROM f.trade_date
           OR l.trade_date IS DISTINCT FROM ?::DATE
           OR l.is_stale IS DISTINCT FROM (f.trade_date < ?::DATE)
           OR l.close IS DISTINCT FROM f.close OR l.circ_mv IS DISTINCT FROM f.circ_mv
           OR l.ret IS DISTINCT FROM (CASE WHEN f.trade_date = ?::DATE THEN f.ret ELSE 0 END)
           OR l.sw_l1 IS DISTINCT FROM f.sw_l1
        """,
        [day, day, day, day],
    ).fetchall()[0][0]
    check("个股最新快照全部一致", 0, int(snap), 0)

    # 4) 月度复利
    mon = con.execute(
        """
        WITH d AS (
            SELECT sw_l1, date_trunc('month', trade_date)::DATE m,
                   exp(sum(ln(1 + ew_ret))) - 1 cum
            FROM mart_sector_day
            WHERE trade_date >= (SELECT date_trunc('month', max(trade_date) - INTERVAL 400 DAY) FROM mart_sector_day)
            GROUP BY 1, 2
        )
        SELECT count(*) bad FROM d FULL OUTER JOIN (
            SELECT * FROM mart_sector_month WHERE month >=
            (SELECT date_trunc('month', max(trade_date) - INTERVAL 400 DAY) FROM mart_sector_day)
        ) sm
          ON d.sw_l1 = sm.sw_l1 AND d.m = sm.month
        WHERE d.sw_l1 IS NULL OR sm.sw_l1 IS NULL
           OR (d.cum IS DISTINCT FROM sm.ew_ret_cum AND
               (d.cum IS NULL OR sm.ew_ret_cum IS NULL OR abs(d.cum - sm.ew_ret_cum) > 1e-9))
        """,
    ).fetchall()[0][0]
    check("行业月度累计 = 日度复利", 0, int(mon), 0)


def audit_payload(con, day: str) -> None:
    p = ROOT / "data" / "static-data.json"
    if not p.exists():
        check("静态 payload 存在", True, False, 0, kind="bool")
        return
    d = json.loads(p.read_text(encoding="utf-8"))
    last = d["market"][-1]
    m = con.execute("SELECT * FROM mart_market_day WHERE trade_date = ?", [day]).fetchdf().iloc[0]
    check("payload 最新日期", m.trade_date.strftime("%Y-%m-%d"), str(last["trade_date"])[:10], 0, kind="str")
    for k in ["breadth", "ew_ret", "cw_ret", "top10_share", "amount", "limit_up_n"]:
        tol = 0.01 if k == "amount" else 1e-3
        check(f"payload {k}", m[k], last[k], tol)
    check("payload 个股数", int(m.n_valid), len(d["stocks"]), 0)
    print(f"  [info] payload stocks={len(d['stocks'])}, sectors={len(d['sectors'])}, rotation={len(d.get('rotation', []))}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="audit date YYYY-MM-DD (default: latest mart date)")
    ap.add_argument("--samples", type=int, default=20)
    args = ap.parse_args()
    con = duckdb.connect(str(ROOT / "data" / "lake.duckdb"), read_only=True)
    day = args.date or str(con.execute("SELECT max(trade_date) FROM mart_market_day").fetchall()[0][0])

    print(f"== 审计交易日 {day} ==")
    print("[1] 市场指标")
    audit_market(con, day)
    print("[2] 行业指标")
    audit_sectors(con, day)
    print("[3] 个股抽样 vs akshare")
    audit_stocks_vs_akshare(con, day, args.samples)
    print("[4] 指数 vs akshare")
    audit_index_vs_akshare(con, day)
    print("[5] 涨停口径校验（历史官方数据）")
    if con.execute("SELECT count(*) FROM core_limit_event WHERE trade_date=?", [day]).fetchall()[0][0]:
        audit_limit_method(con, day)
    else:
        skip("涨跌停事件口径", "指定日期无事件记录，不能用历史另一天冒充验证")
    print("[6] 批量一致性")
    audit_integrity(con, day)
    print("[7] 静态 payload 一致性")
    audit_payload(con, day)
    con.close()

    passed = [r for r in RESULTS if r["ok"] is True]
    fails = [r for r in RESULTS if r["ok"] is False]
    skips = [r for r in RESULTS if r["ok"] is None]
    print(f"\n== 结果：{len(passed)} 通过 / {len(fails)} 失败 / {len(skips)} 跳过（共 {len(RESULTS)}）==")
    for r in fails:
        print("  FAIL", r["item"], "expected", r["expected"], "actual", r["actual"], "diff", r["diff"], r["note"])
    for r in skips:
        print("  SKIP", r["item"], r["note"])

    lines = [
        f"# 数据审计报告 · {day}",
        "",
        f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 样本：{len(RESULTS)} 项检查 · {len(passed)} 通过 · {len(fails)} 失败 · {len(skips)} 跳过",
        "",
        "| 检查项 | 期望/原始 | 实际/mart | 差异 | 结果 | 备注 |",
        "|---|---:|---:|---:|:--:|---|",
    ]
    for r in RESULTS:
        exp = f"{r['expected']:.6g}" if isinstance(r["expected"], (int, float)) else str(r["expected"])
        act = f"{r['actual']:.6g}" if isinstance(r["actual"], (int, float)) else str(r["actual"])
        diff = "" if r["diff"] is None else f"{r['diff']:.6g}"
        mark = "✅" if r["ok"] is True else "❌" if r["ok"] is False else "⏭️"
        lines.append(f"| {r['item']} | {exp} | {act} | {diff} | {mark} | {r['note']} |")
    (ROOT / "docs" / "audit_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("[written] docs/audit_report.md")
    if fails:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
