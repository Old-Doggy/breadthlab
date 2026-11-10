import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { palettes } from "../lib/theme";
import { money, pct, ratio, shortDate, trendClass } from "../lib/format";
import { returnBreadth } from "../lib/charts";
import { concentrationChart, dispersionChart } from "../lib/charts2";
import EChart from "../components/EChart";
import { Card, MicroLabel } from "../components/Card";
import { Segmented } from "../components/Segmented";

const RANGES = [
  { value: "3M", label: "3M", n: 66 },
  { value: "6M", label: "6M", n: 130 },
  { value: "1Y", label: "1Y", n: 250 },
  { value: "3Y", label: "3Y", n: 750 },
  { value: "ALL", label: "ALL", n: 99999 },
] as const;

type RangeKey = (typeof RANGES)[number]["value"];

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <MicroLabel>{label}</MicroLabel>
      <div className={`mono mt-2 text-[17px] font-semibold ${tone || "text-[var(--text)]"}`}>{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

export default function Market() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme } = useUI();
  const p = palettes[theme];
  const [range, setRange] = useState<RangeKey>("1Y");

  const { data: series } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });

  const rows = useMemo(() => {
    if (!series) return [];
    const n = RANGES.find((r) => r.value === range)?.n ?? 250;
    return series.slice(-n);
  }, [series, range]);

  if (!series) {
    return <div className="skeleton h-[520px] w-full" />;
  }

  const cum = rows.reduce((a, r) => a * (1 + r.ew_ret), 1) - 1;
  const avgBreadth = rows.reduce((a, r) => a + r.breadth, 0) / rows.length;
  const maxB = rows.reduce((a, r) => (r.breadth > a.breadth ? r : a), rows[0]);
  const minB = rows.reduce((a, r) => (r.breadth < a.breadth ? r : a), rows[0]);
  const maxC = rows.reduce((a, r) => ((r.top10_share || 0) > (a.top10_share || 0) ? r : a), rows[0]);
  const avgCsd = rows.reduce((a, r) => a + r.csd, 0) / rows.length;
  const last = rows[rows.length - 1];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">{t("market.title")}</h1>
          <p className="mt-1 text-[12px] text-[var(--muted)]">{t("market.subtitle")}</p>
        </div>
        <Segmented options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label={lang === "en" ? "Cumulative equal-weight" : "区间等权累计收益"}
          value={pct(cum)}
          tone={trendClass(cum)}
          sub={`${rows.length} ${lang === "en" ? "sessions" : "个交易日"}`}
        />
        <StatTile
          label={lang === "en" ? "Average breadth" : "平均上涨占比"}
          value={ratio(avgBreadth, 0)}
          sub={lang === "en" ? `latest ${ratio(last.breadth, 0)}` : `最新 ${ratio(last.breadth, 0)}`}
        />
        <StatTile
          label={lang === "en" ? "Broadest day" : "广度最高日"}
          value={shortDate(maxB.trade_date)}
          sub={`${ratio(maxB.breadth, 0)} · ${pct(maxB.ew_ret)}`}
          tone="down"
        />
        <StatTile
          label={lang === "en" ? "Narrowest day" : "广度最低日"}
          value={shortDate(minB.trade_date)}
          sub={`${ratio(minB.breadth, 0)} · ${pct(minB.ew_ret)}`}
          tone="up"
        />
        <StatTile
          label={lang === "en" ? "Most concentrated" : "最集中日"}
          value={shortDate(maxC.trade_date)}
          sub={`Top10 ${ratio(maxC.top10_share, 0)} · CSD ${(avgCsd * 100).toFixed(2)}pp`}
        />
      </div>

      <Card
        title={t("market.returnBreadth")}
        subtitle={
          lang === "en"
            ? "Bars: equal-weight return · dotted: cap-weight · line: CSI 300 · bottom: breadth"
            : "柱：等权收益 · 点线：市值加权 · 实线：沪深300 · 下：上涨占比"
        }
        right={
          <span className="pill h-[22px] px-2 text-[10px]">
            {rows[0].trade_date} → {last.trade_date}
          </span>
        }
        padded={false}
        bodyClass="pt-1"
      >
        <div className="h-[400px] px-2 pb-2">
          <EChart option={returnBreadth(p, rows, lang)} />
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-6">
          <Card
            title={t("market.concentration")}
            subtitle={
              lang === "en"
                ? "Share of daily cross-sectional move carried by the top 10 weights · 20-day average"
                : "Top10 权重股在当日波动中的占比 · 20 日均值（浅色柱为日值）"
            }
            right={
              <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                <span className="inline-block h-[2px] w-3" style={{ background: p.accent }} />
                Top10
                <span className="inline-block h-[2px] w-3 border-t border-dashed" style={{ borderColor: p.up }} />
                Top5%
              </div>
            }
            padded={false}
            bodyClass="pt-1"
          >
            <div className="h-[248px] px-2 pb-2">
              <EChart option={concentrationChart(p, rows)} />
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-6">
          <Card
            title={t("market.dispersion")}
            subtitle={
              lang === "en"
                ? "Cross-sectional dispersion and the equal-weight vs cap-weight gap"
                : "横截面离散度，以及等权与市值加权的差距"
            }
            right={
              <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                <span className="inline-block h-[2px] w-3" style={{ background: p.text2 }} />
                CSD
                <span className="inline-block h-[2px] w-3" style={{ background: p.accent }} />
                IQR
              </div>
            }
            padded={false}
            bodyClass="pt-1"
          >
            <div className="h-[248px] px-2 pb-2">
              <EChart option={dispersionChart(p, rows)} />
            </div>
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-between pb-2 text-[10.5px] text-[var(--faint)]">
        <span>{lang === "en" ? "Source: daily / daily_basic / stk_limit · universe: SSE+SZSE" : "数据源：daily / daily_basic / stk_limit · 股票池：沪深主板+创业板+科创板"}</span>
        <span className="mono">
          {lang === "en" ? "avg turnover" : "日均成交额"} {money(rows.reduce((a, r) => a + r.amount, 0) / rows.length)}
        </span>
      </div>
    </div>
  );
}
