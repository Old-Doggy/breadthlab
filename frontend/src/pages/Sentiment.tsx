import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { axisStyle, baseChart, palettes } from "../lib/theme";
import { money, num, pct, ratio, shortDate } from "../lib/format";
import EChart from "../components/EChart";
import { Card, MicroLabel } from "../components/Card";
import { limitQualityChart } from "../lib/charts4";

export default function Sentiment() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme } = useUI();
  const p = palettes[theme];

  const { data } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });
  const { data: limitQ } = useQuery({ queryKey: ["limit-quality"], queryFn: api.limitQuality });
  const all = data ?? [];
  const rows = useMemo(() => all.slice(-120), [all]);
  const last = rows[rows.length - 1];

  const x = rows.map((r) => shortDate(r.trade_date));

  const limitOption = useMemo(() => {
    if (!rows.length) return {} as never;
    return {
      ...baseChart(p),
      grid: [
        { left: 8, right: 10, top: 14, height: "52%", containLabel: true },
        { left: 8, right: 10, top: "72%", height: "20%", containLabel: true },
      ],
      tooltip: { ...baseChart(p).tooltip, trigger: "axis" },
      xAxis: [
        { type: "category", data: x, gridIndex: 0, ...axisStyle(p), axisLabel: { show: false }, splitLine: { show: false } },
        { type: "category", data: x, gridIndex: 1, ...axisStyle(p), splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(x.length / 6)) } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, fontSize: 10 }, splitNumber: 3 },
        { type: "value", gridIndex: 1, min: 0, max: 100, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 9 }, splitNumber: 1 },
      ],
      series: [
        {
          name: lang === "en" ? "Limit-up" : "涨停",
          type: "bar",
          data: rows.map((r) => r.limit_up_n),
          itemStyle: { color: p.up, opacity: 0.82, borderRadius: [2, 2, 0, 0] },
          barWidth: "55%",
        },
        {
          name: lang === "en" ? "Limit-down" : "跌停",
          type: "bar",
          data: rows.map((r) => -r.limit_down_n),
          itemStyle: { color: p.down, opacity: 0.82, borderRadius: [0, 0, 2, 2] },
          barWidth: "55%",
        },
        {
          name: lang === "en" ? "Breadth" : "上涨占比",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: rows.map((r) => +(r.breadth * 100).toFixed(1)),
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { color: p.accent, width: 1.4 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(91,140,255,.22)" },
                { offset: 1, color: "rgba(91,140,255,0)" },
              ],
            },
          },
        },
      ],
    } as never;
  }, [rows, p, lang]);

  const streakOption = useMemo(() => {
    if (!rows.length) return {} as never;
    return {
      ...baseChart(p),
      grid: { left: 8, right: 10, top: 14, bottom: 20, containLabel: true },
      tooltip: { ...baseChart(p).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: x, ...axisStyle(p), splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(x.length / 5)) } },
      yAxis: [
        { type: "value", ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, fontSize: 10 }, splitNumber: 3 },
        {
          type: "value",
          min: 0,
          max: 10,
          ...axisStyle(p),
          splitLine: { show: false },
          axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, color: p.up },
          splitNumber: 2,
        },
      ],
      series: [
        {
          name: lang === "en" ? "2+ boards" : "连板家数",
          type: "bar",
          data: rows.map((r) => r.streak_n ?? 0),
          itemStyle: { color: p.accent, opacity: 0.32, borderRadius: [2, 2, 0, 0] },
          barWidth: "60%",
        },
        {
          name: lang === "en" ? "Max streak" : "最高连板",
          type: "line",
          yAxisIndex: 1,
          data: rows.map((r) => r.max_streak ?? null),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.up, width: 1.6 },
        },
      ],
    } as never;
  }, [rows, p, lang]);

  const highLowOption = useMemo(() => {
    if (!rows.length) return {} as never;
    return {
      ...baseChart(p),
      grid: { left: 8, right: 10, top: 14, bottom: 20, containLabel: true },
      tooltip: { ...baseChart(p).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: x, ...axisStyle(p), splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(x.length / 5)) } },
      yAxis: [
        {
          type: "value",
          ...axisStyle(p),
          axisLabel: { ...axisStyle(p).axisLabel, fontSize: 10, formatter: (v: number) => `${Math.abs(v)}` },
          splitNumber: 3,
        },
        {
          type: "value",
          min: 0,
          max: 100,
          ...axisStyle(p),
          splitLine: { show: false },
          axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, formatter: "{value}%" },
          splitNumber: 2,
        },
      ],
      series: [
        {
          name: lang === "en" ? "New highs" : "新高",
          type: "line",
          data: rows.map((r) => r.new_high_n),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.up, width: 1.3 },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(240,85,90,.18)" }, { offset: 1, color: "rgba(240,85,90,0)" }],
            },
          },
        },
        {
          name: lang === "en" ? "New lows" : "新低",
          type: "line",
          data: rows.map((r) => -r.new_low_n),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.down, width: 1.3 },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(35,181,125,.16)" }, { offset: 1, color: "rgba(35,181,125,0)" }],
            },
          },
        },
        {
          name: lang === "en" ? "Above MA250" : "MA250 上方",
          type: "line",
          yAxisIndex: 1,
          data: rows.map((r) => +(r.ma250_breadth * 100).toFixed(1)),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.text2, width: 1, opacity: 0.5, type: "dotted" },
        },
      ],
    } as never;
  }, [rows, p, lang]);

  if (!rows.length) return <div className="skeleton h-[600px] w-full" />;

  const zhaban = last.broken_n != null ? last.broken_n / Math.max(1, (last.limit_up_n || 0) + last.broken_n) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">{t("sentiment.title")}</h1>
          <p className="mt-1 text-[12px] text-[var(--muted)]">{t("sentiment.subtitle")}</p>
        </div>
        <span className="pill h-[24px]">{lang === "en" ? "last 120 sessions" : "近 120 个交易日"}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: lang === "en" ? "Limit-up" : "涨停家数", v: num(last.limit_up_n), sub: lang === "en" ? "price vs stk_limit" : "收盘价 ≥ 涨停价", tone: "up" },
          { k: lang === "en" ? "Limit-down" : "跌停家数", v: num(last.limit_down_n), sub: lang === "en" ? "price vs stk_limit" : "收盘价 ≤ 跌停价", tone: "down" },
          { k: lang === "en" ? "Max streak" : "最高连板", v: `${last.max_streak ?? "—"}`, sub: `${last.streak_n ?? 0} ${lang === "en" ? "with 2+ boards" : "家连板"}` },
          { k: lang === "en" ? "Broken rate" : "炸板率", v: zhaban === null ? "—" : ratio(zhaban, 0), sub: `${last.broken_n ?? "—"} ${lang === "en" ? "broken" : "家炸板"}` },
        ].map((s) => (
          <div key={s.k} className="card card-pad">
            <MicroLabel>{s.k}</MicroLabel>
            <div className={`mono mt-2 text-[22px] font-semibold ${s.tone === "up" ? "up" : s.tone === "down" ? "down" : ""}`}>{s.v}</div>
            <div className="mt-1 text-[10.5px] text-[var(--muted)]">{s.sub}</div>
          </div>
        ))}
      </div>

      <Card
        title={t("sentiment.limit")}
        subtitle={lang === "en" ? "Up bars vs down bars · lower panel is breadth" : "上：涨停 / 跌停家数 · 下：上涨占比"}
        right={<span className="mono text-[10.5px] text-[var(--muted)]">{last.trade_date}</span>}
        padded={false}
        bodyClass="pt-0"
      >
        <div className="h-[380px] px-2 pb-2">
          <EChart option={limitOption} />
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-6">
          <Card
            title={t("sentiment.streak")}
            subtitle={lang === "en" ? "Bars = stocks with 2+ boards · line = tallest streak" : "柱：连板家数 · 线：当日最高连板高度"}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[260px] px-2 pb-2">
              <EChart option={streakOption} />
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-6">
          <Card
            title={t("sentiment.newHigh")}
            subtitle={lang === "en" ? "252-day highs vs lows · dotted = share above MA250" : "252 日新高 / 新低 · 点线 = MA250 上方占比"}
            right={
              <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                <span className="inline-block h-[2px] w-3" style={{ background: p.up }} />
                {lang === "en" ? "high" : "新高"}
                <span className="inline-block h-[2px] w-3" style={{ background: p.down }} />
                {lang === "en" ? "low" : "新低"}
              </div>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[260px] px-2 pb-2">
              <EChart option={highLowOption} />
            </div>
          </Card>
        </div>
      </div>

      <Card
        title={lang === "en" ? "Seal quality (history)" : "封板质量（历史）"}
        subtitle={
          lang === "en"
            ? "Median seal amount / float cap and share opened · data ends 2026-05-22 (limit_list_d)"
            : "封单额/流通市值中位数 · 开板比例 · 数据截至 2026-05-22（limit_list_d 权限）"
        }
        right={<span className="pill h-[22px] px-2 text-[10px]">limit_list_d</span>}
        padded={false}
        bodyClass="pt-0"
      >
        <div className="h-[260px] px-2 pb-2">
          {limitQ?.length ? (
            <EChart option={limitQualityChart(p, limitQ, lang)} />
          ) : (
            <div className="skeleton h-full w-full" />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: lang === "en" ? "Margin balance" : "两融余额", v: money(last.rzye) },
          { k: lang === "en" ? "Margin buy" : "融资买入额", v: money(last.rzmre) },
          { k: lang === "en" ? "Flow breadth" : "资金流广度", v: ratio(last.flow_breadth, 0) },
          { k: lang === "en" ? "Main net flow" : "主力净流入", v: money(last.main_net_amount), tone: (last.main_net_amount || 0) >= 0 ? "up" : "down" },
        ].map((s) => (
          <div key={s.k} className="card card-pad">
            <MicroLabel>{s.k}</MicroLabel>
            <div className={`mono mt-2 text-[17px] font-medium ${s.tone || ""}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pb-2 text-[10.5px] text-[var(--faint)]">
        <span>{lang === "en" ? "Source: limit_list_d / stk_limit / moneyflow / margin" : "数据源：limit_list_d / stk_limit / moneyflow / margin"}</span>
        <span className="mono">{num(last.limit_up_n)} ↑ {num(last.limit_down_n)} ↓ · {pct(last.ew_ret)}</span>
      </div>
    </div>
  );
}
