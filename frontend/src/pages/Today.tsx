import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, num, pct, ratio, shortDate, trendClass, weekday } from "../lib/format";
import { headline, regimeLabel, regimeOf } from "../lib/regime";
import { distributionChart, returnBreadth, sectorBubble } from "../lib/charts";
import EChart from "../components/EChart";
import { Card } from "../components/Card";
import { Kpi } from "../components/Kpi";
import { DataState } from "../components/DataState";
import { indexSummary, percentile } from "../lib/viewMetrics";
import { Prov } from "../components/PageHead";

const avg = (xs: number[]) => { const valid = xs.filter((x) => x != null && Number.isFinite(x)); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : NaN; };
const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

function Skeleton({ h = 320 }: { h?: number }) {
  return <div className="skeleton w-full" style={{ height: h }} />;
}

export default function Today() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);

  const { data: meta, isError: metaError, isPending: metaPending } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const end = meta?.last_trade_date;

  const { data: series, isError: seriesError, isPending: seriesPending } = useQuery({
    queryKey: ["market-series", end],
    queryFn: () => api.marketSeries(undefined, end),
    enabled: !!end,
  });

  const last = series && series.length ? series[series.length - 1] : undefined;
  const d = last?.trade_date;

  const { data: detail } = useQuery({
    queryKey: ["market-day", d],
    queryFn: () => api.marketDay(d as string),
    enabled: !!d,
  });
  const { data: dist } = useQuery({
    queryKey: ["distribution", d],
    queryFn: () => api.distribution(d as string),
    enabled: !!d,
  });

  if (metaError || seriesError) return <DataState error />;
  if ((!metaPending && !end) || (series && !series.length)) return <DataState />;
  if (!series || !last) {
    return (
      <div className="flex flex-col gap-3.5">
        <Skeleton h={208} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} h={92} />)}
        </div>
        <Skeleton h={380} />
      </div>
    );
  }

  const last120 = series.slice(-120);
  const last20 = series.slice(-21, -1);
  const regime = regimeOf(last);
  const tone = last.ew_ret >= 0 ? "up" : "down";
  const breadthPct = Math.round(last.breadth * 100);
  const prev = series[series.length - 2];
  const rank = series.slice(-250).filter((r) => r.breadth <= last.breadth).length;
  const breadthPctile = percentile(series.slice(-250).map((r) => r.breadth), last.breadth);
  const breadthRank = breadthPctile == null ? "—" : String(breadthPctile);
  const avg20Breadth = avg(last20.map((r) => r.breadth));
  const breadthDelta = last.breadth == null ? NaN : (last.breadth - avg20Breadth) * 100;

  const contributors = detail?.contributors || [];
  const topDrag = [...contributors].sort((a, b) => a.contrib - b.contrib)[0];
  const contrib = contributors.slice(0, 5);
  const maxAbs = Math.max(...contrib.map((c) => Math.abs(c.contrib)), 1e-9);

  const sectors = detail?.sectors || [];
  const boardTop = [...sectors].sort((a, b) => b.breadth - a.breadth).slice(0, 6);
  const leaderTilt = [...sectors]
    .filter((s) => s.n >= 30)
    .sort((a, b) => Math.abs(b.cw_ret - b.ew_ret) - Math.abs(a.cw_ret - a.ew_ret))
    .slice(0, 5);
  const maxTilt = Math.max(...leaderTilt.map((s) => Math.abs(s.cw_ret - s.ew_ret)), 0.0001);
  const broadSectors = sectors.filter((s) => s.breadth >= 0.6).length;
  const limitAverage = avg(last20.map((r) => r.limit_up_n));
  const limitRatio = last.limit_up_n == null || !(limitAverage > 0) ? null : last.limit_up_n / limitAverage;
  const sparkDates = series.slice(-21).map((r) => r.trade_date);

  const kpis = [
    {
      label: t("metric.breadth"),
      value: ratio(last.breadth, 0),
      tone: "neutral" as const,
      sub: `${num(last.n_adv)} ↑ / ${num(last.n_dec)} ↓ · ${zh ? `${breadthRank} 分位` : `${breadthPctile == null ? "—" : ord(breadthPctile)} pct`}`,
      to: "/regime",
      spark: series.slice(-21).map((r) => r.breadth),
      sparkTone: "accent" as const,
      hint: zh ? "广度 = 上涨家数 /（上涨 + 下跌），平盘剔除" : "Breadth = advancers / (advancers + decliners), flat excluded",
      main: true,
    },
    {
      label: t("metric.ew"),
      value: pct(last.ew_ret),
      tone: tone as "up" | "down",
      sub: `${t("metric.index")} ${pct(last.hs300_ret)}`,
      to: "/market",
      spark: series.slice(-21).map((r) => r.ew_ret),
      sparkTone: tone as "up" | "down",
      hint: zh ? "全市场算术平均收益，等权口径" : "Arithmetic mean return, equal-weighted",
    },
    {
      label: t("metric.limitUp"),
      value: num(last.limit_up_n),
      tone: "neutral" as const,
      sub: `${t("metric.limitDown")} ${num(last.limit_down_n)} · ${zh ? "最高" : "max"} ${last.max_streak ?? "—"} ${zh ? "板" : "boards"}`,
      to: "/sentiment",
      spark: series.slice(-21).map((r) => r.limit_up_n),
      sparkTone: "up" as const,
      hint: zh ? "收盘价 ≥ 涨停价 × 0.999 记为涨停" : "Close ≥ limit-up price × 0.999",
    },
    {
      label: t("metric.amount"),
      value: money(last.amount),
      tone: "neutral" as const,
      sub: `${zh ? "样本" : "Sample"} ${num(last.n_valid)} ${zh ? "只" : "stocks"}`,
      to: "/market",
      spark: series.slice(-21).map((r) => r.amount),
      sparkTone: "neutral" as const,
      hint: zh ? "全市场成交额，单位自适应" : "Total turnover, auto unit",
    },
    {
      label: t("metric.csd"),
      value: `${(last.csd * 100).toFixed(2)}pp`,
      tone: "neutral" as const,
      sub: `${t("metric.median")} ${pct(last.med_ret)} · IQR ${(last.iqr * 100).toFixed(2)}pp`,
      to: "/stocks",
      spark: series.slice(-21).map((r) => r.csd),
      sparkTone: "accent" as const,
      hint: zh ? "横截面收益标准差，衡量个股分化" : "Cross-sectional return dispersion",
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      {/* hero */}
      <section className="card relative overflow-hidden">
        <div className="grid gap-x-8 gap-y-5 p-4 md:grid-cols-[1.618fr_1fr] md:p-5 md:pb-3">
          <div className="min-w-0">
            <div className="kicker">
              {last.trade_date} · {weekday(last.trade_date, lang)} · {zh ? "收盘后" : "After close"}
              <span className="ml-auto hidden text-[var(--faint)] md:inline">{zh ? "盘面状态" : "MARKET STATE"}</span>
            </div>
            <h1 className="serif mt-2.5 max-w-[820px] break-words text-[22px] font-bold leading-[1.32] tracking-[-0.02em] text-[var(--text)] sm:text-[26px] md:text-[32px]">
              {headline(last, lang)}
            </h1>
            <p className="mt-2 max-w-[680px] text-[12.5px] leading-[1.7] text-[var(--text-2)]">
              {zh
                ? `${indexSummary(last.hs300_ret, last.ew_ret, lang)}；上涨广度位于近一年 ${breadthRank} 分位。`
                : `${indexSummary(last.hs300_ret, last.ew_ret, lang)}; breadth sits at the ${breadthPctile == null ? "—" : ord(breadthPctile)} percentile of the past year.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className={`pill border-transparent ${regime === "broad_up" || regime === "concentrated_up" ? "chip-up" : regime === "broad_down" ? "chip-down" : "chip-accent"}`}>
                {regimeLabel(regime, lang)}
              </span>
              <span className="pill">{zh ? `广度 ${breadthRank} 分位` : `${breadthPctile == null ? "—" : ord(breadthPctile)} breadth pct`}</span>
              <span className="pill">CSD {(last.csd * 100).toFixed(2)}pp</span>
              {topDrag && (
                <span className="pill chip-copper border-transparent">
                  {topDrag.name} {pct(topDrag.ret)}
                </span>
              )}

            </div>
          </div>

          <div className="grid grid-cols-3 items-center gap-0 self-center">
            {[
              { k: zh ? "上涨占比" : "Breadth", v: ratio(last.breadth, 0), s: `${num(last.n_adv)} / ${num(last.n_dec)}`, tone: "text" },
              { k: zh ? "等权收益" : "Equal-weight", v: pct(last.ew_ret), s: `${t("metric.index")} ${pct(last.hs300_ret)}`, tone: last.ew_ret >= 0 ? "up" : "down" },
              { k: zh ? "成交额" : "Turnover", v: money(last.amount), s: `${zh ? "20D 均值" : "20D avg"} ${money(avg(last20.map((r) => r.amount)))}`, tone: "text" },
            ].map((s, i) => (
              <div key={s.k} className={`min-w-0 ${i ? "border-l border-[var(--border)] pl-4" : ""}`}>
                <div className="micro truncate">{s.k}</div>
                <div className={`mono mt-1.5 whitespace-nowrap text-[20px] leading-none tracking-[-0.04em] sm:text-[24px] md:text-[28px] ${s.tone === "up" ? "text-[var(--up)]" : s.tone === "down" ? "text-[var(--down)]" : "text-[var(--text)]"}`}>
                  {s.v}
                </div>
                <div className="mono mt-1.5 truncate text-[10.5px] text-[var(--faint)]">{s.s}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* kpis */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to} className="block transition-transform hover:-translate-y-px">
            <Kpi {...k} sparkDates={sparkDates} />
          </Link>
        ))}
      </div>

      {/* chart + narrative */}
      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-8">
          <Card
            index="01"
            title={t("market.returnBreadth")}
            subtitle={
              zh
                ? "柱 = 全市场等权收益 · 线 = 沪深300 · 下 = 上涨股票占比 · 近 120 个交易日"
                : "Bars = equal-weight return · Line = CSI 300 · Lower = breadth · 120 sessions"
            }
            right={
              <div className="flex items-center gap-3 text-[10.5px] text-[var(--faint)]">
                <span className="flex items-center gap-1"><i className="inline-block h-[6px] w-[6px] rounded-[1px]" style={{ background: p.up }} />{zh ? "涨" : "up"}</span>
                <span className="flex items-center gap-1"><i className="inline-block h-[6px] w-[6px] rounded-[1px]" style={{ background: p.down }} />{zh ? "跌" : "down"}</span>
                <span className="flex items-center gap-1"><i className="inline-block h-[2px] w-3" style={{ background: p.accent }} />{zh ? "广度" : "breadth"}</span>
              </div>
            }
            prov={zh ? "等权收益 = 全市场算术平均；广度 = 上涨 /（上涨 + 下跌）" : "Equal-weight mean return; breadth = adv / (adv + dec)"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>daily / daily_basic</b></span>
                <span>N <b>{num(last.n_valid)}</b></span>
                <span>{zh ? "等权" : "equal-weight"}</span>
                <span>{zh ? "截尾 1% / 99%" : "clipped 1% / 99%"}</span>
                <a className="r hover:underline" href="#/about">{zh ? "口径说明 →" : "Method →"}</a>
              </div>
            }
          >
            <div className="h-[300px] px-1 pb-1 md:h-[356px] md:px-2">
              <EChart option={returnBreadth(p, last120, lang)} ariaLabel={zh ? "近 120 日等权收益、沪深300 与上涨占比" : "120-day returns and breadth"} />
            </div>
          </Card>
        </div>

        <div className="col-span-12 grid gap-3.5 xl:col-span-4 xl:grid-rows-[auto_1fr]">
          <Card
            index="02"
            title={zh ? "今日三件事" : "Three things"}
            subtitle={zh ? "权重股 / 广度 / 情绪" : "Weights / breadth / sentiment"}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="px-4 pb-2 md:px-[18px]">
              {[
                {
                  n: "01",
                  h: zh ? `沪深300 ${pct(last.hs300_ret)}，等权 ${pct(last.ew_ret)}` : `CSI 300 ${pct(last.hs300_ret)} vs EW ${pct(last.ew_ret)}`,
                  p: zh
                    ? `Top10 波动占比 ${ratio(last.top10_share, 0)}${topDrag ? ` · ${topDrag.name} ${(topDrag.contrib * 100).toFixed(2)}pp` : ""}`
                    : `CSI 300 ${pct(last.hs300_ret)} vs equal-weight ${pct(last.ew_ret)}`,
                },
                {
                  n: "02",
                  h: zh ? `${broadSectors} 个行业广度超过 60%` : `${broadSectors} sectors above 60% breadth`,
                  p: zh
                    ? `${sectors[0]?.sw_l1 ?? "—"} ${ratio(sectors[0]?.breadth ?? null, 0)} · ${sectors[1]?.sw_l1 ?? "—"} ${ratio(sectors[1]?.breadth ?? null, 0)}`
                    : `${broadSectors} of 31 sectors have breadth above 60%`,
                },
                {
                  n: "03",
                  h: zh ? `涨停 ${num(last.limit_up_n)} 家，最高 ${last.max_streak ?? "—"} 板` : `${num(last.limit_up_n)} limit-ups, max streak ${last.max_streak ?? "—"}`,
                  p: zh
                    ? `20 日均值 ${(limitRatio == null ? "—" : limitRatio.toFixed(1))}× · 连板 ${num(last.streak_n)} 家`
                    : `${num(last.limit_up_n)} limit-ups (${(limitRatio == null ? "—" : limitRatio.toFixed(1))}× 20d avg), max streak ${last.max_streak ?? "—"}`,
                },
              ].map((x, i) => (
                <div key={x.n} className={`grid grid-cols-[26px_1fr] gap-2 py-2 ${i ? "border-t border-[var(--border)]" : ""}`}>
                  <div className="serif pt-0.5 text-[19px] font-bold leading-none text-[var(--copper)]">{x.n}</div>
                  <div>
                    <div className="text-[12.5px] font-semibold leading-snug text-[var(--text)]">{x.h}</div>
                    <p className="mt-0.5 text-[12px] leading-[1.55] text-[var(--muted)]">{x.p}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            index="03"
            title={zh ? "全市场收益贡献 Top 5" : "Market contribution Top 5"}
            subtitle={zh ? "全市场流通市值权重 × 涨跌幅 · 单位 pp" : "All-A float-cap weight × return · pp"}
            prov={zh ? "权重 = 前一日流通市值 / 全市场总流通市值；贡献 = 权重 × 个股涨跌幅" : "Weight = prior-day float cap / total A-share float cap; contribution = weight × return"}
            right={<span className="pill">pp</span>}
            padded={false}
            bodyClass="pt-0"
            className="min-h-0"
          >
            <div className="flex flex-col px-3 pb-2 md:px-3.5">
              <div className="grid grid-cols-[16px_1fr_80px_56px] items-center gap-2 pb-1 text-[10px] text-[var(--faint)]">
                <span />
                <span className="col-span-2 text-center">{zh ? "拖累 ← 0 → 拉动" : "drag ← 0 → lift"}</span>
                <span className="text-right">pp</span>
              </div>
              {contrib.map((c, i) => {
                const half = (Math.abs(c.contrib) / maxAbs) * 50;
                const positive = c.contrib >= 0;
                return (
                  <div key={c.ts_code} className="grid h-[28px] grid-cols-[16px_1fr_80px_56px] items-center gap-2 border-b border-[var(--border)] last:border-0">
                    <span className="mono text-[10.5px] text-[var(--faint)]">{String(i + 1).padStart(2, "0")}</span>
                    <span className="truncate text-[12px] text-[var(--text-2)]">{c.name}</span>
                    <span className="relative h-[5px] rounded-[2px] bg-[var(--surface-2)]">
                      <span className="absolute top-0 h-full w-px bg-[var(--border-strong)]" style={{ left: "50%" }} />
                      <span
                        className="absolute top-0 h-full rounded-[2px]"
                        style={{
                          width: `${half}%`,
                          left: positive ? "50%" : `${50 - half}%`,
                          background: positive ? p.up : p.down,
                          opacity: 0.85,
                        }}
                      />
                    </span>
                    <span className="mono text-right text-[11.5px] text-[var(--muted)]">
                      {c.contrib >= 0 ? "+" : ""}{(c.contrib * 100).toFixed(2)}
                    </span>
                  </div>
                );
              })}
              {!contrib.length && <div className="py-8 text-center text-[12px] text-[var(--muted)]">{zh ? "暂无贡献数据" : "Contribution data unavailable"}</div>}
            </div>
            <div className="provline">
              <span>Top10 波动占比 <b>{ratio(last.top10_share, 0)}</b></span>
              <span>{zh ? "集中度" : "concentration"} HHI <b>{num(last.hhi)}</b></span>
              <a className="r hover:underline" href="#/stocks">{zh ? "点击查看全部 →" : "View all →"}</a>
            </div>
          </Card>
        </div>
      </div>

      {/* bubble + distribution */}
      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-7">
          <Card
            index="04"
            title={zh ? "行业参与：收益 × 广度" : "Sector participation: return × breadth"}
            subtitle={zh ? "横轴 = 行业等权收益 · 纵轴 = 上涨占比 · 气泡 = 成交额 · 四象限：普涨 / 集中 / 普跌 / 分化" : "x = sector EW return, y = breadth, size = turnover · quadrants at 0% / 50%"}
            right={
              <div className="flex items-center gap-2.5 text-[10.5px] text-[var(--faint)]">
                {[
                  { c: p.up, l: zh ? "普涨" : "Broad" },
                  { c: p.copper, l: zh ? "集中" : "Narrow" },
                  { c: p.down, l: zh ? "普跌" : "Selloff" },
                  { c: p.muted, l: zh ? "分化" : "Mixed" },
                ].map((q) => (
                  <span key={q.l} className="flex items-center gap-1">
                    <i className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: q.c }} />
                    {q.l}
                  </span>
                ))}
              </div>
            }
            prov={zh ? "横轴行业等权收益，纵轴行业内上涨占比，气泡面积按成交额" : "x = sector EW return, y = breadth, size = turnover"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>daily / sw_daily</b></span>
                <span>N <b>{sectors.length}</b></span>
                <span>{zh ? "申万一级" : "SW L1"}</span>
                <a className="r hover:underline" href="#/sectors">{zh ? "点击下钻 →" : "Drill in →"}</a>
              </div>
            }
          >
            <div className="h-[286px] px-1 pb-1 md:px-2">
              {sectors.length ? <EChart
                  option={sectorBubble(p, sectors, lang)}
                  onEvents={{
                    click: (params: unknown) => {
                      const name = (params as { data?: { name?: string } })?.data?.name;
                      if (name) navigate(`/sectors?sector=${encodeURIComponent(name)}`);
                    },
                  }}
                  ariaLabel={zh ? "行业收益与广度气泡图" : "Sector return vs breadth"}
                /> : <Skeleton h={286} />}
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <Card
            index="05"
            title={t("today.distribution")}
            subtitle={zh ? "当日个股收益横截面 · 截尾 ±11% · 纵轴：只数" : "Cross-section of stock returns, clipped ±11% · y: count"}
            right={<span className="pill">{zh ? "样本" : "N"} {num(dist?.stats.n || last.n_valid)}</span>}
            prov={zh ? "横截面直方图，中位线为当日个股收益中位数" : "Histogram of stock returns, median marked"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>CSD <b>{(last.csd * 100).toFixed(2)}pp</b></span>
                <span>IQR <b>{(last.iqr * 100).toFixed(2)}pp</b></span>
                <span>{zh ? "偏度" : "skew"} <b>{num(last.skew, 2)}</b></span>
                <span className="r">daily / daily_basic</span>
              </div>
            }
          >
            <div className="h-[286px] px-1 pb-1 md:px-2">
              {dist?.bins?.length ? (
                <EChart option={distributionChart(p, dist.bins, dist.stats, lang)} ariaLabel={zh ? "个股收益分布" : "Return distribution"} />
              ) : (
                <Skeleton h={286} />
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* sector board + cap tilt */}
      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-6">
          <Card
            index="06"
            title={zh ? "行业广度 · 最广泛参与" : "Broadest sectors"}
            subtitle={zh ? "按行业内上涨股票占比排序" : "Ranked by share of constituents advancing"}
            prov={zh ? "行业内上涨家数 /（上涨 + 下跌）" : "Advancers / (advancers + decliners)"}
            padded={false}
            bodyClass="pt-1"
          >
            <div className="flex flex-col px-4 pb-2 md:px-[18px]">
              {boardTop.map((s) => (
                <div key={s.sw_l1} className="grid grid-cols-[76px_1fr_40px_48px] items-center gap-2 border-b border-[var(--border)] py-[7px] last:border-0 md:grid-cols-[92px_1fr_44px_52px]">
                  <span className="truncate text-[11.5px] text-[var(--text-2)]">{s.sw_l1}</span>
                  <div className="h-[4px] rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full" style={{ width: `${s.breadth * 100}%`, background: p.accent, opacity: 0.8 }} />
                  </div>
                  <span className="mono text-right text-[11px] text-[var(--text)]">{ratio(s.breadth, 0)}</span>
                  <span className={`mono text-right text-[11px] ${trendClass(s.ew_ret)}`}>{pct(s.ew_ret)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-6">
          <Card
            index="07"
            title={zh ? "大盘股 vs 等权" : "Large caps vs equal weight"}
            subtitle={zh ? "行业流通市值加权 − 行业等权 · 按绝对差排序 · 左 = 等权更强，右 = 大市值更强" : "Float-cap weighted − equal weighted · sorted by absolute gap · left = EW stronger, right = large caps stronger"}
            prov={zh ? "权重 = 前一日流通市值 / 行业总流通市值；横条 = 行业市值加权收益 − 等权收益" : "Weight = prior-day float cap / sector float cap; bar = CW return − EW return"}
            padded={false}
            bodyClass="pt-1"
          >
            <div className="flex flex-col px-4 pb-2 md:px-[18px]">
              <div className="grid grid-cols-[76px_1fr_58px] items-center gap-2 pb-1 text-[10.5px] text-[var(--faint)] md:grid-cols-[92px_1fr_64px]">
                <span />
                <div className="flex items-center justify-between">
                  <span>{zh ? "← 等权更强" : "← EW stronger"}</span>
                  <span>{zh ? "大市值更强 →" : "large caps →"}</span>
                </div>
                <span />
              </div>
              {leaderTilt.map((s) => {
                const tilt = s.cw_ret - s.ew_ret;
                const w = Math.min(50, (Math.abs(tilt) / maxTilt) * 50);
                return (
                  <div key={s.sw_l1} className="grid grid-cols-[76px_1fr_58px] items-center gap-2 border-b border-[var(--border)] py-[7px] last:border-0 md:grid-cols-[92px_1fr_64px]">
                    <span className="truncate text-[11.5px] text-[var(--text-2)]">{s.sw_l1}</span>
                    <div className="relative h-[7px] rounded-full bg-[var(--surface-2)]">
                      <span className="absolute inset-y-0 left-1/2 z-10 w-px bg-[var(--text)]" />
                      <span
                        className="absolute inset-y-0 rounded-full bg-[var(--accent)]"
                        style={{ width: `${w}%`, left: tilt >= 0 ? "50%" : `${50 - w}%`, opacity: 0.75 }}
                      />
                    </div>
                    <span className="mono text-right text-[11.5px] text-[var(--text-2)]">
                      {tilt >= 0 ? "+" : ""}{(tilt * 100).toFixed(2)}pp
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 pt-0.5 text-[10.5px] text-[var(--faint)]">
        <span className="font-mono">
          {zh ? "数据源：Tushare Pro · daily / daily_basic / stk_limit" : "Source: Tushare Pro · daily / daily_basic / stk_limit"}
        </span>
        <span className="mono">
          {d} · {num(last.n_valid)} {zh ? "只" : "stocks"} · {zh ? "前值" : "prev"} {prev ? shortDate(prev.trade_date) : "—"}
          <a className="ml-2 inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline" href="#/about">
            <ArrowUpRight size={10} /> {zh ? "口径与方法" : "Method"}
          </a>
        </span>
      </div>
    </div>
  );
}
