"""用真实数据生成 docs/insights/I01–I10.md 的证据文档。"""
from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
LAKE = ROOT / "data" / "lake.duckdb"
OUT = ROOT / "docs" / "insights"


def main() -> None:
    con = duckdb.connect(str(LAKE), read_only=True)
    OUT.mkdir(parents=True, exist_ok=True)
    q = lambda sql, p=None: con.execute(sql, p or []).fetchdf()

    m = q("SELECT * FROM mart_market_day WHERE trade_date >= '2018-01-01' ORDER BY trade_date")
    s = q("SELECT * FROM mart_sector_day WHERE trade_date >= '2018-01-01' ORDER BY trade_date")
    n_days = len(m)

    def table(df: pd.DataFrame, cols: list[str], fmt: dict[str, str] | None = None) -> str:
        fmt = fmt or {}
        head = "| " + " | ".join(cols) + " |\n|" + "---|" * len(cols) + "\n"
        body = ""
        for _, r in df.iterrows():
            cells = []
            for c in cols:
                v = r[c]
                if hasattr(v, "strftime"):
                    cells.append(v.strftime("%Y-%m-%d"))
                elif isinstance(v, float):
                    cells.append(fmt.get(c, "{:.2f}").format(v))
                else:
                    cells.append(str(v))
            body += "| " + " | ".join(cells) + " |\n"
        return head + body

    def save(name: str, title: str, question: str, definition: str, evidence: str, sample: str, chart: str, boundary: str) -> None:
        text = f"""# {name} · {title}

**问题**：{question}

**口径**：{definition}

**证据**：{evidence}

{sample}

**图表位置**：{chart}

**边界**：{boundary}
"""
        (OUT / f"{name}.md").write_text(text, encoding="utf-8")

    # I1
    i1 = m[(m.hs300_ret > 0) & (m.breadth < 0.45)]
    top1 = i1.sort_values("hs300_ret", ascending=False).head(3)[["trade_date", "hs300_ret", "ew_ret", "breadth", "top10_share"]]
    save(
        "I01", "指数涨 ≠ 多数股票涨",
        "指数上涨时，是否真的有足够多的股票参与？",
        "`hs300_ret > 0` 且 `breadth < 45%`；收益为官方 pct_chg/100，广度剔除平盘。",
        f"2018 年以来 {n_days} 个交易日中，**{len(i1)} 天**（{len(i1)/n_days:.1%}）出现“指数收涨但不足 45% 股票上涨”。",
        table(top1, ["trade_date", "hs300_ret", "ew_ret", "breadth", "top10_share"],
              {"hs300_ret": "{:+.2%}", "ew_ret": "{:+.2%}", "breadth": "{:.1%}", "top10_share": "{:.0%}"}),
        "Market 页双联图（上：收益 / 下：广度）；Regime 页右下象限。",
        "指数受权重与成分调整影响；本结论只说明“指数方向≠广度”，不推断后续收益。",
    )

    # I2
    i2 = m[m.top10_share > 0.5]
    top2 = i2.sort_values("top10_share", ascending=False).head(3)[["trade_date", "top10_share", "gain_share_top5pct", "ew_ret"]]
    save(
        "I02", "涨幅集中在少数股票",
        "指数的涨跌，有多少由少数权重股贡献？",
        "`top10_share = Σ_{Top10权重}|w·r| / Σ|w·r|`（有界 0–1）；`gain_share_top5pct` 为涨幅前 5% 股票的正收益份额。",
        f"Top10 权重股贡献了当日波动的一半以上的天数：**{len(i2)} 天**（{len(i2)/n_days:.1%}）；全样本均值 {m.top10_share.mean():.1%}。",
        table(top2, ["trade_date", "top10_share", "gain_share_top5pct", "ew_ret"],
              {"top10_share": "{:.1%}", "gain_share_top5pct": "{:.1%}", "ew_ret": "{:+.2%}"}),
        "Market 页集中度副图（20 日均值 + 日值浅柱）；Today 页 Top10 贡献 KPI。",
        "Top10 由前一日流通市值决定；权重股横盘时该指标会偏低，需与广度一起读。",
    )

    # I3
    i3 = s[(s.ew_ret > 0.01) & (s.breadth < 0.35)]
    top3 = i3.sort_values("ew_ret", ascending=False).head(3)[["trade_date", "sw_l1", "ew_ret", "breadth", "n"]]
    save(
        "I03", "行业高收益 ≠ 行业内普涨",
        "行业涨幅是多数成分股共同形成，还是少数龙头拉动？",
        "行业等权收益 > 1% 且行业内上涨占比 < 35%。",
        f"2018 年以来出现 **{len(i3)} 个**“高收益 + 低广度”的行业-日，占全部行业-日 {len(i3)/len(s):.2%}。",
        table(top3, ["trade_date", "sw_l1", "ew_ret", "breadth", "n"],
              {"ew_ret": "{:+.2%}", "breadth": "{:.0%}"}),
        "Sectors 页气泡图（左上：权重拖累；右下：集中上涨）。",
        "行业分类为静态映射，历史归属存在前视偏差；样本数 n 很小时结论不稳。",
    )

    # I4
    top4 = s.sort_values("iqr", ascending=False).head(3)[["trade_date", "sw_l1", "ew_ret", "med_ret", "iqr", "n"]]
    save(
        "I04", "行业均值掩盖个股分化",
        "行业平均收益，能否代表行业内部每只股票？",
        "`sector_IQR = q75 − q25`；同时看 `|mean − median|`。",
        f"行业-日 IQR 中位数 {s.iqr.median():.2%}，95 分位 {s.iqr.quantile(0.95):.2%}；IQR > 5pp 的行业-日 {int((s.iqr>0.05).sum())} 个。",
        table(top4, ["trade_date", "sw_l1", "ew_ret", "med_ret", "iqr", "n"],
              {"ew_ret": "{:+.2%}", "med_ret": "{:+.2%}", "iqr": "{:.2%}"}),
        "Sectors 页行业内分布；Stocks 页分布直方图与市值分层散点。",
        "IQR 对极端值不敏感，但小样本行业（n<20）波动大。",
    )

    # I5
    top5 = m.reindex(m.ew_cw_gap.abs().sort_values(ascending=False).index).head(3)[["trade_date", "ew_ret", "cw_ret", "ew_cw_gap", "breadth"]]
    save(
        "I05", "大小盘分裂",
        "指数（市值加权）与等权收益背离时，市场内部发生了什么？",
        "`ew_cw_gap = EW − CW`；CW 用前一日 circ_mv 加权。",
        f"|EW−CW| > 1pp 的天数 **{int((m.ew_cw_gap.abs()>0.01).sum())}**（{(m.ew_cw_gap.abs()>0.01).mean():.1%}）；最大 {m.ew_cw_gap.abs().max():.2%}。",
        table(top5, ["trade_date", "ew_ret", "cw_ret", "ew_cw_gap", "breadth"],
              {"ew_ret": "{:+.2%}", "cw_ret": "{:+.2%}", "ew_cw_gap": "{:+.2%}", "breadth": "{:.0%}"}),
        "Market 页分化度副图；Today 页等权 vs 市值加权。",
        "这是“风格差异”的代理，不是严格的大小盘因子（未做市值五分组）。",
    )

    # I6
    i6 = m[(m.limit_up_n >= 80) & (m.breadth < 0.45)]
    top6 = i6.sort_values("limit_up_n", ascending=False).head(3)[["trade_date", "limit_up_n", "breadth", "ew_ret", "max_streak"]]
    save(
        "I06", "情绪极值 ≠ 参与广度",
        "涨停很多的日子，是全面回暖还是局部狂欢？",
        "`limit_up_n ≥ 80` 且 `breadth < 45%`；涨停由 stk_limit 真实涨停价判定。",
        f"2018 年以来 **{len(i6)} 天**出现“涨停≥80 家但广度<45%”，占 {len(i6)/n_days:.1%}。",
        table(top6, ["trade_date", "limit_up_n", "breadth", "ew_ret", "max_streak"],
              {"breadth": "{:.0%}", "ew_ret": "{:+.2%}"}),
        "Sentiment 页涨跌停柱 + 广度折线；Today 页涨停/炸板 KPI。",
        "2026-05 之后无 limit_list_d 权限，炸板率缺失；涨停家数仍完整。",
    )

    # I7
    corr = m.csd.corr(m.hs300_ret.abs())
    big = m[m.hs300_ret.abs() > 0.015].csd.mean()
    small = m[m.hs300_ret.abs() < 0.005].csd.mean()
    save(
        "I07", "分化度抬升伴随波动放大",
        "个股分化与指数波动是否同步？",
        "横截面收益标准差 `csd` 与 |沪深300 日收益| 的相关系数；分组均值。",
        f"全样本相关系数 **{corr:.2f}**；|指数收益|>1.5% 的日子平均 CSD {big:.2%}，<0.5% 的日子 {small:.2%}。",
        "",
        "Market 页分化度副图；Regime 页点大小/位置。",
        "同步不等于因果；CSD 也受涨跌停与极端个股影响。",
    )

    # I8 rotation
    piv = s.pivot_table(index="trade_date", columns="sw_l1", values="ew_ret")
    cum = (1 + piv.fillna(0)).cumprod()
    r20 = cum.pct_change(20)
    rank = r20.rank(axis=1, ascending=False)
    rot = rank.diff().abs().mean(axis=1).dropna()
    top8 = rot.sort_values(ascending=False).head(3)
    save(
        "I08", "轮动强度刻画行情性质",
        "行业排名迁移速度，能否区分单边行情与快速轮动？",
        "`rotation_intensity_t = mean_i |rank_{i,t} − rank_{i,t−1}|`，排名按 20 日累计收益。",
        f"2018 年以来轮动强度均值 **{rot.mean():.2f} 名/日**，95 分位 {rot.quantile(0.95):.2f}；最高 {rot.max():.2f}。",
        table(pd.DataFrame({"trade_date": top8.index, "rotation": top8.values}), ["trade_date", "rotation"], {"rotation": "{:.2f}"}),
        "Sectors 页轮动视图（规划中）；当前可用行业热力图观察轮动。",
        "排名基于 20 日窗口，窗口选择会改变强度绝对值；只做相对比较。",
    )

    # I9
    lev = m.dropna(subset=["rzye"]).copy()
    lev["drzye"] = lev.rzye.pct_change()
    c1 = lev.drzye.corr(lev.breadth)
    c2 = m.flow_breadth.corr(m.breadth)
    save(
        "I09", "杠杆/资金是背景，不是原因",
        "两融与资金流，能否解释当日广度？",
        "两融余额日环比 vs breadth；资金流广度（净流入为正的股票占比）vs breadth。",
        f"两融环比与 breadth 相关系数 **{c1:.2f}**；资金流广度与 breadth 相关系数 **{c2:.2f}**。",
        "",
        "Sentiment 页底部两融/资金流卡片。",
        "仅为同步性描述，不构成因果；两融 T+1 发布。",
    )

    # I10 sample book
    codes = ["600519.SH", "300750.SZ", "688981.SH", "600036.SH", "002594.SZ", "300059.SZ"]
    last = m.iloc[-1].trade_date
    book = q(
        "SELECT ts_code, name, ret FROM feat_stock WHERE trade_date = ? AND ts_code IN (" + ",".join(["?"] * len(codes)) + ")",
        [last] + codes,
    )
    ew = book.ret.mean() if len(book) else 0
    save(
        "I10", "我的组合被什么带动",
        "组合收益是普涨带来的，还是少数持仓贡献的？",
        "组合等权收益 vs 市场 EW；贡献 = 个股权重 × 收益；同时对比组合内上涨占比与市场广度。",
        f"以示例组合（{', '.join(book.name.tolist()) if len(book) else '—'}）为例：{last} 组合等权 {ew:+.2%}，市场 EW {m.iloc[-1].ew_ret:+.2%}，市场广度 {m.iloc[-1].breadth:.0%}。",
        table(book, ["ts_code", "name", "ret"], {"ret": "{:+.2%}"}) if len(book) else "",
        "Watchlist 页（等权组合、贡献分解、上涨占比）。",
        "当前为等权自选，不含股数/成本；持仓盈亏与 Brinson 归因在 Roadmap。",
    )

    print(json.dumps({"written": len(list(OUT.glob("I*.md"))), "days": n_days}, ensure_ascii=False))
    con.close()


if __name__ == "__main__":
    main()
