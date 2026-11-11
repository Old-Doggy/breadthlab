import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { axisStyle, baseChart, paletteFor } from "../lib/theme";
import { money, num, pct, ratio, shortDate } from "../lib/format";
import EChart from "../components/EChart";
import { Card } from "../components/Card";
import { PageHead } from "../components/PageHead";
import { Kpi } from "../components/Kpi";
import { limitQualityChart } from "../lib/charts4";

export default function Sentiment() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);

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
        { left: 8, right: 10, top: 26, height: "46%", containLabel: true },
        { left: 8, right: 10, top: "76%", bottom: 18, containLabel: true },
      ],
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      graphic: [
        { type: "text", left: 8, top: 2, style: { text: zh ? "涨停 / 跌停（家数）" : "Limit-ups / downs (count)", fill: p.muted, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" } },
        { type: "text", left: 8, top: "64%", style: { text: zh ? "上涨占比" : "Breadth", fill: p.muted, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" } },
        { type: "line", left: 8, right: 10, top: "62%", style: { stroke: p.border, lineWidth: 1 } },
      ],
      tooltip: { ...baseChart(p).tooltip, trigger: "axis" },
      xAxis: [
        { type: "category", data: x, gridIndex: 0, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(x.length / 6)), fontSize: 10.5 }, splitLine: { show: false } },
        { type: "category", data: x, gridIndex: 1, ...axisStyle(p), name: zh ? "交易日期" : "Date", nameLocation: "middle", nameGap: 20, nameTextStyle: { color: p.muted, fontSize: 10.5 }, splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(x.length / 6)), fontSize: 10.5 } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, ...axisStyle(p), splitNumber: 3 },
        { type: "value", gridIndex: 1, min: 0, max: 100, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%" }, splitNumber: 1 },
      ],
      series: [
        {
          name: zh ? "涨停" : "Limit-up",
          type: "bar",
          data: rows.map((r) => r.limit_up_n),
          itemStyle: { color: p.up, opacity: 0.8, borderRadius: [2, 2, 0, 0] },
          barWidth: "52%",
        },
        {
          name: zh ? "跌停" : "Limit-down",
          type: "bar",
          data: rows.map((r) => -r.limit_down_n),
          itemStyle: { color: p.down, opacity: 0.8, borderRadius: [0, 0, 2, 2] },
          barWidth: "52%",
        },
        {
          name: zh ? "上涨占比" : "Breadth",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: rows.map((r) => +(r.breadth * 100).toFixed(1)),
          showSymbol: false,
          smooth: 0.25,
          lineStyle: { color: p.accent, width: 1.4 },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: `${p.accent}30` }, { offset: 1, color: `${p.accent}00` }],
            },
          },
        },
      ],
    } as never;
  }, [rows, p, lang, x]);

  const streakOption = useMemo(() => {
    if (!rows.length) return {} as never;
    return {
      ...baseChart(p),
      grid: [
        { left: 8, right: 10, top: 16, height: "54%", containLabel: true },
        { left: 8, right: 10, top: "72%", bottom: 20, containLabel: true },
      ],
      tooltip: { ...baseChart(p).tooltip, trigger: "axis" },
      xAxis: [
        { type: "category", data: x, gridIndex: 0, ...axisStyle(p), axisLabel: { show: false }, splitLine: { show: false } },
        { type: "category", data: x, gridIndex: 1, ...axisStyle(p), splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(x.length / 5)) } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, ...axisStyle(p), splitNumber: 3 },
        { type: "value", gridIndex: 1, min: 0, max: 10, ...axisStyle(p), splitNumber: 2 },
      ],
      series: [
        {
          name: zh ? "连板家数" : "2+ boards",
          type: "bar",
          data: rows.map((r) => r.streak_n ?? 0),
          itemStyle: { color: p.accent, opacity: 0.85, borderRadius: [2, 2, 0, 0] },
          barWidth: "56%",
        },
        {
          name: zh ? "最高连板" : "Max streak",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: rows.map((r) => r.max_streak ?? null),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.copper, width: 1.5 },
        },
      ],
    } as never;
  }, [rows, p, lang, x]);

  const highLowOption = useMemo(() => {
    if (!rows.length) return {} as never;
    const vals = rows.map((r) => Math.max(r.new_high_n || 0, r.new_low_n || 0)).sort((a, b) => a - b);
    const p95 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] || 100;
    const cap = Math.max(100, Math.min(600, Math.ceil((p95 * 1.2) / 50) * 50));
    const clip = (v: number) => Math.min(v, cap);
    return {
      ...baseChart(p),
      grid: { left: 8, right: 10, top: 16, bottom: 22, containLabel: true },
      tooltip: { ...baseChart(p).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: x, ...axisStyle(p), splitLine: { show: false }, axisLabel: { ...axisStyle(p).axisLabel, interval: Math.max(0, Math.floor(x.length / 5)) } },
      yAxis: {
        type: "value",
        min: -cap,
        max: cap,
        ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: (v: number) => `${Math.abs(v)}` },
        splitNumber: 3,
      },
      series: [
        {
          name: zh ? "新高" : "New highs",
          type: "line",
          data: rows.map((r) => clip(r.new_high_n || 0)),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.up, width: 1.3 },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: `${p.up}30` }, { offset: 1, color: `${p.up}00` }],
            },
          },
        },
        {
          name: zh ? "新低" : "New lows",
          type: "line",
          data: rows.map((r) => -clip(r.new_low_n || 0)),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: p.down, width: 1.3 },
          areaStyle: {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: `${p.down}00` }, { offset: 1, color: `${p.down}30` }],
            },
          },
        },
      ],
    } as never;
  }, [rows, p, lang, x]);

  if (!rows.length) return <div className="skeleton h-[600px] w-full" />;

  const margin = [...all].reverse().find((r) => r.rzye != null);
  const zhaban = last.broken_rate ?? null;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead
        kicker={`${zh ? "极端交易" : "Extremes"} / ${last.trade_date} · 120D`}
        title={zh ? "涨停、连板与新高新低" : "Limit-ups, streaks and new highs"}
        dek={
          zh
            ? `涨停 ${num(last.limit_up_n)} 家、跌停 ${num(last.limit_down_n)} 家；页面同时列出连板梯队、封板质量、新高新低与两融数据`
            : `${num(last.limit_up_n)} limit-ups and ${num(last.limit_down_n)} limit-downs; streak ladder, seal quality, new highs/lows and margin data are shown below`
        }
        chips={
          <>
            <span className="pill">{zh ? "近 120 个交易日" : "Last 120 sessions"}</span>
            <span className="pill">{zh ? "涨停判定：收盘价 ≥ 涨停价 × 0.999" : "Limit-up: close ≥ limit × 0.999"}</span>
            <span className="pill">{zh ? "MA250 上方 " + ratio(last.ma250_breadth, 0) : "Above MA250 " + ratio(last.ma250_breadth, 0)}</span>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={zh ? "涨停家数" : "Limit-ups"} value={num(last.limit_up_n)} sub={zh ? "收盘价 ≥ 涨停价" : "close ≥ limit"} hint={zh ? "用 stk_limit 的涨停价判定，不猜 10%/20%" : "Judged with stk_limit, not a fixed 10%/20%"} />
        <Kpi label={zh ? "跌停家数" : "Limit-downs"} value={num(last.limit_down_n)} sub={zh ? "收盘价 ≤ 跌停价" : "close ≤ limit"} />
        <Kpi label={zh ? "最高连板" : "Max streak"} value={`${last.max_streak ?? "—"}`} sub={`${num(last.streak_n ?? 0)} ${zh ? "家连板" : "with 2+ boards"}`} />
        <Kpi label={zh ? "炸板率" : "Broken rate"} value={zhaban === null ? "—" : ratio(zhaban, 1)} sub={`${num(last.broken_n ?? 0)} ${zh ? "家炸板" : "broken"}`} hint={zh ? "炸板 /（官方涨停 + 炸板），官方口径不含 ST" : "broken / (official limit-ups + broken), official universe excludes ST"} />
      </div>

      <div className="mt-1 flex items-center justify-between">
        <span className="kicker">{zh ? "资金与两融" : "Margin and flows"}</span>
        <span className="micro text-[var(--faint)]">{zh ? "截至" : "as of"} {margin?.trade_date ?? "—"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { k: zh ? "两融余额" : "Margin balance", v: money(margin?.rzye ?? null), sub: margin?.trade_date },
          { k: zh ? "融资买入额" : "Margin buy", v: money(margin?.rzmre ?? null), sub: margin?.trade_date },
          { k: zh ? "资金流广度" : "Flow breadth", v: ratio(last.flow_breadth, 0) },
          { k: zh ? "主力净流入" : "Main net flow", v: money(last.main_net_amount), tone: (last.main_net_amount || 0) >= 0 ? "up" : "down" },
        ].map((s) => (
          <div key={s.k} className="card px-4 py-3.5">
            <div className="text-[12px] leading-none text-[var(--muted)]">{s.k}</div>
            <div className={`mono mt-2 text-[22px] leading-none tracking-[-0.03em] ${s.tone === "up" ? "up" : s.tone === "down" ? "down" : "text-[var(--text)]"}`}>{s.v}</div>
            {s.sub ? <div className="mono mt-1.5 text-[11.5px] text-[var(--faint)]">{zh ? "截至" : "as of"} {s.sub}</div> : null}
          </div>
        ))}
      </div>

      <Card
        index="01"
        title={zh ? "涨停与跌停" : "Limit-ups and limit-downs"}
        subtitle={zh ? "上：涨停 / 跌停家数 · 下：上涨占比" : "Top: limit-ups/downs · Bottom: breadth"}
        right={<span className="pill">{last.trade_date}</span>}
        prov={zh ? "涨停/跌停按 stk_limit 判定；下图为全市场上涨占比" : "Limit events from stk_limit; lower panel is breadth"}
        padded={false}
        bodyClass="pt-0"
        footer={
          <div className="provline">
            <span>SOURCE <b>limit_list_d / stk_limit</b></span>
            <span>N <b>{num(last.n_valid)}</b></span>
            <a className="r hover:underline" href="#/about">{zh ? "口径说明 →" : "Method →"}</a>
          </div>
        }
      >
        <div className="h-[340px] px-1 pb-1 md:h-[380px] md:px-2">
          <EChart option={limitOption} ariaLabel={zh ? "涨停跌停与广度" : "Limit-ups and breadth"} />
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-6">
          <Card
            index="02"
            title={zh ? "连板梯队" : "Streak ladder"}
            subtitle={zh ? "柱：连板家数 · 下：最高连板高度" : "Bars: 2+ boards · lower: tallest streak"}
            prov={zh ? "连板家数 = 连续涨停 ≥ 2 天的股票数；高度 = 当日最高连板" : "Stocks with 2+ consecutive limit-ups; lower panel is max streak"}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[280px] px-1 pb-1 md:px-2">
              <EChart option={streakOption} ariaLabel={zh ? "连板梯队" : "Streak ladder"} />
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-6">
          <Card
            index="03"
            title={zh ? "新高与新低" : "New highs vs lows"}
            subtitle={zh ? "252 日新高 / 新低 · 上下分开 · 极端值截尾" : "252-day highs / lows, split above/below zero · tail clipped"}
            right={
              <div className="flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
                <span className="inline-block h-[2px] w-3" style={{ background: p.up }} />
                {zh ? "新高" : "high"}
                <span className="inline-block h-[2px] w-3" style={{ background: p.down }} />
                {zh ? "新低" : "low"}
              </div>
            }
            prov={zh ? "新高/新低为 252 日收盘价极值；MA250 上方占比在标题旁" : "252-day closing extremes; MA250 breadth in header"}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[280px] px-1 pb-1 md:px-2">
              <EChart option={highLowOption} ariaLabel={zh ? "新高新低" : "New highs and lows"} />
            </div>
          </Card>
        </div>
      </div>

      <Card
        index="04"
        title={zh ? "封板质量" : "Seal quality"}
        subtitle={zh ? "封单额 / 流通市值中位数 · 数据截至 2026-05-22" : "Median seal / float cap · data ends 2026-05-22"}
        right={<span className="pill">limit_list_d</span>}
        prov={zh ? "封单额 / 流通市值；开板比例见 tooltip；历史数据受权限限制" : "Seal amount / float cap; open share in tooltip"}
        padded={false}
        bodyClass="pt-0"
        footer={
          <div className="provline">
            <span>SOURCE <b>limit_list_d</b></span>
            <span>{zh ? "截至 2026-05-22" : "to 2026-05-22"}</span>
            <span className="r">{zh ? "历史权限" : "permission"}</span>
          </div>
        }
      >
        <div className="h-[240px] px-1 pb-1 md:px-2">
          {limitQ?.length ? <EChart option={limitQualityChart(p, limitQ, lang)} /> : <div className="skeleton h-full w-full" />}
        </div>
      </Card>


      <div className="flex items-center justify-between pb-1 text-[10.5px] text-[var(--faint)]">
        <span className="font-mono">{zh ? "数据源：limit_list_d / stk_limit / moneyflow / margin" : "Source: limit_list_d / stk_limit / moneyflow / margin"}</span>
        <span className="mono">{num(last.limit_up_n)} ↑ {num(last.limit_down_n)} ↓ · {pct(last.ew_ret)}</span>
      </div>
    </div>
  );
}
