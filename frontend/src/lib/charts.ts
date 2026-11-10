import type { EChartsOption } from "echarts";
import type { MarketDay, SectorDay } from "./api";
import { axisStyle, baseChart, type Palette } from "./theme";
import { shortDate } from "./format";
import { regimeOf, regimeLabel } from "./regime";

const axisDate = (rows: MarketDay[]) => rows.map((r) => shortDate(r.trade_date));

/** 参与广度：近 N 日 breadth 面积 + 背离点。 */
export function breadthArea(p: Palette, rows: MarketDay[]): EChartsOption {
  const x = axisDate(rows);
  const y = rows.map((r) => +(r.breadth * 100).toFixed(1));
  const diverge = rows.map((r) =>
    r.ew_ret > 0 && r.breadth < 0.45 ? [shortDate(r.trade_date), +(r.breadth * 100).toFixed(1)] : null,
  );
  return {
    ...baseChart(p),
    grid: { left: 4, right: 4, top: 10, bottom: 20, containLabel: true },
    xAxis: {
      type: "category",
      data: x,
      boundaryGap: false,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(x.length / 5)), fontSize: 10 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 10 },
      splitLine: { show: false },
    },
    series: [
      {
        type: "line",
        data: y,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { width: 1.6, color: p.accent },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(91,140,255,.28)" },
              { offset: 1, color: "rgba(91,140,255,0)" },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 50 }],
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
        },
      },
      {
        type: "scatter",
        data: diverge.filter(Boolean),
        symbolSize: 5,
        itemStyle: { color: p.up, borderColor: p.panel, borderWidth: 1 },
        z: 5,
      },
    ],
  };
}

/** 主图：上收益、下广度。 */
export function returnBreadth(p: Palette, rows: MarketDay[], lang: string): EChartsOption {
  const x = axisDate(rows);
  const ew = rows.map((r) => +(r.ew_ret * 100).toFixed(2));
  const hs = rows.map((r) => (r.hs300_ret === null ? null : +(r.hs300_ret * 100).toFixed(2)));
  const cw = rows.map((r) => (r.cw_ret === null ? null : +(r.cw_ret * 100).toFixed(2)));
  const br = rows.map((r) => +(r.breadth * 100).toFixed(1));

  return {
    ...baseChart(p),
    grid: [
      { left: 6, right: 10, top: 18, height: "52%", containLabel: true },
      { left: 6, right: 10, top: "73%", bottom: 6, containLabel: true },
    ],
    axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const i = arr?.[0]?.dataIndex ?? 0;
        const r = rows[i];
        if (!r) return "";
        const t = (k: string) => k;
        return `<div style="min-width:188px">
          <div style="font-family:'JetBrains Mono Variable',monospace;font-size:11px;color:${p.muted};margin-bottom:6px">${r.trade_date} · ${t(regimeLabel(regimeOf(r), lang))}</div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>等权收益</span><b style="color:${r.ew_ret >= 0 ? p.up : p.down}">${(r.ew_ret * 100).toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>沪深300</span><b>${r.hs300_ret === null ? "—" : (r.hs300_ret * 100).toFixed(2) + "%"}</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>上涨占比</span><b>${br[i]}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>上涨/下跌</span><b>${r.n_adv} / ${r.n_dec}</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>Top10 贡献</span><b>${((r.top10_share || 0) * 100).toFixed(0)}%</b></div>
        </div>`;
      },
    },
    xAxis: [
      {
        type: "category",
        data: x,
        gridIndex: 0,
        ...axisStyle(p),
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: "category",
        data: x,
        gridIndex: 1,
        ...axisStyle(p),
        splitLine: { show: false },
        axisLabel: {
          ...axisStyle(p).axisLabel,
          fontSize: 10,
          interval: Math.max(0, Math.floor(x.length / 8)),
        },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 10 },
        splitNumber: 3,
      },
      {
        type: "value",
        gridIndex: 1,
        min: 0,
        max: 100,
        ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 10 },
        splitNumber: 2,
      },
    ],
    series: [
      {
        name: "等权收益",
        type: "bar",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ew,
        barWidth: "62%",
        itemStyle: {
          color: (params: { value: number }) => (params.value >= 0 ? p.up : p.down),
          borderRadius: (params: { value: number }) => (params.value >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2]),
          opacity: 0.85,
        },
      },
      {
        name: "市值加权",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: cw,
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { width: 1, color: p.faint, type: "dotted" },
      },
      {
        name: "沪深300",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: hs,
        showSymbol: false,
        smooth: 0.2,
        lineStyle: { width: 1.2, color: p.text2, opacity: 0.75 },
      },
      {
        name: "上涨占比",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: br,
        showSymbol: false,
        smooth: 0.25,
        lineStyle: { width: 1.5, color: p.accent },
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
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 50 }],
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
        },
      },
    ],
  };
}

/** 行业气泡：收益 × 广度 × 成交额 × 内部分化。 */
export function sectorBubble(p: Palette, sectors: SectorDay[], lang: string): EChartsOption {
  const maxAmt = Math.max(...sectors.map((s) => s.amount || 0), 1);
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.ew_ret)), 0.005);
  const sorted = [...sectors].sort((a, b) => b.ew_ret - a.ew_ret);
  const labelSet = new Set([
    sorted[0].sw_l1,
    [...sectors].sort((a, b) => a.breadth - b.breadth)[0].sw_l1,
  ]);

  const mix = (a: number[], b: number[], t: number) =>
    `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  const colorOf = (r: number) => {
    const t = Math.min(1, Math.abs(r) / maxAbs);
    return r >= 0 ? mix([96, 42, 48], [240, 85, 90], 0.35 + t * 0.65) : mix([26, 66, 54], [35, 181, 125], 0.35 + t * 0.65);
  };

  const pts = sectors.map((s) => ({
    name: s.sw_l1,
    value: [+(s.ew_ret * 100).toFixed(2), +(s.breadth * 100).toFixed(1), s.amount || 0, s.n, +(s.iqr * 100).toFixed(2)],
    itemStyle: { color: colorOf(s.ew_ret) },
  }));
  const xs = pts.map((p2) => p2.value[0]);
  const xmin = Math.min(...xs, -1);
  const xmax = Math.max(...xs, 1);
  const pad = (xmax - xmin) * 0.1 + 0.25;
  const x0 = +(xmin - pad).toFixed(1);
  const x1 = +(xmax + pad).toFixed(1);

  const quad = (xa: number, xb: number, ya: number, yb: number) => [
    { xAxis: xa, yAxis: ya, itemStyle: { color: "transparent" }, label: { show: false } },
    { xAxis: xb, yAxis: yb },
  ];

  return {
    ...baseChart(p),
    grid: { left: 8, right: 18, top: 20, bottom: 24, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data: { name: string; value: number[] } };
        const [ret, breadth, amt, n, iqr] = q.data.value;
        return `<div style="min-width:158px">
          <div style="font-weight:600;margin-bottom:6px">${q.data.name}</div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>行业收益</span><b style="color:${ret >= 0 ? p.up : p.down}">${ret.toFixed(2)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>上涨占比</span><b>${breadth.toFixed(0)}%</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>内部分化</span><b>${iqr.toFixed(2)}pp</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>成交额</span><b>${(amt / 1e8).toFixed(0)}亿</b></div>
          <div style="display:flex;justify-content:space-between;gap:14px"><span>成分股</span><b>${n}</b></div>
        </div>`;
      },
    },
    xAxis: {
      type: "value",
      min: x0,
      max: x1,
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
        type: "scatter",
        data: pts,
        symbolSize: (val: number[]) => 8 + Math.sqrt((val[2] || 0) / maxAmt) * 24,
        itemStyle: { opacity: 0.9, borderColor: p.bg, borderWidth: 1 },
        emphasis: { itemStyle: { opacity: 1, borderColor: p.text, borderWidth: 1 }, scale: 1.12 },
        label: {
          show: true,
          formatter: (params: { data: { name: string } }) => (labelSet.has(params.data.name) ? params.data.name : ""),
          position: "top",
          distance: 6,
          color: p.text2,
          fontSize: 10,
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          data: [{ xAxis: 0 }, { yAxis: 50 }],
          label: { show: false },
        },
        markArea: {
          silent: true,
          data: [quad(0, x1, 50, 100), quad(0, x1, 0, 50), quad(x0, 0, 50, 100), quad(x0, 0, 0, 50)],
        },
      },
    ],
  };
}

/** 收益分布直方图。 */
export function distributionChart(
  p: Palette,
  bins: { b: number; n: number; lo: number; hi: number }[],
  stats: { med: number; p25: number; p75: number; n: number },
  lang: string,
): EChartsOption {
  const N = 44;
  const lo = -0.11;
  const hi = 0.11;
  const step = (hi - lo) / N;
  const counts = new Array(N).fill(0) as number[];
  bins.forEach((x) => {
    const i = Math.min(N - 1, Math.max(0, (x.b || 1) - 1));
    counts[i] += x.n;
  });
  const centers = Array.from({ length: N }, (_, i) => ((lo + (i + 0.5) * step) * 100));
  const data = counts.map((n, i) => ({
    value: [centers[i], n],
    itemStyle: {
      color: centers[i] >= 0 ? p.up : p.down,
      opacity: 0.78,
      borderRadius: 1.5,
    },
  }));

  return {
    ...baseChart(p),
    grid: { left: 6, right: 10, top: 16, bottom: 26, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      formatter: (params: unknown) => {
        const q = params as { data: { value: [number, number] } };
        const [c, n] = q.data.value;
        return `<div style="font-family:monospace">${c.toFixed(2)}% · ${n} ${lang === "en" ? "stocks" : "只"}</div>`;
      },
    },
    xAxis: {
      type: "value",
      min: -11,
      max: 11,
      splitNumber: 6,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: {
        ...axisStyle(p).axisLabel,
        formatter: "{value}%",
        fontSize: 10,
        showMinLabel: false,
        showMaxLabel: false,
      },
    },
    yAxis: { type: "value", ...axisStyle(p), axisLabel: { show: false }, splitLine: { show: false } },
    series: [
      {
        type: "bar",
        data,
        barWidth: 10,
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ xAxis: +(stats.med * 100).toFixed(2) }],
          lineStyle: { color: p.text2, width: 1, type: "dashed" },
          label: {
            show: true,
            formatter: lang === "en" ? "median" : "中位数",
            color: p.muted,
            fontSize: 9,
            position: "end",
          },
        },
        markArea: {
          silent: true,
          itemStyle: { color: "transparent" },
          data: [[{ xAxis: 0 }, { xAxis: 11 }]],
        },
      },
    ],
  };
}
