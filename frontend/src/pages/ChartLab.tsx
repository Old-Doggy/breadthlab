import { escapeHtml } from "../lib/html";
import { cumulativePath } from "../lib/viewMetrics";
import { DataState } from "../components/DataState";
﻿import { useMemo, type ReactNode } from "react";
import type { EChartsOption } from "echarts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api, type MarketDay, type SectorDay } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor, axisStyle, baseChart, type Palette } from "../lib/theme";
import { money, pct, shortDate } from "../lib/format";
import { treemapChart } from "../lib/charts2";
import { PageHead } from "../components/PageHead";
import { Card } from "../components/Card";
import EChart from "../components/EChart";

type Demo = "regime" | "regime-hex" | "tape" | "bubble" | "distribution" | "treemap" | "multiples";

const mix = (a: string, b: string, t: number) => {
  const A = a.replace("#", "");
  const B = b.replace("#", "");
  const av = [0, 2, 4].map((i) => parseInt(A.slice(i, i + 2), 16));
  const bv = [0, 2, 4].map((i) => parseInt(B.slice(i, i + 2), 16));
  return "#" + av.map((v, i) => Math.round(v + (bv[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

const sand = (p: Palette) => (p.bg === "#f6f2e8" ? "#b9a67a" : "#c9b98f");
const tone = (p: Palette, v: number, max = 3) => mix(sand(p), v >= 0 ? p.up : p.down, Math.min(1, Math.abs(v) / max));

function GradientKey({ p, left, right }: { p: Palette; left: string; right: string }) {
  return (
    <div className="flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
      <span>{left}</span>
      <span className="h-[7px] w-32 rounded-full" style={{ background: `linear-gradient(90deg, ${p.down}, ${sand(p)}, ${p.up})` }} />
      <span>{right}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 01 · regime cloud with continuous colour                            */
/* ------------------------------------------------------------------ */
function regimeOption(p: Palette, rows: MarketDay[], lang: string): EChartsOption {
  const data = rows.slice(-750);
  const maxAmount = Math.max(...data.map((r) => r.amount || 0), 1);
  const last = data[data.length - 1];
  const trail = data.slice(-30);
  return {
    ...baseChart(p),
    grid: { left: 12, right: 22, top: 34, bottom: 34, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "item",
      formatter: (params: unknown) => {
        const q = params as { data: { value: number[]; raw: MarketDay } };
        const r = q.data.raw;
        return `<div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${escapeHtml(r.trade_date)}</div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "EW return" : "等权收益"}</span><b style="color:${r.ew_ret >= 0 ? p.up : p.down}">${(r.ew_ret * 100).toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Breadth" : "上涨占比"}</span><b>${(r.breadth * 100).toFixed(0)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Turnover" : "成交额"}</span><b>${money(r.amount, lang)}</b></div>`;
      },
    },
    xAxis: {
      type: "value",
      ...axisStyle(p),
      name: lang === "en" ? "Equal-weight return" : "等权收益",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: p.muted, fontSize: 11 },
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 5,
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 5,
    },
    series: [
      {
        type: "scatter",
        data: data.map((r) => ({
          value: [r.ew_ret * 100, r.breadth * 100],
          raw: r,
          symbolSize: 4 + Math.sqrt((r.amount || 0) / maxAmount) * 10,
          itemStyle: { color: tone(p, r.ew_ret * 100), opacity: 0.62 },
        })),
        emphasis: { scale: 1.25, itemStyle: { borderColor: p.bg, borderWidth: 2 } },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
          data: [{ xAxis: 0 }, { yAxis: 50 }],
        },
        z: 2,
      },
      {
        type: "line",
        data: trail.map((r) => [r.ew_ret * 100, r.breadth * 100]),
        showSymbol: false,
        lineStyle: { color: p.text2, width: 1.1, opacity: 0.3, type: "dashed" },
        silent: true,
        z: 3,
      },
      {
        type: "scatter",
        data: [{ value: [last.ew_ret * 100, last.breadth * 100] }],
        symbolSize: 14,
        itemStyle: { color: p.up, borderColor: p.bg, borderWidth: 3 },
        label: {
          show: true,
          position: "right",
          distance: 10,
          formatter: last.trade_date,
          color: p.up,
          fontSize: 11,
        },
        z: 5,
      },
    ],
    graphic: [
      { type: "text", left: "23%", top: 40, style: { text: lang === "en" ? "DIVERGENT" : "结构分化", fill: p.faint, fontSize: 10.5 } },
      { type: "text", right: "7%", top: 40, style: { text: lang === "en" ? "BROAD RALLY" : "普涨", fill: p.faint, fontSize: 10.5 } },
      { type: "text", left: "23%", bottom: 46, style: { text: lang === "en" ? "BROAD SELLOFF" : "普跌", fill: p.faint, fontSize: 10.5 } },
      { type: "text", right: "7%", bottom: 46, style: { text: lang === "en" ? "NARROW RALLY" : "集中上涨", fill: p.faint, fontSize: 10.5 } },
    ],
  } as EChartsOption;
}

/* ------------------------------------------------------------------ */
/* 01b · hexbin state cloud                                            */
/* ------------------------------------------------------------------ */
function regimeHexOption(p: Palette, rows: MarketDay[], lang: string): EChartsOption {
  const data = rows.slice(-750);
  const xmin = Math.min(-12, ...data.map((r) => Math.floor(r.ew_ret * 100)));
  const xmax = Math.max(12, ...data.map((r) => Math.ceil(r.ew_ret * 100)));
  const nx = 24;
  const ny = 15;
  const dx = (xmax - xmin) / nx;
  const dy = 100 / ny;
  const bins = new Map<string, { n: number; sum: number; x: number; y: number }>();
  data.forEach((r) => {
    const x = r.ew_ret * 100;
    const y = r.breadth * 100;
    const j = Math.max(0, Math.min(ny - 1, Math.floor(y / dy)));
    const off = j % 2 ? dx / 2 : 0;
    const i = Math.max(0, Math.min(nx - 1, Math.floor((x - xmin - off) / dx)));
    const key = `${i}|${j}`;
    const cur = bins.get(key) ?? { n: 0, sum: 0, x: 0, y: 0 };
    cur.n += 1;
    cur.sum += x;
    cur.x = xmin + (i + 0.5) * dx + off;
    cur.y = (j + 0.5) * dy;
    bins.set(key, cur);
  });
  const maxN = Math.max(...[...bins.values()].map((b) => b.n), 1);
  const last = data[data.length - 1];
  return {
    ...baseChart(p),
    grid: { left: 12, right: 22, top: 34, bottom: 34, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "item",
      formatter: (params: unknown) => {
        const q = params as { data: { value: number[]; n: number; avg: number } };
        return `<div style="font-family:monospace;font-size:12px">${lang === "en" ? "grid" : "格子"} · ${q.data.n} ${lang === "en" ? "sessions" : "个交易日"}<br/>${lang === "en" ? "avg EW" : "平均等权"} ${q.data.avg.toFixed(2)}%<br/>${lang === "en" ? "breadth" : "广度"} ${q.data.value[1].toFixed(0)}%</div>`;
      },
    },
    xAxis: {
      type: "value",
      min: xmin,
      max: xmax,
      ...axisStyle(p),
      name: lang === "en" ? "Equal-weight return" : "等权收益",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: p.muted, fontSize: 11 },
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 5,
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 5,
    },
    series: [
      {
        type: "scatter",
        symbol: "path://M50 0 L93 25 L93 75 L50 100 L7 75 L7 25 Z",
        symbolSize: (val: number[]) => 16 + Math.sqrt((val[2] || 1) / maxN) * 18,
        data: [...bins.values()].map((b) => ({
          value: [b.x, b.y, b.n],
          n: b.n,
          avg: b.sum / b.n,
          itemStyle: { color: tone(p, b.sum / b.n, 3), opacity: 0.9, borderColor: p.bg, borderWidth: 1 },
        })),
        emphasis: { scale: 1.2, itemStyle: { borderColor: p.text, borderWidth: 1.5 } },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
          data: [{ xAxis: 0 }, { yAxis: 50 }],
        },
        z: 3,
      },
      {
        type: "line",
        data: data.slice(-20).map((r) => [r.ew_ret * 100, r.breadth * 100]),
        showSymbol: false,
        lineStyle: { color: p.text2, width: 1.1, opacity: 0.4, type: "dashed" },
        silent: true,
        z: 2,
      },
      {
        type: "scatter",
        data: [[last.ew_ret * 100, last.breadth * 100]],
        symbolSize: 12,
        itemStyle: { color: p.up, borderColor: p.bg, borderWidth: 2 },
        label: { show: true, position: "top", distance: 7, formatter: last.trade_date, color: p.up, fontSize: 10.5 },
        z: 5,
      },
    ],
    graphic: [
      { type: "text", left: "23%", top: 40, style: { text: lang === "en" ? "DIVERGENT" : "结构分化", fill: p.faint, fontSize: 10.5 } },
      { type: "text", right: "5%", top: 40, style: { text: lang === "en" ? "BROAD RALLY" : "普涨", fill: p.faint, fontSize: 10.5 } },
      { type: "text", left: "23%", bottom: 46, style: { text: lang === "en" ? "BROAD SELLOFF" : "普跌", fill: p.faint, fontSize: 10.5 } },
      { type: "text", right: "5%", bottom: 46, style: { text: lang === "en" ? "NARROW RALLY" : "集中上涨", fill: p.faint, fontSize: 10.5 } },
    ],
  } as EChartsOption;
}
/* ------------------------------------------------------------------ */
/* 02 · climate-style gradient lollipop                                */
/* ------------------------------------------------------------------ */
function tapeOption(p: Palette, rows: MarketDay[], lang: string): EChartsOption {
  const data = rows.slice(-240);
  const vals = data.map((r) => +(r.ew_ret * 100).toFixed(2));
  const dates = data.map((r) => shortDate(r.trade_date));
  const last = data[data.length - 1];
  const colorOf = (v: number) => tone(p, v, 3);
  return {
    ...baseChart(p),
    grid: { left: 12, right: 26, top: 30, bottom: 32, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
        const r = data[i];
        if (!r) return "";
        return `<div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${escapeHtml(r.trade_date)}</div>
          <div style="display:flex;justify-content:space-between;gap:18px"><span>${lang === "en" ? "EW return" : "等权收益"}</span><b style="color:${r.ew_ret >= 0 ? p.up : p.down}">${(r.ew_ret * 100).toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:18px"><span>${lang === "en" ? "Breadth" : "上涨占比"}</span><b>${(r.breadth * 100).toFixed(0)}%</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: dates,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(dates.length / 8)), fontSize: 11 },
    },
    yAxis: {
      type: "value",
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 4,
    },
    series: [
      {
        type: "bar",
        data: vals.map((v) => ({ value: v, itemStyle: { color: colorOf(v), opacity: 0.55 } })),
        barWidth: 2.2,
        silent: true,
      },
      {
        type: "scatter",
        data: vals.map((v) => ({ value: v, itemStyle: { color: colorOf(v) } })),
        symbolSize: 6,
        z: 4,
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 0 }],
          lineStyle: { color: p.axis, width: 1 },
          label: { show: false },
        },
        markPoint: (() => {
          const imax = vals.indexOf(Math.max(...vals));
          const imin = vals.indexOf(Math.min(...vals));
          return {
            symbolSize: 0,
            silent: true,
            data: [
              { coord: [dates[imax], vals[imax]], label: { show: true, position: "top", formatter: `${dates[imax]}  +${vals[imax].toFixed(1)}%`, color: p.up, fontSize: 11 } },
              { coord: [dates[imin], vals[imin]], label: { show: true, position: "bottom", formatter: `${dates[imin]}  ${vals[imin].toFixed(1)}%`, color: p.down, fontSize: 11 } },
            ],
          };
        })(),
      },
      {
        type: "scatter",
        data: [[dates[dates.length - 1], vals[vals.length - 1]]],
        symbolSize: 9,
        itemStyle: { color: last.ew_ret >= 0 ? p.up : p.down, borderColor: p.bg, borderWidth: 2 },
        label: { show: true, position: "top", formatter: `${vals[vals.length - 1].toFixed(2)}%`, color: p.text2, fontSize: 11 },
        z: 6,
      },
    ],
  } as EChartsOption;
}

/* ------------------------------------------------------------------ */
/* 03 · continuous-colour sector bubble                                */
/* ------------------------------------------------------------------ */
function bubbleOption(p: Palette, rows: SectorDay[], lang: string): EChartsOption {
  const maxAmt = Math.max(...rows.map((r) => r.amount || 0), 1);
  const top = [...rows].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5);
  return {
    ...baseChart(p),
    grid: { left: 12, right: 26, top: 32, bottom: 32, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "item",
      formatter: (params: unknown) => {
        const r = (params as { data: { raw: SectorDay } }).data.raw;
        return `<div style="min-width:150px"><div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${escapeHtml(r.sw_l1)}</div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "EW return" : "等权收益"}</span><b style="color:${r.ew_ret >= 0 ? p.up : p.down}">${(r.ew_ret * 100).toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Breadth" : "上涨占比"}</span><b>${(r.breadth * 100).toFixed(0)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Turnover" : "成交额"}</span><b>${money(r.amount, lang)}</b></div></div>`;
      },
    },
    xAxis: {
      type: "value",
      ...axisStyle(p),
      name: lang === "en" ? "Sector EW return" : "行业等权收益",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: p.muted, fontSize: 11 },
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 5,
    },
    series: [
      {
        type: "scatter",
        data: rows.map((r) => ({
          value: [r.ew_ret * 100, r.breadth * 100],
          raw: r,
          symbolSize: 8 + Math.sqrt((r.amount || 0) / maxAmt) * 30,
          itemStyle: { color: tone(p, r.ew_ret * 100), opacity: 0.76, borderColor: p.bg, borderWidth: 1.5 },
        })),
        emphasis: { scale: 1.15, itemStyle: { borderColor: p.text, borderWidth: 2 } },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
          data: [{ xAxis: 0 }, { yAxis: 50 }],
        },
        label: {
          show: true,
          formatter: (x: unknown) => {
            const d = x as { data: { raw: SectorDay } };
            return top.some((s) => s.sw_l1 === d.data.raw.sw_l1) ? d.data.raw.sw_l1 : "";
          },
          position: "top",
          color: p.text2,
          fontSize: 11,
          distance: 5,
        },
        z: 3,
      },
    ],
  } as EChartsOption;
}

/* ------------------------------------------------------------------ */
/* 04 · distribution with continuous bin colours                       */
/* ------------------------------------------------------------------ */
function distOption(p: Palette, bins: { b: number; n: number; lo: number; hi: number }[], stats: { med: number; mean: number; sd: number }, lang: string): EChartsOption {
  return {
    ...baseChart(p),
    grid: { left: 12, right: 18, top: 28, bottom: 32, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
        const b = bins[i];
        if (!b) return "";
        return `<div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${i === 0 ? "≤" : i === bins.length-1 ? "≥" : ""}${(((b.lo + b.hi) / 2) * 100).toFixed(1)}%</div><b>${b.n}</b> ${lang === "en" ? "stocks" : "只"}`;
      },
    },
    xAxis: {
      type: "category",
      data: bins.map((b) => (((b.lo + b.hi) / 2) * 100).toFixed(1)),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 10.5, interval: Math.max(0, Math.floor(bins.length / 9)) },
      name: lang === "en" ? "Stock return" : "个股收益",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: p.muted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 10.5 },
      splitNumber: 4,
    },
    series: [
      {
        type: "bar",
        data: bins.map((b) => ({
          value: b.n,
          itemStyle: { color: tone(p, ((b.lo + b.hi) / 2) * 100, 5), opacity: 0.9, borderRadius: [2, 2, 0, 0] },
        })),
        barWidth: "72%",
        label: { show: false },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { color: p.muted, fontSize: 10 },
          data: [
            { xAxis: Math.max(0, bins.findIndex((b) => b.lo <= 0 && b.hi > 0)), label: { formatter: "0%", position: "end" } },
            { xAxis: Math.max(0, bins.findIndex((b) => b.lo <= stats.med && b.hi > stats.med)), label: { formatter: `${lang === "en" ? "Median" : "中位"} ${(stats.med * 100).toFixed(1)}%`, position: "insideEndTop" } },
          ],
        },
      },
    ],
  } as EChartsOption;
}

function MiniPath({ values, score, color }: { values: (number | null)[]; score: number; color: string }) {
  const w = 150;
  const h = 56;
  const nums = values.filter((v): v is number => v != null);
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => v == null ? null : [2 + (i / Math.max(1, values.length - 1)) * (w - 4), h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((pt, i) => pt ? `${i && pts[i-1] ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}` : "").join(" ");
  const zero = h - 4 - ((0 - min) / span) * (h - 8);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full" aria-hidden>
      <line x1="0" x2={w} y1={zero} y2={zero} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {pts[pts.length - 1] && <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r="2.8" fill={color} />}
      <title>{`${(score * 100).toFixed(2)}%`}</title>
    </svg>
  );
}

export default function ChartLab() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const [params] = useSearchParams();
  const only = params.get("demo") as Demo | null;
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const d = meta?.last_trade_date;
  const { data: market, isError: marketError, isPending: marketPending } = useQuery({ queryKey: ["lab-market"], queryFn: () => api.marketSeries() });
  const { data: sectors } = useQuery({ queryKey: ["lab-sectors", d], queryFn: () => api.sectors(d as string), enabled: !!d });
  const { data: stocks } = useQuery({ queryKey: ["lab-stocks", d], queryFn: () => api.stocks(d as string), enabled: !!d });
  const { data: distribution } = useQuery({ queryKey: ["lab-dist", d], queryFn: () => api.distribution(d as string), enabled: !!d });
  const { data: monthly } = useQuery({ queryKey: ["lab-monthly"], queryFn: () => api.sectorMonthly() });

  const rows = (market ?? []).filter((r) => r.breadth != null && Number.isFinite(r.breadth));
  const small = useMemo(() => {
    if (!monthly?.length) return null;
    const months = [...new Set(monthly.map((r) => r.month))].sort().slice(-12);
    const by = new Map<string, Map<string, number>>();
    monthly.forEach((r) => {
      if (!by.has(r.sw_l1)) by.set(r.sw_l1, new Map());
      by.get(r.sw_l1)!.set(r.month, r.ew_ret_cum);
    });
    const all = [...by.entries()].map(([name, vals]) => {
      const path = cumulativePath(months.map((m) => vals.get(m) ?? null));
      return { name, values: path.map((v) => v == null ? null : v * 100), score: path[path.length - 1] ?? null };
    }).filter((row): row is { name: string; values: (number | null)[]; score: number } => row.score != null).sort((a, b) => b.score - a.score);
    return { top: all.slice(0, 6), bottom: all.slice(-6).reverse() };
  }, [monthly]);

  if (!rows.length) return <DataState error={marketError} loading={marketPending} />;

  const cards: { key: Demo; node: ReactNode }[] = [
    {
      key: "regime",
      node: (
        <Card
          index="01"
          title={zh ? "收益 × 广度 · 连续渐变状态云" : "Return × breadth · gradient cloud"}
          subtitle={zh ? "点的颜色随等权收益连续变化 · 大小 = 成交额 · 虚线 = 最近 30 日" : "Continuous colour by EW return · size = turnover · trail = 30D"}
          right={<GradientKey p={p} left={zh ? "跌" : "down"} right={zh ? "涨" : "up"} />}
          padded={false}
          bodyClass="pt-0"
          footer={<div className="provline"><span>SOURCE <b>daily</b></span><span>{zh ? "750 个交易日" : "750 sessions"}</span><span className="r">{zh ? "当日点：红圈" : "today: red ring"}</span></div>}
        >
          <div className={only === "regime" ? "h-[620px] px-2 pb-2" : "h-[440px] px-2 pb-2"}>
            {rows.length ? <EChart option={regimeOption(p, rows, lang)} /> : <DataState />}
          </div>
        </Card>
      ),
    },
    {
      key: "regime-hex",
      node: (
        <Card
          index="01B"
          title={zh ? "收益 × 广度 · 六边形聚合" : "Return × breadth · hexbin"}
          subtitle={zh ? "每个六边形 = 一个收益/广度格子 · 颜色 = 格内平均收益 · 大小 = 交易日数" : "one hex = one return/breadth bin · colour = average return · size = sessions"}
          right={<GradientKey p={p} left={zh ? "跌" : "down"} right={zh ? "涨" : "up"} />}
          padded={false}
          bodyClass="pt-0"
          footer={<div className="provline"><span>SOURCE <b>daily</b></span><span>{zh ? "750 个交易日" : "750 sessions"}</span><span className="r">{zh ? "无点重叠" : "no overplotting"}</span></div>}
        >
          <div className={only === "regime-hex" ? "h-[620px] px-2 pb-2" : "h-[440px] px-2 pb-2"}>
            {rows.length ? <EChart option={regimeHexOption(p, rows, lang)} /> : <DataState />}
          </div>
        </Card>
      ),
    },    {
      key: "tape",
      node: (
        <Card
          index="02"
          title={zh ? "日度等权收益 · 渐变针线图" : "Daily EW return · gradient lollipop"}
          subtitle={zh ? "绿 → 沙 → 红 · 零轴 · 自动标注区间最大涨跌" : "green → sand → red · zero line · annotated extremes"}
          right={<GradientKey p={p} left="-3%" right="+3%" />}
          padded={false}
          bodyClass="pt-0"
          footer={<div className="provline"><span>SOURCE <b>daily</b></span><span>{zh ? "近 240 个交易日" : "last 240 sessions"}</span><span className="r">{zh ? "悬停看广度" : "hover for breadth"}</span></div>}
        >
          <div className={only === "tape" ? "h-[480px] px-2 pb-2" : "h-[340px] px-2 pb-2"}>
            {rows.length ? <EChart option={tapeOption(p, rows, lang)} /> : <DataState />}
          </div>
        </Card>
      ),
    },
    {
      key: "bubble",
      node: (
        <Card
          index="03"
          title={zh ? "行业收益 × 广度 · 连续渐变气泡" : "Sector return × breadth · gradient bubbles"}
          subtitle={zh ? "颜色 = 行业等权收益 · 大小 = 成交额 · 只标成交额前 5" : "colour = EW return · size = turnover · top 5 labels"}
          right={<GradientKey p={p} left={zh ? "跌" : "down"} right={zh ? "涨" : "up"} />}
          padded={false}
          bodyClass="pt-0"
          footer={<div className="provline"><span>SOURCE <b>sw_daily</b></span><span>{zh ? "31 个申万一级行业" : "31 SW L1 sectors"}</span><span className="r">{zh ? "悬停看成交额" : "hover for turnover"}</span></div>}
        >
          <div className={only === "bubble" ? "h-[620px] px-2 pb-2" : "h-[430px] px-2 pb-2"}>
            {sectors?.length ? <EChart option={bubbleOption(p, sectors, lang)} /> : <DataState />}
          </div>
        </Card>
      ),
    },
    {
      key: "distribution",
      node: (
        <Card
          index="04"
          title={zh ? "个股收益分布 · 连续渐变柱" : "Return distribution · gradient bins"}
          subtitle={zh ? "每根柱按自身收益取色 · 零轴 · 中位数参考" : "bin colour follows its return · zero line · median"}
          right={<GradientKey p={p} left={zh ? "跌" : "down"} right={zh ? "涨" : "up"} />}
          padded={false}
          bodyClass="pt-0"
          footer={<div className="provline"><span>SOURCE <b>daily</b></span><span>{zh ? "端点箱包含区间外收益" : "tail bins include outliers"}</span><span className="r">{`${zh ? "样本" : "n ="} ${distribution?.stats.n ?? "—"}`}</span></div>}
        >
          <div className={only === "distribution" ? "h-[560px] px-2 pb-2" : "h-[390px] px-2 pb-2"}>
            {distribution?.bins.length ? <EChart option={distOption(p, distribution.bins, distribution.stats, lang)} /> : <DataState />}
          </div>
        </Card>
      ),
    },
    {
      key: "treemap",
      node: (
        <Card
          index="05"
          title={zh ? "市场云图 · 连续收益色" : "Market cloud · continuous return colour"}
          subtitle={zh ? "面积 = 成交额 · 颜色 = 今日涨跌 · 成交额前 30" : "area = turnover · colour = return · top 30"}
          right={<GradientKey p={p} left={zh ? "跌" : "down"} right={zh ? "涨" : "up"} />}
          padded={false}
          bodyClass="pt-0"
          footer={<div className="provline"><span>SOURCE <b>daily</b></span><span>{zh ? "申万一级分组" : "SW L1 grouped"}</span><span className="r">{zh ? "点击色块可选行业" : "click to select"}</span></div>}
        >
          <div className={only === "treemap" ? "h-[650px] px-2 pb-2" : "h-[470px] px-2 pb-2"}>
            {stocks?.length ? <EChart option={treemapChart(p, stocks, lang)} /> : <DataState />}
          </div>
        </Card>
      ),
    },
    {
      key: "multiples",
      node: (
        <Card
          index="06"
          title={zh ? "行业月度收益 · 小倍数" : "Sector monthly paths · small multiples"}
          subtitle={zh ? "每个行业一张小图 · 按 12M 累计排序 · 替代 12 条线叠加" : "one panel per sector · sorted by 12M · replaces 12-line overlay"}
          right={<span className="micro text-[var(--faint)]">{zh ? "领涨 / 落后" : "top / bottom"}</span>}
          padded={false}
          bodyClass="pt-0"
        >
          <div className={only === "multiples" ? "px-3 pb-3 pt-2" : "px-3 pb-3"}>
            {small ? (
              <div className="grid gap-3">
                {[{ label: zh ? "领涨 6" : "Top 6", rows: small.top }, { label: zh ? "落后 6" : "Bottom 6", rows: small.bottom }].map((group) => (
                  <div key={group.label}>
                    <div className="micro mb-1.5">{group.label}</div>
                    <div className="grid grid-cols-3 gap-x-3 md:grid-cols-6">
                      {group.rows.map((s) => (
                        <div key={s.name} className="border-b border-[var(--border)] py-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[11.5px] text-[var(--text-2)]">{s.name}</span>
                            <span className={`mono text-[11px] ${s.score >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>{pct(s.score)}</span>
                          </div>
                          <MiniPath values={s.values} score={s.score} color={s.score >= 0 ? p.up : p.down} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <DataState />}
          </div>
        </Card>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead
        kicker={`DEMO / ${zh ? "图表方向" : "Chart directions"} / ${meta?.last_trade_date ?? "—"}`}
        title={zh ? "把连续数据画成连续颜色" : "Continuous data, continuous colour"}
        dek={zh ? "七个真实数据 Demo：渐变针线、渐变气泡、渐变分布、渐变云图、渐变状态云、六边形聚合、小倍数。" : "Six live-data demos: gradient lollipop, bubbles, distribution, cloud, regime and small multiples."}
        chips={<><span className="pill">A 渐变</span><span className="pill">B 小倍数</span><span className="pill">C 直接标注</span></>}
        right={<Link to="/" className="text-[12px] text-[var(--accent)] hover:underline">{zh ? "返回今日盘面 →" : "Back to Today →"}</Link>}
      />
      {only ? cards.find((c) => c.key === only)?.node ?? <div className="text-[12px] text-[var(--muted)]">Unknown demo</div> : <div className="grid gap-3.5 xl:grid-cols-2">{cards.map((c) => <div key={c.key}>{c.node}</div>)}</div>}
    </div>
  );
}
