import type { EChartsOption } from "echarts";
import type { RotationDay, SectorRank } from "./api";
import { axisStyle, baseChart, type Palette, SW_COLORS } from "./theme";
import { shortDate } from "./format";

/** 行业排名迁移（bump chart）：排名按 20 日累计收益。 */
export function rotationBump(p: Palette, ranks: SectorRank[], lang: string, topN = 8): EChartsOption {
  const dates = [...new Set(ranks.map((r) => r.trade_date))].sort();
  const bySector = new Map<string, Map<string, number>>();
  ranks.forEach((r) => {
    if (!bySector.has(r.sw_l1)) bySector.set(r.sw_l1, new Map());
    bySector.get(r.sw_l1)!.set(r.trade_date, r.rank20);
  });
  // 以最近 60 日均排名挑选最稳定的 topN
  const recent = dates.slice(-60);
  const score = [...bySector.entries()].map(([name, m]) => {
    const vals = recent.map((d) => m.get(d)).filter((v): v is number => v != null);
    return { name, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 99 };
  });
  const picked = score.sort((a, b) => a.avg - b.avg).slice(0, topN).map((s) => s.name);

  return {
    ...baseChart(p),
    grid: { left: 8, right: 64, top: 16, bottom: 24, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { seriesName: string; value: [string, number] }[];
        const rows = arr
          .filter((a) => a.value?.[1] != null)
          .sort((a, b) => a.value[1] - b.value[1])
          .slice(0, 8)
          .map(
            (a) =>
              `<div style="display:flex;justify-content:space-between;gap:14px"><span>${a.seriesName}</span><b>#${a.value[1]}</b></div>`,
          )
          .join("");
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted};margin-bottom:4px">${arr[0]?.value?.[0] ?? ""}</div>${rows}`;
      },
    },
    xAxis: {
      type: "category",
      data: dates.map(shortDate),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(dates.length / 6)) },
    },
    yAxis: {
      type: "value",
      inverse: true,
      min: 1,
      max: bySector.size,
      interval: 5,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, formatter: "#{value}" },
      splitLine: { lineStyle: { color: p.grid, type: "dashed" } },
    },
    series: picked.map((name, i) => ({
      name,
      type: "line",
      data: dates.map((d) => [shortDate(d), bySector.get(name)?.get(d) ?? null]),
      showSymbol: false,
      smooth: 0.15,
      connectNulls: true,
      lineStyle: { width: 1.5, color: SW_COLORS[i % SW_COLORS.length], opacity: 0.85 },
      endLabel: {
        show: true,
        formatter: name,
        color: SW_COLORS[i % SW_COLORS.length],
        fontSize: 9,
        distance: 6,
      },
      emphasis: { focus: "series" },
    })),
  };
}

/** 轮动强度：行业排名日变化的均值。 */
export function rotationIntensity(p: Palette, rows: RotationDay[], lang: string): EChartsOption {
  const avg = rows.reduce((a, r) => a + r.rotation_intensity, 0) / Math.max(1, rows.length);
  return {
    ...baseChart(p),
    grid: { left: 8, right: 10, top: 16, bottom: 22, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const r = rows[arr[0].dataIndex];
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted}">${r.trade_date}</div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${lang === "en" ? "Rotation" : "轮动强度"}</span><b>${r.rotation_intensity.toFixed(2)}</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((r) => shortDate(r.trade_date)),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(rows.length / 5)) },
    },
    yAxis: {
      type: "value",
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9 },
      splitNumber: 3,
    },
    series: [
      {
        type: "line",
        data: rows.map((r) => +r.rotation_intensity.toFixed(2)),
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
              { offset: 0, color: "rgba(91,140,255,.20)" },
              { offset: 1, color: "rgba(91,140,255,0)" },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: +avg.toFixed(2) }],
          lineStyle: { color: p.warn, type: "dashed", width: 1 },
          label: { formatter: `${lang === "en" ? "avg" : "均值"} ${avg.toFixed(2)}`, color: p.muted, fontSize: 9 },
        },
      },
    ],
  };
}

/** 排名迁移矩阵：行=行业，列=周，颜色=20 日收益排名（越红越强）。 */
export function sectorRankHeatmap(p: Palette, ranks: SectorRank[], lang: string, weeks = 26): EChartsOption {
  const dates = [...new Set(ranks.map((r) => r.trade_date))].sort();
  const sampledAll = dates.filter((_, i) => i % 5 === 0 || i === dates.length - 1);
  const sampled = sampledAll.slice(-weeks);
  const bySector = new Map<string, Map<string, number>>();
  ranks.forEach((r) => {
    if (!bySector.has(r.sw_l1)) bySector.set(r.sw_l1, new Map());
    bySector.get(r.sw_l1)!.set(r.trade_date, r.rank20);
  });
  const score = [...bySector.entries()].map(([name, m]) => {
    const vals = sampled.map((d) => m.get(d)).filter((v): v is number => v != null);
    return { name, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 99 };
  });
  const sectors = score.sort((a, b) => a.avg - b.avg).map((s) => s.name);
  const idxS = new Map(sectors.map((s, i) => [s, i]));
  const data: [number, number, number][] = [];
  sampled.forEach((d, w) => {
    sectors.forEach((s) => {
      const v = bySector.get(s)?.get(d);
      if (v != null) data.push([w, idxS.get(s)!, v]);
    });
  });
  const n = sectors.length;

  return {
    ...baseChart(p),
    grid: { left: 8, right: 14, top: 8, bottom: 42, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data: [number, number, number] };
        const [w, si, v] = q.data;
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted}">${sampled[w]}</div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${sectors[si]}</span><b>#${v}</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: sampled.map(shortDate),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(sampled.length / 6)) },
    },
    yAxis: {
      type: "category",
      data: sectors,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9 },
    },
    visualMap: {
      min: 1,
      max: n,
      right: 0,
      bottom: 0,
      itemWidth: 8,
      itemHeight: 56,
      text: [lang === "en" ? "#1" : "强", lang === "en" ? `#${n}` : "弱"],
      textStyle: { color: p.muted, fontSize: 9 },
      inRange: { color: ["#f0555a", "#2a2f38", "#23b57d"] },
      formatter: (v: number) => `#${Math.round(v)}`,
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