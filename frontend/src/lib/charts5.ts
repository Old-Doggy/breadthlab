import type { EChartsOption } from "echarts";
import { axisStyle, baseChart, seriesColors, type Palette } from "./theme";

export interface BookRow {
  ts_code: string;
  name: string;
  sw_l1: string;
  close: number;
  ret: number;
  shares: number;
  cost: number;
  mv: number;
  pnl: number;
  today: number;
}

const L = (lang: string, zh: string, en: string) => (lang === "en" ? en : zh);

/** 行业暴露：按市值占比的横向条形。 */
export function sectorExposureChart(p: Palette, rows: BookRow[], lang = "zh"): EChartsOption {
  const groups = new Map<string, { mv: number; n: number }>();
  rows.forEach((r) => {
    const k = r.sw_l1 || L(lang, "未分类", "Other");
    const cur = groups.get(k) || { mv: 0, n: 0 };
    cur.mv += r.mv || 0;
    cur.n += 1;
    groups.set(k, cur);
  });
  const total = [...groups.values()].reduce((a, s) => a + s.mv, 0) || 1;
  const data = [...groups.entries()]
    .map(([name, s], i) => ({
      name,
      value: +((s.mv / total) * 100).toFixed(1),
      n: s.n,
      itemStyle: { color: seriesColors(p)[i % seriesColors(p).length], borderRadius: 2 },
    }))
    .sort((a, b) => a.value - b.value);

  return {
    ...baseChart(p),
    grid: { left: 6, right: 30, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data?: { name?: string; value?: number; n?: number } };
        const d = q.data || {};
        return `<div style="min-width:150px">
          <div style="font-weight:600;margin-bottom:3px">${d.name ?? ""}</div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "组合权重", "Book weight")}</span><b>${(d.value ?? 0).toFixed(1)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "持仓数", "Positions")}</span><b>${d.n ?? 0}</b></div>
        </div>`;
      },
    },
    xAxis: {
      type: "value",
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%" },
      splitNumber: 2,
    },
    yAxis: {
      type: "category",
      data: data.map((d) => d.name),
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, color: p.text2, fontSize: 11.5 },
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data,
        barWidth: 9,
        label: {
          show: true,
          position: "right",
          formatter: (params: any) => `${Number(params.value).toFixed(0)}%`,
          color: p.text2,
          fontSize: 11,
          fontFamily: "JetBrains Mono Variable, monospace",
        },
      },
    ],
  };
}

/** 今日盈亏贡献：按个股正负横向条形。 */
export function contributionChart(p: Palette, rows: BookRow[], lang = "zh", limit = 10): EChartsOption {
  const data = rows
    .filter((r) => r.shares > 0)
    .map((r) => ({ name: r.name, value: +(r.today || 0).toFixed(0), ret: r.ret }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit)
    .reverse();
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);

  return {
    ...baseChart(p),
    grid: { left: 6, right: 34, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data?: { name?: string; value?: number; ret?: number } };
        const d = q.data || {};
        return `<div style="min-width:150px">
          <div style="font-weight:600;margin-bottom:3px">${d.name ?? ""}</div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "今日盈亏", "Today P&L")}</span><b style="color:${(d.value ?? 0) >= 0 ? p.up : p.down}">¥${Math.abs(d.value ?? 0).toLocaleString("en-US")}</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "当日涨跌", "Return")}</span><b>${((d.ret ?? 0) * 100).toFixed(2)}%</b></div>
        </div>`;
      },
    },
    xAxis: {
      type: "value",
      min: -max,
      max,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: number) => `${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v}` },
      splitNumber: 2,
    },
    yAxis: {
      type: "category",
      data: data.map((d) => d.name),
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, color: p.text2, fontSize: 11.5 },
      splitLine: { show: false },
    },
    series: [
      {
        type: "bar",
        data: data.map((d) => ({
          ...d,
          itemStyle: { color: d.value >= 0 ? p.up : p.down, borderRadius: d.value >= 0 ? [0, 2, 2, 0] : [2, 0, 0, 2] },
        })),
        barWidth: 9,
        label: {
          show: true,
          position: "right",
          formatter: (params: any) => {
            const v = Number(params.value);
            return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US")}`;
          },
          color: p.muted,
          fontSize: 11,
          fontFamily: "JetBrains Mono Variable, monospace",
        },
      },
    ],
  };
}
