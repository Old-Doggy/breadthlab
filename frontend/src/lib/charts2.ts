import type { EChartsOption } from "echarts";
import type { MarketDay } from "./api";
import { axisStyle, baseChart, type Palette } from "./theme";
import { shortDate } from "./format";
import { regimeOf, regimeLabel, type RegimeKey } from "./regime";

export const regimeColor = (k: RegimeKey): string =>
  k === "broad_up"
    ? "#f0555a"
    : k === "concentrated_up"
      ? "#e8a33d"
      : k === "broad_down"
        ? "#23b57d"
        : "#8b94a7";


const xs = (rows: MarketDay[]) => rows.map((r) => shortDate(r.trade_date));
const L = (lang: string, zh: string, en: string) => (lang === "en" ? en : zh);

/** 集中度：Top10 贡献占比 + 涨幅前 5% 股票的收益份额。 */
export function concentrationChart(p: Palette, rows: MarketDay[], lang = "zh"): EChartsOption {
  const roll = (vals: number[], w = 20) =>
    vals.map((_, i) => {
      if (i < w - 1) return null;
      const s = vals.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0);
      return +((s / w) * 100).toFixed(1);
    });
  const top10 = rows.map((r) => (r.top10_share || 0) * 100);
  const gain = rows.map((r) => (r.gain_share_top5pct || 0) * 100);

  return {
    ...baseChart(p),
    grid: { left: 4, right: 8, top: 14, bottom: 18, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const i = arr[0].dataIndex;
        const r = rows[i];
        const t10 = roll(top10)[i];
        const gn = roll(gain)[i];
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted}">${r.trade_date}</div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${L(lang, "Top10 波动占比", "Top10 share")}</span><b>${top10[i].toFixed(0)}%</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${L(lang, "20日均值", "20d avg")}</span><b>${t10 === null ? "—" : t10.toFixed(0) + "%"}</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${L(lang, "涨幅前5%份额", "Top 5% gain share")}</span><b>${gn === null ? "—" : gn.toFixed(0) + "%"}</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>HHI</span><b>${(r.hhi || 0).toFixed(0)}</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: xs(rows),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(rows.length / 5)), fontSize: 10 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 10 },
      splitNumber: 3,
    },
    series: [
      {
        name: lang === "en" ? "Top10 daily" : "Top10 日值",
        type: "bar",
        data: top10.map((v) => +v.toFixed(1)),
        barWidth: "45%",
        itemStyle: { color: p.accent, opacity: 0.16, borderRadius: 1 },
        silent: true,
      },
      {
        name: lang === "en" ? "Top10 20d avg" : "Top10 20日均值",
        type: "line",
        data: roll(top10),
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { color: p.accent, width: 1.8 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(91,140,255,.20)" },
              { offset: 1, color: "rgba(91,140,255,0)" },
            ],
          },
        },
      },
      {
        name: lang === "en" ? "Top5% gainers share · 20d avg" : "涨幅前5%份额 · 20日均值",
        type: "line",
        data: roll(gain),
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { color: p.up, width: 1.2, type: "dashed", opacity: 0.85 },
      },
    ],
  };
}

/** 行业月度热力图。 */
export function sectorHeatmap(
  p: Palette,
  monthly: { month: string; sw_l1: string; ew_ret_cum: number; breadth: number }[],
  lang: string,
): EChartsOption {
  const months = [...new Set(monthly.map((m) => m.month))].sort();
  const total: Record<string, number> = {};
  monthly.forEach((m) => (total[m.sw_l1] = (total[m.sw_l1] || 0) + m.ew_ret_cum));
  const sectors = [...new Set(monthly.map((m) => m.sw_l1))].sort((a, b) => (total[b] || 0) - (total[a] || 0));
  const idxM = new Map(months.map((m, i) => [m, i]));
  const idxS = new Map(sectors.map((s, i) => [s, i]));
  const data = monthly.map((m) => [idxM.get(m.month), idxS.get(m.sw_l1), +(m.ew_ret_cum * 100).toFixed(2)]);
  const vals = data.map((d) => d[2] as number);
  const vmax = Math.max(...vals.map(Math.abs), 1);

  return {
    ...baseChart(p),
    grid: { left: 8, right: 12, top: 8, bottom: 44, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data: [number, number, number] };
        const [mi, si, v] = q.data;
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted}">${months[mi]}</div>
          <div style="display:flex;justify-content:space-between;gap:18px"><span>${sectors[si]}</span><b style="color:${v >= 0 ? p.up : p.down}">${v.toFixed(2)}%</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: months,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: {
        ...axisStyle(p).axisLabel,
        fontSize: 9,
        interval: Math.max(0, Math.floor(months.length / 8)),
        formatter: (v: string) => (lang === "en" ? v.slice(2) : v.slice(2, 7)),
      },
    },
    yAxis: {
      type: "category",
      data: sectors,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9.5, color: p.muted },
    },
    visualMap: {
      min: -vmax,
      max: vmax,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 70,
      textStyle: { color: p.muted, fontSize: 9 },
      inRange: { color: ["#23b57d", "#0f1720", "#f0555a"] },
      text: [`+${vmax.toFixed(0)}%`, `-${vmax.toFixed(0)}%`],
      formatter: (v: number) => `${v.toFixed(0)}%`,
    },
    series: [
      {
        type: "heatmap",
        data,
        itemStyle: { borderColor: p.panel, borderWidth: 1, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: p.text, borderWidth: 1 } },
        progressive: 2000,
      },
    ],
  };
}

export function regimeScatter(
  p: Palette,
  rows: MarketDay[],
  selected: string | null,
  lang: string,
  trailN = 30,
): EChartsOption {
  const keys: RegimeKey[] = ["broad_up", "concentrated_up", "mixed", "broad_down"];
  const amtMax = Math.max(...rows.map((r) => r.amount || 0), 1);
  const groups: Record<string, { value: number[]; trade_date: string }[]> = {};
  keys.forEach((k) => (groups[k] = []));
  rows.forEach((r) => {
    groups[regimeOf(r)].push({
      value: [+(r.ew_ret * 100).toFixed(2), +(r.breadth * 100).toFixed(1), r.amount || 0, r.csd],
      trade_date: r.trade_date,
    });
  });

  const xsAll = rows.map((r) => r.ew_ret * 100);
  const bound = Math.max(1, Math.ceil(Math.max(...xsAll.map(Math.abs)) * 2) / 2);
  const trail = rows.slice(-trailN);

  return {
    ...baseChart(p),
    grid: { left: 10, right: 18, top: 42, bottom: 12, containLabel: true },
    legend: {
      top: 4,
      right: 8,
      icon: "circle",
      itemWidth: 7,
      itemHeight: 7,
      itemGap: 14,
      data: keys.map((k) => regimeLabel(k, lang)),
      textStyle: { color: p.muted, fontSize: 10.5 },
    },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { seriesName: string; data: { value: number[]; trade_date: string } };
        const [ret, breadth, , csd] = q.data.value;
        return `<div style="min-width:158px">
          <div style="font-family:monospace;font-size:11px;color:${p.muted};margin-bottom:5px">${q.data.trade_date}</div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "等权收益", "EW return")}</span><b style="color:${ret >= 0 ? p.up : p.down}">${ret.toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "上涨占比", "Breadth")}</span><b>${breadth.toFixed(0)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "分化度", "Dispersion")}</span><b>${(csd * 100).toFixed(2)}pp</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "状态", "Regime")}</span><b>${q.seriesName}</b></div>
        </div>`;
      },
    },
    xAxis: {
      type: "value",
      min: -bound,
      max: bound,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%" },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%" },
    },
    series: [
      {
        type: "line",
        data: trail.map((r) => [+(r.ew_ret * 100).toFixed(2), +(r.breadth * 100).toFixed(1)]),
        showSymbol: false,
        silent: true,
        z: 1,
        lineStyle: { color: p.accent, width: 1, opacity: 0.45, type: "dashed" },
      },
      ...keys.map((k) => ({
        name: regimeLabel(k, lang),
        type: "scatter" as const,
        data: groups[k],
        symbolSize: (val: number[]) => 5 + Math.sqrt((val[2] || 0) / amtMax) * 9,
        itemStyle: { color: regimeColor(k), opacity: 0.62, borderWidth: 0 },
        emphasis: { itemStyle: { opacity: 1 }, scale: 1.25 },
        z: 2,
      })),
      {
        type: "effectScatter",
        data: rows
          .filter((r) => r.trade_date === selected)
          .map((r) => ({
            value: [+(r.ew_ret * 100).toFixed(2), +(r.breadth * 100).toFixed(1)],
            trade_date: r.trade_date,
          })),
        symbolSize: 13,
        rippleEffect: { scale: 2.6, brushType: "stroke" },
        itemStyle: { color: "transparent", borderColor: p.text, borderWidth: 1.6 },
        label: {
          show: true,
          formatter: lang === "en" ? "selected" : "选中",
          position: "right",
          color: p.text2,
          fontSize: 10,
        },
        z: 6,
        silent: true,
      },
    ],
  };
}

export function dispersionChart(p: Palette, rows: MarketDay[], lang = "zh"): EChartsOption {
  return {
    ...baseChart(p),
    grid: { left: 4, right: 8, top: 14, bottom: 18, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const r = rows[arr[0].dataIndex];
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted}">${r.trade_date}</div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${L(lang, "横截面标准差", "Cross-sectional σ")}</span><b>${(r.csd * 100).toFixed(2)}pp</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>IQR</span><b>${(r.iqr * 100).toFixed(2)}pp</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${L(lang, "等权-加权", "EW − CW")}</span><b>${(r.ew_cw_gap * 100).toFixed(2)}%</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: xs(rows),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(rows.length / 5)), fontSize: 10 },
    },
    yAxis: {
      type: "value",
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}pp", fontSize: 10 },
      splitNumber: 3,
    },
    series: [
      {
        name: lang === "en" ? "Cross-section SD" : "横截面标准差",
        type: "line",
        data: rows.map((r) => +(r.csd * 100).toFixed(2)),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color: p.text2, width: 1.3 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(185,194,208,.16)" },
              { offset: 1, color: "rgba(185,194,208,0)" },
            ],
          },
        },
      },
      {
        name: lang === "en" ? "IQR" : "IQR",
        type: "line",
        data: rows.map((r) => +(r.iqr * 100).toFixed(2)),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color: p.accent, width: 1.2, opacity: 0.85 },
      },
    ],
  };
}
