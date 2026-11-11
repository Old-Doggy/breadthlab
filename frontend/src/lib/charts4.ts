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

/** 封板质量：封单额 / 流通市值中位数。开板比例放 tooltip，避免第二条轴。 */
export function limitQualityChart(p: Palette, rows: LimitQuality[], lang: string): EChartsOption {
  const x = rows.map((r) => shortDate(r.trade_date));
  const fd = rows.map((r) => (r.fd_ratio == null ? null : +(r.fd_ratio * 100).toFixed(2)));
  const valid = fd.filter((v): v is number => v != null);
  const max = Math.max(...valid, 1) * 1.25;
  const median = valid.length ? [...valid].sort((a, b) => a - b)[Math.floor(valid.length / 2)] : null;

  return {
    ...baseChart(p),
    grid: { left: 8, right: 12, top: 18, bottom: 24, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const i = arr?.[0]?.dataIndex ?? 0;
        const r = rows[i];
        if (!r) return "";
        return `<div style="min-width:168px">
          <div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${r.trade_date}</div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${lang === "en" ? "Seal / float cap" : "封单 / 流通市值"}</span><b>${fd[i] == null ? "—" : fd[i] + "%"}</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${lang === "en" ? "Opened share" : "开板比例"}</span><b>${r.open_share == null ? "—" : (r.open_share * 100).toFixed(0) + "%"}</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${lang === "en" ? "Avg open times" : "平均开板次数"}</span><b>${r.avg_open_times?.toFixed(2) ?? "—"}</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>${lang === "en" ? "Limit-ups" : "涨停家数"}</span><b>${r.n_limit_up}</b></div>
        </div>`;
      },
    },
    xAxis: {
      type: "category",
      data: x,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(x.length / 6)) },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: +max.toFixed(1),
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%" },
      splitNumber: 3,
    },
    series: [
      {
        name: lang === "en" ? "Seal / float cap (median)" : "封单 / 流通市值（中位数）",
        type: "line",
        data: fd,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { color: p.accent, width: 1.5 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: `${p.accent}2e` }, { offset: 1, color: `${p.accent}00` }],
          },
        },
        markLine: median == null ? undefined : {
          silent: true,
          symbol: "none",
          data: [{ yAxis: +median.toFixed(2) }],
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
        },
      },
    ],
  };
}
