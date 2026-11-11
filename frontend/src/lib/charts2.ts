import type { EChartsOption } from "echarts";
import type { MarketDay, SectorDay, StockRow } from "./api";
import { axisStyle, baseChart, type Palette } from "./theme";
import { money, shortDate } from "./format";
import { regimeOf, regimeLabel, type RegimeKey } from "./regime";

export const regimeColor = (k: RegimeKey): string =>
  k === "broad_up"
    ? "#e5484d"
    : k === "concentrated_up"
      ? "#c9a227"
      : k === "broad_down"
        ? "#1fa97a"
        : "#8b94a7";


const xs = (rows: MarketDay[]) => rows.map((r) => shortDate(r.trade_date));
const L = (lang: string, zh: string, en: string) => (lang === "en" ? en : zh);

const hex = (h: string) => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const mix = (a: string, b: string, k: number) => {
  const A = hex(a), B = hex(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("");
};

/** 市场云图：成交额 × 涨跌，按申万一级分组。 */
export function treemapChart(p: Palette, stocks: StockRow[], lang = "zh"): EChartsOption {
  const top = [...stocks].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 30);
  const total = top.reduce((a, s) => a + (s.amount || 0), 0) || 1;
  const groups = new Map<string, StockRow[]>();
  top.forEach((s) => {
    const k = s.sw_l1 || L(lang, "未分类", "Other");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  });
  const onLight = p.bg === "#f6f2e8";
  const colorOf = (ret: number) => {
    if (Math.abs(ret) < 0.0004) return p.panel3;
    const k = Math.min(1, Math.abs(ret) / 0.05);
    return mix(p.panel3, ret > 0 ? p.up : p.down, 0.55 + k * 0.45);
  };
  const data = [...groups.entries()].map(([name, arr]) => ({
    name,
    value: arr.reduce((a, s) => a + (s.amount || 0), 0),
    itemStyle: { color: p.panel2 },
    label: { show: false },
    children: arr.map((s) => {
      const ratio = (s.amount || 0) / total;
      return {
        name: s.name,
        value: s.amount || 0,
        ret: s.ret,
        code: s.ts_code,
        sector: s.sw_l1,
        itemStyle: { color: colorOf(s.ret || 0) },
        label: {
          show: ratio > 0.0035,
          color: onLight && Math.abs(s.ret || 0) < 0.0004 ? "#1a1b1d" : "#ffffff",
          fontSize: ratio > 0.02 ? 11.5 : 10.5,
          lineHeight: ratio > 0.012 ? 12 : 11,
          overflow: "break" as const,
          formatter: () => {
            const ret = (s.ret * 100).toFixed(2) + "%";
            return ratio > 0.012 ? `${s.name}\n${ret}` : s.name;
          },
        },
      };
    }),
  }));

  return {
    ...baseChart(p),
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data?: { name?: string; ret?: number; code?: string; value?: number; other?: number } };
        const d = q.data || {};
        if (d.ret === undefined) return `<div style="font-weight:600">${d.name ?? ""}</div>`;
        return `<div style="min-width:150px">
          <div style="font-weight:600;margin-bottom:4px">${d.name}${d.code ? ` <span style="font-family:monospace;font-size:9px;color:${p.muted}">${d.code}</span>` : ""}</div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "涨跌", "Return")}</span><b style="color:${(d.ret || 0) >= 0 ? p.up : p.down}">${((d.ret || 0) * 100).toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "成交额", "Turnover")}</span><b>${money((d.value || 0))}</b></div>${d.other ? `<div style="display:flex;justify-content:space-between;gap:14px"><span>${L(lang, "合并股票", "Merged")}</span><b>${d.other}</b></div>` : ""}
        </div>`;
      },
    },
    series: [
      {
        type: "treemap",
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        leafDepth: 2,
        data,
        levels: [
          { itemStyle: { borderColor: p.bg, borderWidth: 2, gapWidth: 2 }, upperLabel: { show: false } },
          {
            itemStyle: { borderColor: p.bg, borderWidth: 1, gapWidth: 1 },
            upperLabel: {
              show: true,
              height: 16,
              color: p.text2,
              fontSize: 11,
              fontFamily: "JetBrains Mono Variable, monospace",
              backgroundColor: "transparent",
            },
          },
        ],
        label: {
          show: true,
          color: "#ffffff",
          fontSize: 11,
          lineHeight: 12,
          overflow: "truncate",
          formatter: (params: any) => {
            const d = params.data || {};
            if (d.ret === undefined) return d.name ?? "";
            return `${d.name}\n${(d.ret * 100).toFixed(2)}%`;
          },
        },
        upperLabel: {
          show: true,
          height: 16,
          color: p.text2,
          fontSize: 11,
          fontFamily: "JetBrains Mono Variable, monospace",
        },
        itemStyle: { gapWidth: 1, borderColor: p.bg },
      },
    ],
  };
}

/** 集中度：Top10 周均贡献 + 20 日均值。 */
export function concentrationChart(p: Palette, rows: MarketDay[], lang = "zh"): EChartsOption {
  const roll = (vals: number[], w = 20) =>
    vals.map((_, i) => {
      if (i < w - 1) return null;
      const s = vals.slice(i - w + 1, i + 1).reduce((a, b) => a + b, 0);
      return +(s / w).toFixed(1);
    });
  const top10 = rows.map((r) => +(((r.top10_share || 0) * 100).toFixed(1)));
  const gain = rows.map((r) => +(((r.gain_share_top5pct || 0) * 100).toFixed(1)));
  const avg10 = roll(top10);

  const weekly: { date: string; top10: number; avg: number | null; gain: number; hhi: number }[] = [];
  for (let i = 0; i < rows.length; i += 5) {
    const chunk = rows.slice(i, i + 5);
    const end = i + chunk.length - 1;
    const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    weekly.push({
      date: rows[end].trade_date,
      top10: +mean(chunk.map((r) => (r.top10_share || 0) * 100)).toFixed(1),
      avg: avg10[end],
      gain: +mean(chunk.map((r) => (r.gain_share_top5pct || 0) * 100)).toFixed(0),
      hhi: +mean(chunk.map((r) => r.hhi || 0)).toFixed(0),
    });
  }

  return {
    ...baseChart(p),
    grid: { left: 6, right: 10, top: 18, bottom: 24, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const w = weekly[arr?.[0]?.dataIndex ?? 0];
        if (!w) return "";
        return `<div style="min-width:176px">
          <div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${w.date} ${L(lang, "周均", "week avg")}</div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "Top10 波动占比", "Top10 share")}</span><b>${w.top10.toFixed(1)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "20 日均值", "20d avg")}</span><b>${w.avg === null ? "—" : w.avg + "%"}</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "涨幅前 5% 份额", "Top 5% gain share")}</span><b>${w.gain}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>HHI</span><b>${w.hhi}</b></div>
        </div>`;
      },
    },
    xAxis: {
      type: "category",
      data: weekly.map((w) => shortDate(w.date)),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(weekly.length / 5)) },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 20,
      interval: 5,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%" },
    },
    series: [
      {
        name: lang === "en" ? "Top10 weekly avg" : "Top10 周均值",
        type: "bar",
        data: weekly.map((w) => w.top10),
        barWidth: "55%",
        itemStyle: { color: p.text2, opacity: 0.38, borderRadius: 2 },
        silent: true,
      },
      {
        name: lang === "en" ? "Top10 20d avg" : "Top10 20 日均值",
        type: "line",
        data: weekly.map((w) => w.avg),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color: p.accent, width: 2 },
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
    graphic: [
      { type: "text", left: "9%", top: 44, style: { text: L(lang, "集中上涨", "Narrow rally"), fill: p.faint, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" } },
      { type: "text", right: "5%", top: 44, style: { text: L(lang, "普涨", "Broad rally"), fill: p.faint, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" } },
      { type: "text", left: "9%", bottom: 32, style: { text: L(lang, "普跌", "Broad selloff"), fill: p.faint, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" } },
      { type: "text", right: "5%", bottom: 32, style: { text: L(lang, "结构分化", "Divergent"), fill: p.faint, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" } },
    ],
    legend: {
      top: 4,
      right: 8,
      icon: "circle",
      itemWidth: 7,
      itemHeight: 7,
      itemGap: 14,
      data: keys.map((k) => regimeLabel(k, lang)),
      textStyle: { color: p.muted, fontSize: 11.5 },
    },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { seriesName: string; data: { value: number[]; trade_date: string } };
        const [ret, breadth, , csd] = q.data.value;
        return `<div style="min-width:158px">
          <div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${q.data.trade_date}</div>
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
          fontSize: 11,
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
        return `<div style="font-family:monospace;font-size:12px;color:${p.muted}">${r.trade_date}</div>
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
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(rows.length / 5)), fontSize: 11 },
    },
    yAxis: {
      type: "value",
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}pp", fontSize: 11 },
      splitNumber: 3,
    },
    series: [
      {
        name: lang === "en" ? "Cross-section SD" : "横截面标准差",
        type: "line",
        data: rows.map((r) => +(r.csd * 100).toFixed(2)),
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { color: p.text2, width: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(168,162,154,.10)" },
              { offset: 1, color: "rgba(168,162,154,0)" },
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
        lineStyle: { color: p.accent, width: 1.8, opacity: 0.95 },
      },
    ],
  };
}
