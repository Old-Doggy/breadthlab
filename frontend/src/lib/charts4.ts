import type { EChartsOption } from "echarts";
import { axisStyle, baseChart, type Palette } from "./theme";
import { shortDate } from "./format";

export interface LimitQuality {
  trade_date: string;
  fd_ratio: number | null;
  open_share: number | null;
  avg_open_times: number | null;
  n_limit_up: number;
}

/** 封板质量：封单额/流通市值中位数 + 开板比例。 */
export function limitQualityChart(p: Palette, rows: LimitQuality[], lang: string): EChartsOption {
  const x = rows.map((r) => shortDate(r.trade_date));
  const fd = rows.map((r) => (r.fd_ratio == null ? null : +(r.fd_ratio * 100).toFixed(2)));
  const open = rows.map((r) => (r.open_share == null ? null : +(r.open_share * 100).toFixed(1)));
  return {
    ...baseChart(p),
    grid: { left: 8, right: 10, top: 28, bottom: 22, containLabel: true },
    legend: {
      top: 2,
      right: 6,
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 3,
      textStyle: { color: p.muted, fontSize: 9.5 },
    },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const r = rows[arr[0].dataIndex];
        return `<div style="font-family:monospace;font-size:11px;color:${p.muted}">${r.trade_date}</div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${lang === "en" ? "Seal / float cap" : "封单/流通市值"}</span><b>${(r.fd_ratio ?? 0 * 1).toFixed(2)}%</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${lang === "en" ? "Opened once" : "开板比例"}</span><b>${((r.open_share ?? 0) * 100).toFixed(0)}%</b></div>
          <div style="display:flex;gap:16px;justify-content:space-between"><span>${lang === "en" ? "Limit-ups" : "涨停家数"}</span><b>${r.n_limit_up}</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: x,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9, interval: Math.max(0, Math.floor(x.length / 5)) },
    },
    yAxis: [
      {
        type: "value",
        ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 9 },
        splitNumber: 3,
      },
      {
        type: "value",
        min: 0,
        max: 100,
        ...axisStyle(p),
        splitLine: { show: false },
        axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 9 },
        splitNumber: 2,
      },
    ],
    series: [
      {
        name: lang === "en" ? "Seal / float cap (median)" : "封单/流通市值（中位数）",
        type: "line",
        data: fd,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { color: p.up, width: 1.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(240,85,90,.18)" },
              { offset: 1, color: "rgba(240,85,90,0)" },
            ],
          },
        },
      },
      {
        name: lang === "en" ? "Opened once" : "开板比例",
        type: "line",
        yAxisIndex: 1,
        data: open,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { color: p.accent, width: 1.2, type: "dashed", opacity: 0.85 },
      },
    ],
  };
}
