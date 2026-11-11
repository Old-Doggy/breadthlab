import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, pct, ratio, shortDate, trendClass } from "../lib/format";
import { returnBreadth } from "../lib/charts";
import { concentrationChart, dispersionChart } from "../lib/charts2";
import EChart from "../components/EChart";
import { Card } from "../components/Card";
import { PageHead } from "../components/PageHead";
import { Segmented } from "../components/Segmented";

const RANGES = [
  { value: "3M", label: "3M", n: 66 },
  { value: "6M", label: "6M", n: 130 },
  { value: "1Y", label: "1Y", n: 250 },
  { value: "3Y", label: "3Y", n: 750 },
  { value: "ALL", label: "ALL", n: 99999 },
] as const;

type RangeKey = (typeof RANGES)[number]["value"];

export default function Market() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const [params, setParams] = useSearchParams();
  const range = (params.get("range") as RangeKey) || "1Y";

  const setRange = (r: RangeKey) => {
    const next = new URLSearchParams(params);
    next.set("range", r);
    setParams(next, { replace: true });
  };

  const { data: series } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });

  const rows = useMemo(() => {
    if (!series) return [];
    const n = RANGES.find((r) => r.value === range)?.n ?? 250;
    return series.slice(-n);
  }, [series, range]);

  if (!series) {
    return (
      <div className="flex flex-col gap-3.5">
        <div className="skeleton h-[92px] w-full" />
        <div className="skeleton h-[92px] w-full" />
        <div className="skeleton h-[420px] w-full" />
      </div>
    );
  }

  const cum = rows.reduce((a, r) => a * (1 + r.ew_ret), 1) - 1;
  const avgBreadth = rows.reduce((a, r) => a + r.breadth, 0) / rows.length;
  const maxB = rows.reduce((a, r) => (r.breadth > a.breadth ? r : a), rows[0]);
  const minB = rows.reduce((a, r) => (r.breadth < a.breadth ? r : a), rows[0]);
  const maxC = rows.reduce((a, r) => ((r.top10_share || 0) > (a.top10_share || 0) ? r : a), rows[0]);
  const avgCsd = rows.reduce((a, r) => a + r.csd, 0) / rows.length;
  const last = rows[rows.length - 1];
  const prev = series[series.length - 2];
  const breadthValues = [...rows].map((r) => r.breadth).sort((a, b) => a - b);
  const medBreadth = breadthValues[Math.floor(breadthValues.length / 2)];

  const stats = [
    {
      k: zh ? "区间等权累计" : "Cumulative EW",
      v: pct(cum),
      tone: trendClass(cum),
      s: `${rows.length} ${zh ? "个交易日" : "sessions"}`,
    },
    {
      k: zh ? "平均广度" : "Average breadth",
      v: ratio(avgBreadth, 0),
      tone: "",
      s: `${zh ? "中位" : "median"} ${ratio(medBreadth, 0)}`,
    },
    {
      k: zh ? "广度最高日" : "Broadest day",
      v: shortDate(maxB.trade_date),
      tone: "",
      s: `${ratio(maxB.breadth, 0)} · ${pct(maxB.ew_ret)}`,
    },
    {
      k: zh ? "广度最低日" : "Narrowest day",
      v: shortDate(minB.trade_date),
      tone: "",
      s: `${ratio(minB.breadth, 0)} · ${pct(minB.ew_ret)}`,
    },
    {
      k: zh ? "最集中日" : "Most concentrated",
      v: shortDate(maxC.trade_date),
      tone: "",
      s: `Top10 波动占比 ${ratio(maxC.top10_share, 0)} · CSD ${(avgCsd * 100).toFixed(2)}pp`,
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead
        kicker={`${zh ? "市场结构" : "Market structure"} / ${last.trade_date} · ${rows.length}D`}
        title={zh ? "指数与等权，走势差多少" : "Index vs equal-weight"}
        dek={
          zh
            ? `过去 ${rows.length} 个交易日，全市场等权累计 ${pct(cum)}，平均广度 ${ratio(avgBreadth, 0)}；逐日收益、广度与集中度见下方图表`
            : `Over the last ${rows.length} sessions the equal-weight market returned ${pct(cum)} with average breadth ${ratio(avgBreadth, 0)}`
        }
        chips={
          <>
            <span className="pill">{zh ? "等权" : "Equal-weight"}</span>
            <span className="pill">{zh ? "日频" : "Daily"}</span>
            <span className="pill">{zh ? "股票池：沪深主板 + 创业板 + 科创板" : "Universe: SSE/SZSE main + ChiNext + STAR"}</span>
          </>
        }
        right={<Segmented options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={range} onChange={setRange} />}
      />

      <div className="card grid grid-cols-2 divide-x divide-[var(--border)] md:grid-cols-3 xl:grid-cols-5">
        {stats.map((s) => (
          <div key={s.k} className="px-4 py-4">
            <div className="truncate text-[12px] leading-none text-[var(--muted)]">{s.k}</div>
            <div className={`mono mt-2 text-[25px] leading-none tracking-[-0.04em] md:text-[27px] ${s.tone}`}>{s.v}</div>
            <div className="mono mt-2 truncate text-[12px] text-[var(--faint)]">{s.s}</div>
          </div>
        ))}
      </div>

      <Card
        index="01"
        title={zh ? "收益 × 广度" : "Return × breadth"}
        subtitle={
          zh
            ? "柱 = 等权日收益 · 线 = 沪深300 · 虚线 = 流通市值加权 · 下 = 上涨股票占比"
            : "Bars = EW return · Solid = CSI 300 · Dotted = cap-weight · Lower = breadth"
        }
        right={<span className="pill">{rows[0]?.trade_date} → {last.trade_date}</span>}
        prov={zh ? "等权收益为全市场算术平均；沪深300 为指数日收益；广度为上涨 /（上涨 + 下跌）" : "EW mean return; CSI 300 index return; breadth = adv / (adv + dec)"}
        padded={false}
        bodyClass="pt-0"
        footer={
          <div className="provline">
            <span>SOURCE <b>daily / daily_basic / index_daily</b></span>
            <span>N <b>{rows.length}</b></span>
            <span>{zh ? "等权" : "EW"}</span>
            <span>{zh ? "截尾 1% / 99%" : "clipped 1% / 99%"}</span>
            <a className="r hover:underline" href="#/about">{zh ? "口径说明 →" : "Method →"}</a>
          </div>
        }
      >
        <div className="h-[380px] px-1 pb-1 md:h-[420px] md:px-2">
          <EChart option={returnBreadth(p, rows, lang)} ariaLabel={zh ? "区间收益与广度" : "Return and breadth"} />
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-6">
          <Card
            index="02"
            title={zh ? "集中度：Top10 波动占比" : "Concentration"}
            subtitle={zh ? "柱：周均 Top10 波动占比；线：20 日均值" : "Bars: weekly average Top10 share; line: 20-day average"}
            right={
              <div className="flex items-center gap-3 text-[10.5px] text-[var(--faint)]">
                <span className="flex items-center gap-1">
                  <i className="inline-block h-[7px] w-[3px] rounded-sm" style={{ background: p.text2, opacity: 0.5 }} />
                  {zh ? "周均" : "weekly"}
                </span>
                <span className="flex items-center gap-1">
                  <i className="inline-block h-[2px] w-4" style={{ background: p.accent }} />
                  20D
                </span>
              </div>
            }
            prov={zh ? "Top10 全市场流通市值权重股贡献 = Σ（前一日全市场流通市值权重 × 收益）/ 全市场市值加权收益；Top5% 为涨幅前 5% 股票的正收益份额" : "Top-10 contribution and top-5% gain share"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>daily / daily_basic</b></span>
                <span>{zh ? "前一日全市场流通市值权重" : "prior-day float-cap weights"}</span>
                <span className="r">{zh ? "周均 = 5 个交易日平均" : "weekly = 5 sessions"}</span>
              </div>
            }
          >
            <div className="h-[242px] px-1 pb-1 md:px-2">
              <EChart option={concentrationChart(p, rows, lang)} />
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-6">
          <Card
            index="03"
            title={zh ? "分化度：横截面离散" : "Dispersion"}
            subtitle={zh ? "实线 CSD（灰）· 实线 IQR（金）· 以及等权与流通市值加权的差距" : "Solid CSD (gray) and IQR (gold), plus the EW−CW gap"}
            right={
              <div className="flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
                <span className="inline-block h-[2px] w-3" style={{ background: p.accent }} />
                CSD
                <span className="inline-block h-[2px] w-3" style={{ background: p.accent }} />
                IQR
              </div>
            }
            prov={zh ? "CSD = 横截面收益标准差；IQR = 75 分位 − 25 分位" : "CSD = cross-sectional std; IQR = q75 − q25"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>daily</b></span>
                <span>{zh ? "全市场" : "all A-shares"}</span>
                <span className="r">{zh ? "越高 = 个股越分化" : "higher = more dispersed"}</span>
              </div>
            }
          >
            <div className="h-[242px] px-1 pb-1 md:px-2">
              <EChart option={dispersionChart(p, rows, lang)} />
            </div>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 pt-0.5 text-[10.5px] text-[var(--faint)]">
        <span className="font-mono">
          {zh ? "数据源：Tushare Pro · daily / daily_basic / index_daily" : "Source: Tushare Pro · daily / daily_basic / index_daily"}
        </span>
        <span className="mono">
          {last.trade_date} · {zh ? "日均成交额" : "avg turnover"} {money(rows.reduce((a, r) => a + r.amount, 0) / rows.length)}
          {prev ? ` · ${zh ? "前值" : "prev"} ${shortDate(prev.trade_date)}` : ""}
        </span>
      </div>
    </div>
  );
}
