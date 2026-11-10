import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, FileText, Minus } from "lucide-react";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, num, pct, ratio, shortDate, trendClass, weekday } from "../lib/format";
import { regimeLabel, regimeOf, verdict } from "../lib/regime";
import { breadthArea, distributionChart, returnBreadth, sectorBubble } from "../lib/charts";
import EChart from "../components/EChart";
import { Card, MicroLabel } from "../components/Card";
import { Kpi } from "../components/Kpi";
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";

function Skeleton({ h = 320 }: { h?: number }) {
  return <div className="skeleton w-full" style={{ height: h }} />;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

export default function Today() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);

  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const end = meta?.last_trade_date;

  const { data: series } = useQuery({
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

  if (!series || !last) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-7">
            <Skeleton h={208} />
          </div>
          <div className="col-span-5">
            <Skeleton h={208} />
          </div>
        </div>
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={104} />
          ))}
        </div>
        <Skeleton h={380} />
      </div>
    );
  }

  const last60 = series.slice(-60);
  const last120 = series.slice(-120);
  const last20 = series.slice(-21, -1);
  const regime = regimeOf(last);
  const tone = last.ew_ret >= 0 ? "up" : "down";
  const breadthPct = Math.round(last.breadth * 100);
  const prev = series[series.length - 2];

  const rank = series.slice(-250).filter((r) => r.breadth <= last.breadth).length;
  const breadthPctile = Math.round((rank / Math.max(1, series.slice(-250).length)) * 100);

  const kpis = [
    {
      label: t("metric.ew"),
      value: pct(last.ew_ret),
      tone: tone as "up" | "down",
      sub:
        last.hs300_ret === null || last.hs300_ret === undefined
          ? `${t("metric.cw")} ${pct(last.cw_ret)}`
          : `${t("metric.index")} ${pct(last.hs300_ret)}`,
      to: "/market",
      spark: series.slice(-21).map((r) => r.ew_ret),
      sparkTone: tone as "up" | "down",
    },
    {
      label: t("metric.breadth"),
      value: ratio(last.breadth, 0),
      tone: (last.breadth >= 0.5 ? "up" : "down") as "up" | "down",
      sub: `${last.n_adv} ↑ / ${last.n_dec} ↓ · ${lang === "en" ? `${ord(breadthPctile)} pct` : `${breadthPctile}分位`}`,
      to: "/regime",
      spark: series.slice(-21).map((r) => r.breadth),
      sparkTone: "accent" as const,
    },
    {
      label: t("metric.limitUp"),
      value: `${num(last.limit_up_n)}`,
      tone: "up" as const,
      sub: `${t("metric.limitDown")} ${num(last.limit_down_n)}${last.broken_n ? ` · ${lang === "en" ? "broken" : "炸板"} ${num(last.broken_n)}` : ""}`,
      to: "/sentiment",
      spark: series.slice(-21).map((r) => r.limit_up_n),
      sparkTone: "up" as const,
    },
    {
      label: t("metric.amount"),
      value: money(last.amount),
      tone: "neutral" as const,
      sub: `${t("common.sample")} ${num(last.n_valid)} ${lang === "en" ? "stocks" : "只"}`,
      to: "/market",
      spark: series.slice(-21).map((r) => r.amount),
      sparkTone: "accent" as const,
    },
    {
      label: t("metric.csd"),
      value: `${(last.csd * 100).toFixed(2)}pp`,
      tone: "neutral" as const,
      sub: `${t("metric.median")} ${pct(last.med_ret)}`,
      to: "/stocks",
      spark: series.slice(-21).map((r) => r.csd),
      sparkTone: "accent" as const,
    },
    {
      label: t("metric.top10"),
      value: `${(last.top10_contrib_pct ?? 0).toFixed(2)}pp`,
      tone: "neutral" as const,
      sub: `HHI ${num(last.hhi)} · ${lang === "en" ? "share" : "占比"} ${ratio(last.top10_share, 0)}`,
      to: "/market",
      spark: series.slice(-21).map((r) => r.top10_contrib_pct),
      sparkTone: "up" as const,
    },
  ];

  const contrib = (detail?.contributors || []).slice(0, 10);
  const maxAbs = Math.max(...contrib.map((c) => Math.abs(c.contrib)), 1e-9);

  const sectors = detail?.sectors || [];
  const boardTop = [...sectors].sort((a, b) => b.breadth - a.breadth).slice(0, 5);
  const leaderTilt = [...sectors]
    .filter((s) => s.n >= 30)
    .sort((a, b) => b.cw_ret - b.ew_ret - (a.cw_ret - a.ew_ret))
    .slice(0, 5);
  const maxTilt = Math.max(...leaderTilt.map((s) => Math.abs(s.cw_ret - s.ew_ret)), 0.0001);

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <div className="card relative h-full overflow-hidden p-[18px] md:p-[22px_24px]">
            <div className="dotgrid pointer-events-none absolute inset-0 opacity-[0.35]" />
            <div className="relative flex flex-wrap items-center gap-3">
              <span className="mono text-[13px] text-[var(--text-2)]">{last.trade_date}</span>
              <span className="text-[11px] text-[var(--muted)]">{weekday(last.trade_date, lang)}</span>
              <span
                className={`pill h-[24px] border-transparent ${
                  regime === "broad_up" || regime === "concentrated_up"
                    ? "chip-up"
                    : regime === "broad_down"
                      ? "chip-down"
                      : "chip-accent"
                }`}
              >
                {regimeLabel(regime, lang)}
              </span>
              <span className="pill h-[24px]">
                <span className="h-1 w-1 rounded-full bg-[var(--muted)]" />
                {lang === "en" ? `${ord(breadthPctile)} breadth pct.` : `${breadthPctile}% 广度分位`}
              </span>
              <a
                href="#/briefing"
                target="_blank"
                rel="noreferrer"
                className="pill ml-auto h-[24px] gap-1 border-[var(--border)] text-[var(--text-2)] transition-colors hover:text-[var(--accent)]"
              >
                <FileText size={11} />
                {lang === "en" ? "Briefing" : "每日简报"}
              </a>
            </div>

            <h1
              className="relative mt-4 max-w-[40ch] text-[16.5px] font-semibold leading-[1.55] tracking-tight text-[var(--text)] md:mt-5 md:text-[19px] md:leading-[1.6]"
              style={{ textWrap: "balance" }}
            >
              {verdict(last, lang)}
            </h1>

            <div className="relative mt-5 grid grid-cols-3 gap-2 md:mt-6 md:gap-4">
              {[
                { k: lang === "en" ? "Adv / Dec" : "涨 / 跌", v: `${last.n_adv} / ${last.n_dec}` },
                { k: t("metric.amount"), v: money(last.amount) },
                {
                  k: lang === "en" ? "Breadth vs 20d" : "广度较 20 日均值",
                  v: `${((last.breadth - avg(last20.map((r) => r.breadth))) * 100).toFixed(1)}pp`,
                },
              ].map((s) => (
                <div key={s.k}>
                  <MicroLabel>{s.k}</MicroLabel>
                  <div className="mono mt-1 text-[12.5px] font-medium text-[var(--text)] md:mt-1.5 md:text-[15px]">{s.v}</div>
                </div>
              ))}
            </div>

            {/* breadth meter */}
            <div className="relative mt-6">
              <div className="h-[6px] w-full overflow-hidden rounded-full bg-[var(--panel-3)]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${breadthPct}%`,
                    background:
                      last.breadth >= 0.6
                        ? "linear-gradient(90deg, var(--up), var(--up))"
                        : last.breadth < 0.45
                          ? "linear-gradient(90deg, var(--down), var(--down))"
                          : "linear-gradient(90deg, var(--accent), var(--accent))",
                    opacity: 0.85,
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-[var(--faint)]">
                <span className="mono">0%</span>
                <span className="mono">50%</span>
                <span className="mono">100%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <Card
            title={t("today.participation")}
            subtitle={lang === "en" ? "Share of stocks advancing, last 60 sessions" : "近 60 个交易日上涨股票占比"}
            className="h-full"
            right={
              <div className="text-right">
                <div className="mono text-[18px] font-semibold" style={{ color: p.accent }}>
                  {ratio(last.breadth, 0)}
                </div>
                <div className="text-[10px] text-[var(--muted)]">{lang === "en" ? "today" : "今日"}</div>
              </div>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[150px] pr-2 md:h-[176px] md:pr-3">
              <EChart option={breadthArea(p, last60)} />
            </div>
          </Card>
        </div>
      </div>

      {/* kpis */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to} className="block transition-transform hover:-translate-y-[1px]">
            <Kpi {...k} />
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-[7px] text-[10.5px] text-[var(--muted)]">
        <span className="flex items-center gap-1 text-[var(--warn)]">
          <Zap size={11} /> {lang === "en" ? "Notable" : "异动"}
        </span>
        {[
          `${lang === "en" ? "Limit-ups" : "涨停"} ${num(last.limit_up_n)} · ${(last.limit_up_n / Math.max(1, avg(last20.map((r) => r.limit_up_n)))).toFixed(1)}× 20d`,
          `${lang === "en" ? "Max streak" : "最高连板"} ${last.max_streak ?? "—"}`,
          `${lang === "en" ? "Turnover vs 20d" : "成交额较 20 日"} ${(
            (last.amount / Math.max(1, avg(last20.map((r) => r.amount))) - 1) * 100 >= 0 ? "+" : ""
          )}${((last.amount / Math.max(1, avg(last20.map((r) => r.amount))) - 1) * 100).toFixed(0)}%`,
        ].map((a) => (
          <span key={a} className="rounded-md bg-[var(--panel-3)] px-2 py-[2px] text-[10px] text-[var(--text-2)]">
            {a}
          </span>
        ))}
      </div>

      {/* main + contributors */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-8">
          <Card
            title={t("market.returnBreadth")}
            subtitle={
              lang === "en"
                ? "Bars: equal-weight return · Line: CSI 300 · Lower panel: breadth"
                : "柱：全市场等权收益 · 线：沪深300 · 下：上涨股票占比"
            }
            right={
              <div className="flex items-center gap-3 text-[10.5px] text-[var(--muted)]">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-[7px] w-[7px] rounded-sm" style={{ background: p.up }} />
                  {lang === "en" ? "up" : "涨"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-[7px] w-[7px] rounded-sm" style={{ background: p.down }} />
                  {lang === "en" ? "down" : "跌"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: p.accent }} />
                  {lang === "en" ? "breadth" : "广度"}
                </span>
              </div>
            }
            padded={false}
            bodyClass="pt-1"
          >
            <div className="h-[300px] px-1 pb-1 md:h-[368px] md:px-2 md:pb-2">
              <EChart option={returnBreadth(p, last120, lang)} ariaLabel="近120个交易日的等权收益、沪深300与上涨股票占比" />
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card
            title={t("today.contributors")}
            subtitle={lang === "en" ? "Weight × return contribution, today" : "今日 权重 × 涨跌幅 对指数的贡献"}
            className="h-full"
            padded={false}
            bodyClass="pt-0"
          >
            <div className="flex flex-col gap-[3px] px-4 pb-3">
              {contrib.map((c) => {
                const half = (Math.abs(c.contrib) / maxAbs) * 50;
                const positive = c.contrib >= 0;
                return (
                  <div key={c.ts_code} className="group grid grid-cols-[70px_1fr_46px] items-center gap-2 md:grid-cols-[86px_1fr_52px] md:gap-2.5 rounded-md px-2 py-[6px] hover:bg-[var(--panel-2)]">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] leading-tight text-[var(--text)]">{c.name}</div>
                      <div className="truncate text-[9.5px] leading-tight text-[var(--faint)]">{c.sw_l1}</div>
                    </div>
                    <div className="relative h-[7px] overflow-hidden rounded-[3px] bg-[var(--panel-3)]">
                      <div className="absolute top-0 h-full w-px bg-[var(--border-strong)]" style={{ left: "50%" }} />
                      <div
                        className="absolute top-0 h-full rounded-[2px] transition-all duration-500"
                        style={{
                          width: `${half}%`,
                          left: positive ? "50%" : `${50 - half}%`,
                          background: positive ? p.up : p.down,
                          opacity: 0.85,
                        }}
                      />
                    </div>
                    <div className={`mono text-right text-[11px] ${trendClass(c.ret)}`}>{pct(c.ret)}</div>
                  </div>
                );
              })}
              {!contrib.length && <div className="py-10 text-center text-[12px] text-[var(--muted)]">{t("common.loading")}</div>}
            </div>
          </Card>
        </div>
      </div>

      {/* sector + distribution */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <Card
            title={`${t("sectors.title")} · ${t("sectors.bubble")}`}
            subtitle={
              lang === "en"
                ? "Bubble size = turnover · quadrants split at 0% return and 50% breadth"
                : "气泡大小 = 行业成交额 · 参考线为 0% 收益与 50% 广度"
            }
            right={
              <div className="flex items-center gap-2.5 text-[9.5px] text-[var(--muted)]">
                {[
                  { c: p.up, l: lang === "en" ? "Broad" : "普涨" },
                  { c: "#e8a33d", l: lang === "en" ? "Narrow" : "集中" },
                  { c: "#5b8cff", l: lang === "en" ? "Cap drag" : "权重拖累" },
                  { c: p.down, l: lang === "en" ? "Selloff" : "普跌" },
                ].map((q) => (
                  <span key={q.l} className="flex items-center gap-1">
                    <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: q.c }} />
                    {q.l}
                  </span>
                ))}
              </div>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[280px] px-1 pb-1 md:h-[336px] md:px-2 md:pb-2">
              {sectors.length ? <EChart option={sectorBubble(p, sectors, lang)} ariaLabel="行业收益与上涨占比气泡图" /> : <Skeleton h={320} />}
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <Card
            title={t("today.distribution")}
            subtitle={
              lang === "en"
                ? "Cross-section of stock returns today (clipped at ±11%)"
                : "当日个股收益横截面分布（显示截尾 ±11%）"
            }
            right={
              <span className="pill h-[22px] px-2 text-[10px]">
                {t("common.sample")} {num(dist?.stats.n || last.n_valid)}
              </span>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[280px] px-1 pb-1 md:h-[336px] md:px-2 md:pb-2">
              {dist?.bins?.length ? (
                <EChart option={distributionChart(p, dist.bins, dist.stats, lang)} ariaLabel="当日个股收益分布直方图" />
              ) : (
                <Skeleton h={320} />
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* sector breadth board */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-6">
          <Card
            title={lang === "en" ? "Broadest sectors" : "行业广度 · 最广泛参与"}
            subtitle={lang === "en" ? "Ranked by share of constituents advancing" : "按行业内上涨股票占比排序"}
            padded={false}
            bodyClass="pt-1"
          >
            <div className="flex flex-col px-4 pb-3">
              {boardTop.map((s) => (
                <div key={s.sw_l1} className="flex items-center gap-3 border-b border-[var(--border)] py-[9px] last:border-0">
                  <span className="w-[68px] truncate text-[11.5px] text-[var(--text-2)] md:w-[92px] md:text-[12px]">{s.sw_l1}</span>
                  <div className="h-[4px] flex-1 rounded-full bg-[var(--panel-3)]">
                    <div className="h-full rounded-full" style={{ width: `${s.breadth * 100}%`, background: p.accent, opacity: 0.75 }} />
                  </div>
                  <span className="mono w-[36px] text-right text-[11px] text-[var(--text)] md:w-[42px] md:text-[11.5px]">{ratio(s.breadth, 0)}</span>
                  <span className={`mono w-[46px] text-right text-[10.5px] md:w-[52px] md:text-[11px] ${trendClass(s.ew_ret)}`}>{pct(s.ew_ret)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-6">
          <Card
            title={lang === "en" ? "Large-cap tilt · cap-weight minus equal-weight" : "龙头拉动 · 市值加权 − 等权"}
            subtitle={
              lang === "en"
                ? "Positive = heavyweights outperformed the typical stock"
                : "为正说明行业涨幅由大市值龙头贡献，而非多数股票"
            }
            padded={false}
            bodyClass="pt-1"
          >
            <div className="flex flex-col px-4 pb-3">
              {leaderTilt.map((s) => {
                const tilt = s.cw_ret - s.ew_ret;
                const w = Math.min(100, (Math.abs(tilt) / maxTilt) * 100);
                return (
                  <div key={s.sw_l1} className="flex items-center gap-3 border-b border-[var(--border)] py-[9px] last:border-0">
                    <span className="w-[68px] truncate text-[11.5px] text-[var(--text-2)] md:w-[92px] md:text-[12px]">{s.sw_l1}</span>
                    <div className="relative h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--panel-3)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${w}%`, background: tilt >= 0 ? p.up : p.down, opacity: 0.75 }}
                      />
                    </div>
                    <span className={`mono w-[56px] text-right text-[11px] ${trendClass(tilt)}`}>
                      {tilt >= 0 ? "+" : ""}
                      {(tilt * 100).toFixed(2)}pp
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-between pb-2 pt-1 text-[10.5px] text-[var(--faint)]">
        <span>
          {lang === "en" ? "Source: Tushare Pro · daily / daily_basic / stk_limit" : "数据源：Tushare Pro · daily / daily_basic / stk_limit"}
        </span>
        <span className="mono">
          {d} · {last.n_valid} stocks · {lang === "en" ? "prev" : "前值"} {prev ? shortDate(prev.trade_date) : "—"}
        </span>
      </div>
    </div>
  );
}
