import type { EChartsOption } from "echarts";
import type { RotationDay, SectorRank } from "./api";
import { axisStyle, baseChart, type Palette, seriesColors } from "./theme";
import { shortDate } from "./format";

const L = (lang: string, zh: string, en: string) => (lang === "en" ? en : zh);

/** 行业排名迁移（bump chart）：20 日收益排名，按周采样。 */
export function rotationBump(
  p: Palette,
  ranks: SectorRank[],
  lang: string,
  selected?: string | null,
  topN = 6,
): EChartsOption {
  const datesAll = [...new Set(ranks.map((r) => r.trade_date))].sort();
  const recent = datesAll.slice(-130);
  const dates = recent.filter((_, i) => i % 5 === 0 || i === recent.length - 1);
  const bySector = new Map<string, Map<string, number>>();
  ranks.forEach((r) => {
    if (!bySector.has(r.sw_l1)) bySector.set(r.sw_l1, new Map());
    bySector.get(r.sw_l1)!.set(r.trade_date, r.rank20);
  });
  const stats = [...bySector.entries()].map(([name, m]) => {
    const vals = dates.map((d) => m.get(d)).filter((v): v is number => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 99;
    const range = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    return { name, avg, range };
  });
  const stable = [...stats].sort((a, b) => a.avg - b.avg).slice(0, 3).map((s) => s.name);
  const movers = [...stats].sort((a, b) => b.range - a.range).slice(0, 2).map((s) => s.name);
  const picked = [...new Set([...stable, ...movers])].slice(0, topN);
  if (selected && !picked.includes(selected)) picked[picked.length - 1] = selected;

  return {
    ...baseChart(p),
    grid: { left: 8, right: 58, top: 14, bottom: 52, containLabel: true },
    legend: {
      show: true,
      bottom: 0,
      left: 8,
      right: 8,
      icon: "circle",
      itemWidth: 6,
      itemHeight: 6,
      itemGap: 10,
      textStyle: { color: p.muted, fontSize: 11 },
      data: picked,
    },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number; seriesName: string; value: number | null }[];
        const date = dates[arr[0]?.dataIndex ?? 0] ?? "";
        const rows = [...arr]
          .filter((a) => a.value != null)
          .sort((a, b) => Number(a.value) - Number(b.value))
          .map(
            (a) =>
              `<div style="display:flex;justify-content:space-between;gap:14px"><span>${a.seriesName}</span><b>#${a.value}</b></div>`,
          )
          .join("");
        return `<div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:4px">${shortDate(date)}</div>${rows}`;
      },
    },
    xAxis: {
      type: "category",
      data: dates.map(shortDate),
      boundaryGap: false,
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: {
        ...axisStyle(p).axisLabel,
        fontSize: 11,
        hideOverlap: true,
        interval: Math.max(1, Math.floor(dates.length / 5)),
      },
    },
    yAxis: {
      type: "value",
      inverse: true,
      min: 1,
      max: bySector.size,
      interval: 5,
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 11, formatter: "#{value}" },
      splitLine: { lineStyle: { color: p.grid } },
    },
    series: picked.map((name, i) => {
      const isSel = name === selected;
      const hasSelection = !!selected;
      const color = isSel ? p.copper : seriesColors(p)[i % seriesColors(p).length];
      return {
        name,
        type: "line" as const,
        data: dates.map((d) => bySector.get(name)?.get(d) ?? null),
        showSymbol: true,
        symbol: "circle",
        symbolSize: isSel ? 4.5 : hasSelection ? 3.4 : 3,
        smooth: 0.12,
        connectNulls: true,
        lineStyle: {
          width: isSel ? 2.8 : hasSelection ? 1.8 : 1.7,
          color,
          opacity: isSel ? 1 : hasSelection ? 0.42 : 0.82,
        },
        itemStyle: { color, opacity: isSel ? 1 : hasSelection ? 0.46 : 1 },
        triggerLineEvent: true,
        endLabel: {
          show: isSel,
          formatter: name,
          color,
          fontSize: 11,
          fontWeight: 600,
          distance: 6,
        },
        emphasis: {
          focus: "series",
          lineStyle: { width: 2.8, opacity: 1 },
          itemStyle: { opacity: 1, borderColor: p.text, borderWidth: 1 },
          label: { show: true },
        },
        blur: {
          lineStyle: { opacity: 0.06 },
          itemStyle: { opacity: 0.06 },
          label: { show: false },
        },
        label: {
          show: false,
          position: "top",
          distance: 3,
          color,
          fontSize: 9.5,
          formatter: (q: any) => {
            const i = Number(q.dataIndex);
            return i % 4 === 0 || i === dates.length - 1 ? `#${q.value}` : "";
          },
        },
        z: isSel ? 5 : 2,
      };
    }),
  };
}

/** 轮动强度：月度平均排名变化，柱状呈现。 */
export function rotationPulse(p: Palette, rows: RotationDay[], lang: string): EChartsOption {
  const groups = new Map<string, { sum: number; n: number }>();
  rows.forEach((r) => {
    const m = r.trade_date.slice(0, 7);
    const g = groups.get(m) || { sum: 0, n: 0 };
    g.sum += r.rotation_intensity;
    g.n += 1;
    groups.set(m, g);
  });
  const all = [...groups.entries()].map(([month, g]) => ({ month, value: g.sum / Math.max(1, g.n), n: g.n })).sort((a, b) => a.month.localeCompare(b.month));
  const data = all.slice(-12);
  const avg = data.reduce((a, x) => a + x.value, 0) / Math.max(1, data.length);
  const max = Math.max(...data.map((x) => x.value), avg, 1);

  return {
    ...baseChart(p),
    grid: { left: 8, right: 12, top: 18, bottom: 24, containLabel: true },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number }[];
        const x = data[arr[0]?.dataIndex ?? 0];
        if (!x) return "";
        return `<div style="font-family:monospace;font-size:12px;color:${p.muted}">${x.month}</div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "月均轮动", "Monthly avg")}</span><b>${x.value.toFixed(2)}</b></div>
          <div style="display:flex;justify-content:space-between;gap:16px"><span>${L(lang, "交易日", "Sessions")}</span><b>${x.n}</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: data.map((x) => x.month.slice(2)),
      ...axisStyle(p),
      splitLine: { show: false },
      axisLabel: {
        ...axisStyle(p).axisLabel,
        fontSize: 11,
        hideOverlap: true,
        interval: (i: number) => i % 4 === 0 || i === data.length - 1,
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: +max.toFixed(1),
      ...axisStyle(p),
      axisLabel: { ...axisStyle(p).axisLabel, fontSize: 11 },
      splitNumber: 3,
    },
    series: [
      {
        type: "bar",
        data: data.map((x, i) => ({
          value: +x.value.toFixed(2),
          itemStyle: {
            color: i === data.length - 1 ? p.copper : p.accent,
            opacity: i === data.length - 1 ? 0.95 : 0.92,
            borderRadius: [2, 2, 0, 0],
          },
        })),
        barWidth: "52%",
        label: {
          show: false,
          position: "top",
          formatter: (q: any) => Number(q.value).toFixed(2),
          color: p.text2,
          fontSize: 11,
        },
        emphasis: {
          itemStyle: { opacity: 1, borderColor: p.text, borderWidth: 1 },
          label: { show: true },
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: +avg.toFixed(2) }],
          lineStyle: { color: p.axis, type: "dashed", width: 1 },
          label: { show: false },
        },
      },
    ],
  };
}

/** 行业月度累计收益曲线：一组行业，一条线一个行业。 */
export function monthlyPathChart(
  p: Palette,
  months: string[],
  series: { name: string; values: (number | null)[] }[],
  lang: string,
): EChartsOption {
  const colors = seriesColors(p);
  const paths = series.map((s) => {
    let v = 1;
    return s.values.map((r) => {
      if (r != null) v *= 1 + r;
      return +((v - 1) * 100).toFixed(2);
    });
  });
  return {
    ...baseChart(p),
    grid: { left: 8, right: 12, top: 44, bottom: 34, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      type: "scroll",
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      textStyle: { color: p.muted, fontSize: 10.5 },
      pageIconColor: p.accent,
      pageIconInactiveColor: p.faint,
      pageTextStyle: { color: p.faint, fontSize: 10 },
      data: series.map((s) => s.name),
    },
    tooltip: {
      ...baseChart(p).tooltip,
      trigger: "axis",
      formatter: (params: unknown) => {
        const arr = params as { dataIndex: number; seriesName: string; value: number; color: string }[];
        const i = arr?.[0]?.dataIndex ?? 0;
        return `<div style="min-width:150px"><div style="font-family:monospace;font-size:12px;color:${p.muted};margin-bottom:5px">${months[i]}</div>${arr
          .map(
            (x) =>
              `<div style="display:flex;justify-content:space-between;gap:16px"><span><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${x.color};margin-right:5px"></i>${x.seriesName}</span><b>${Number(x.value).toFixed(2)}%</b></div>`,
          )
          .join("")}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: months.map((m) => m.slice(2, 7)),
      ...axisStyle(p),
      name: L(lang, "月份", "Month"),
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: p.muted, fontSize: 10.5 },
      splitLine: { show: false },
      axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(months.length / 6)), fontSize: 11 },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...axisStyle(p),
      name: L(lang, "累计收益", "Cumulative"),
      nameLocation: "end",
      nameGap: 8,
      nameTextStyle: { color: p.muted, fontSize: 10.5 },
      axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 11 },
      splitNumber: 3,
    },
    series: series.map((s, i) => ({
      name: s.name,
      type: "line",
      data: paths[i],
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { width: 1.9, color: colors[i % colors.length] },
      itemStyle: { color: colors[i % colors.length] },
      emphasis: { focus: "series" },
      blur: { lineStyle: { opacity: 0.12 }, itemStyle: { opacity: 0.12 } },
      markLine:
        i === 0
          ? {
              silent: true,
              symbol: "none",
              data: [{ yAxis: 0 }],
              lineStyle: { color: p.axis, width: 1, type: "dashed" },
              label: { show: false },
            }
          : undefined,
    })),
  };
}
