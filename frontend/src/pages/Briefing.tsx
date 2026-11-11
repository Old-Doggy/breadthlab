import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { palettes } from "../lib/theme";
import { money, num, pct, ratio, weekday } from "../lib/format";
import { regimeLabel, regimeOf, verdict } from "../lib/regime";
import { distributionChart, returnBreadth } from "../lib/charts";
import EChart from "../components/EChart";

/** A4 每日体检简报：?print=1#/briefing 由无头浏览器打印为 PDF。 */
export default function Briefing() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const p = palettes.light;

  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const d = meta?.last_trade_date;
  const { data: series } = useQuery({
    queryKey: ["market-all"],
    queryFn: () => api.marketSeries(),
  });
  const { data: detail } = useQuery({
    queryKey: ["market-day", d],
    queryFn: () => api.marketDay(d as string),
    enabled: !!d,
  });
  const { data: dist } = useQuery({
    queryKey: ["distribution", d],
    queryFn: () => api.distribution(d as string),
    enabled: !!d,
  });

  const rows = series ?? [];
  const last = rows[rows.length - 1];
  if (!last) return <div className="skeleton h-[900px] w-full" />;

  const recent = rows.slice(-60);
  const sectors = detail?.sectors ?? [];
  const byBreadth = [...sectors].sort((a, b) => b.breadth - a.breadth);
  const top = byBreadth.slice(0, 3);
  const bottom = byBreadth.slice(-3).reverse();
  const contrib = (detail?.contributors ?? []).slice(0, 3);
  const regime = regimeOf(last);
  const zhaban = last.broken_n != null ? last.broken_n / Math.max(1, (last.limit_up_n || 0) + last.broken_n) : null;
  const prev20 = rows.slice(-21, -1);
  const breadthDelta = (last.breadth - prev20.reduce((a, r) => a + r.breadth, 0) / Math.max(1, prev20.length)) * 100;
  const yearB = rows.slice(-250).filter((r) => r.breadth <= last.breadth).length;
  const breadthPctile = Math.round((yearB / Math.max(1, rows.slice(-250).length)) * 100);

  return (
    <div className="briefing mx-auto max-w-[1040px] rounded-xl border border-[var(--border)] bg-white p-4 text-[#101828] shadow-sm sm:p-8">
      <div className="flex items-start justify-between border-b border-[#e4e7ec] pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#667085]">BreadthLab</div>
          <h1 className="serif mt-1 text-[27px] font-bold tracking-tight">A股市场体检简报</h1>
          <div className="mt-1 text-[12px] text-[#667085]">
            {last.trade_date} · {weekday(last.trade_date)} · 数据源 Tushare Pro
          </div>
        </div>
        <div className="text-right">
          <div className="rounded-full bg-[#f2f4f7] px-3 py-1 text-[12px] font-medium text-[#344054]">
            {regimeLabel(regime, "zh")}
          </div>
          <div className="mt-2 text-[11px] text-[#98a2b3]">{meta?.n_stocks} 只股票 · {meta?.n_days} 个交易日</div>
        </div>
      </div>

      <p className="mt-5 max-w-[62ch] text-[16px] font-semibold leading-[1.6] tracking-tight">
        {verdict(last, "zh").replace(/。$/, "")}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        {[
          { k: "等权收益", v: pct(last.ew_ret), tone: last.ew_ret >= 0 ? "#d92d20" : "#067647" },
          { k: "上涨占比", v: ratio(last.breadth, 0), tone: "#101828" },
          { k: "涨停 / 跌停", v: `${last.limit_up_n} / ${last.limit_down_n}`, tone: "#101828" },
          { k: "成交额", v: money(last.amount), tone: "#101828" },
          { k: "分化度", v: `${(last.csd * 100).toFixed(2)}pp`, tone: "#101828" },
          { k: "Top10 波动占比", v: ratio(last.top10_share, 0), tone: "#101828" },
        ].map((s) => (
          <div key={s.k} className="rounded-lg border border-[#e4e7ec] bg-[#fafbfc] px-2.5 py-2">
            <div className="text-[10.5px] uppercase tracking-wider text-[#98a2b3]">{s.k}</div>
            <div className="mono mt-1 text-[15px] font-semibold" style={{ color: s.tone }}>
              {s.v}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[#e4e7ec] p-3">
          <div className="text-[12px] font-semibold text-[#344054]">近 60 日：收益 × 广度</div>
          <div className="mt-1 text-[11px] text-[#98a2b3]">柱：等权收益 · 线：沪深300 · 下：上涨占比</div>
          <div className="mt-2 h-[260px]">
            <EChart option={{ ...returnBreadth(p, recent, "zh"), animation: false }} />
          </div>
        </div>
        <div className="rounded-lg border border-[#e4e7ec] p-3">
          <div className="text-[12px] font-semibold text-[#344054]">当日个股收益分布</div>
          <div className="mt-1 text-[11px] text-[#98a2b3]">截尾 ±11%，虚线为中位数</div>
          <div className="mt-2 h-[260px]">
            {dist?.bins?.length ? <EChart option={{ ...distributionChart(p, dist.bins, dist.stats, "zh"), animation: false }} /> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[#e4e7ec] p-3">
          <div className="text-[12px] font-semibold text-[#344054]">最广泛参与</div>
          <div className="mt-2 space-y-1.5">
            {top.map((s) => (
              <div key={s.sw_l1} className="flex items-center justify-between text-[11.5px]">
                <span className="text-[#344054]">{s.sw_l1}</span>
                <span className="mono text-[#667085]">
                  {ratio(s.breadth, 0)} · <span style={{ color: s.ew_ret >= 0 ? "#d92d20" : "#067647" }}>{pct(s.ew_ret)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-[#e4e7ec] p-3">
          <div className="text-[12px] font-semibold text-[#344054]">最弱参与</div>
          <div className="mt-2 space-y-1.5">
            {bottom.map((s) => (
              <div key={s.sw_l1} className="flex items-center justify-between text-[11.5px]">
                <span className="text-[#344054]">{s.sw_l1}</span>
                <span className="mono text-[#667085]">
                  {ratio(s.breadth, 0)} · <span style={{ color: s.ew_ret >= 0 ? "#d92d20" : "#067647" }}>{pct(s.ew_ret)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-[#e4e7ec] p-3">
          <div className="text-[12px] font-semibold text-[#344054]">最大贡献个股</div>
          <div className="mt-2 space-y-1.5">
            {contrib.map((c) => (
              <div key={c.ts_code} className="flex items-center justify-between text-[11.5px]">
                <span className="truncate text-[#344054]">{c.name}</span>
                <span className="mono" style={{ color: c.ret >= 0 ? "#d92d20" : "#067647" }}>
                  {pct(c.ret)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[#e4e7ec] bg-[#fafbfc] p-3">
        <div className="text-[12px] font-semibold text-[#344054]">今日三条</div>
        <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-[#475467]">
          <li>
            ① 广度 {ratio(last.breadth, 0)}，较 20 日均值 {(breadthDelta >= 0 ? "+" : "") + breadthDelta.toFixed(1)}pp，处于近一年 {breadthPctile} 分位。
          </li>
          <li>
            ② 最强参与：{top[0]?.sw_l1} {ratio(top[0]?.breadth ?? null, 0)}；最弱参与：{bottom[0]?.sw_l1}{" "}
            {ratio(bottom[0]?.breadth ?? null, 0)}（收益 {pct(bottom[0]?.ew_ret ?? null)}）。
          </li>
          <li>
            ③ 涨停 {last.limit_up_n} / 跌停 {last.limit_down_n}，炸板率 {zhaban === null ? "—" : ratio(zhaban, 0)}，连板 {last.streak_n ?? 0} 家，最高 {last.max_streak ?? "—"} 板。
          </li>
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#e4e7ec] pt-3 font-mono text-[10.5px] text-[#98a2b3]">
        <span className="rounded border border-[#e4e7ec] px-1.5 py-0.5 text-[#475467]">raw</span>
        <span>→</span>
        <span className="rounded border border-[#e4e7ec] px-1.5 py-0.5 text-[#475467]">core.market_day</span>
        <span>→</span>
        <span className="rounded border border-[#e4e7ec] px-1.5 py-0.5 text-[#475467]">mart.market_day</span>
        <span>→</span>
        <span className="rounded border border-[#e4e7ec] px-1.5 py-0.5 text-[#475467]">page</span>
        <span className="ml-auto">N {meta?.n_stocks ?? "—"} · 等权 · 截尾 1%/99%</span>
      </div>

      <div className="mt-2 flex flex-col gap-1 text-[10.5px] leading-relaxed text-[#98a2b3] sm:flex-row sm:items-center sm:justify-between">
        <span>
          炸板率 {zhaban === null ? "—" : ratio(zhaban, 0)} · 连板 {last.streak_n ?? 0} 家 · 最高 {last.max_streak ?? "—"} 板 · 新高 {last.new_high_n} / 新低 {last.new_low_n}
        </span>
        <span className="sm:text-right">BreadthLab v2.4 · 数据截至 {last.trade_date}</span>
      </div>
    </div>
  );
}
