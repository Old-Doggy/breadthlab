import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { Card, MicroLabel } from "../components/Card";
import { PageHead } from "../components/PageHead";

const METRICS: { k: string; zh: string; en: string; f: string }[] = [
  { k: "breadth", zh: "上涨占比", en: "Breadth", f: "N(涨) / (N(涨)+N(跌))，剔除平盘与无有效收益" },
  { k: "ew_ret", zh: "等权收益", en: "Equal-weight return", f: "mean(pct_chg/100)，有效且非上市前5交易日样本" },
  { k: "cw_ret", zh: "流通市值加权", en: "Float-cap weighted return", f: "Σ wᵢrᵢ，w用上一市场交易日circ_mv，在当日可用样本归一" },
  { k: "hhi", zh: "集中度 HHI", en: "HHI", f: "Σ wᵢ² × 10000，越大越集中" },
  { k: "top10_share", zh: "Top10 波动占比", en: "Top10 share", f: "Top10 全市场流通市值权重股 |wᵢrᵢ| / Σ|wᵢrᵢ|，w = 前一日流通市值权重" },
  { k: "csd", zh: "分化度", en: "Dispersion", f: "横截面收益标准差（pp）" },
  { k: "iqr", zh: "IQR", en: "IQR", f: "q75 − q25，抗极值" },
  { k: "limit_up", zh: "涨停", en: "Limit-up", f: "成熟有效样本 close ≥ stk_limit.up_limit × 0.999；缺限价未知" },
  { k: "new_high", zh: "新高", en: "New high", f: "adj_close ≥ 过去 252 日最高（需满 250 日历史）" },
  { k: "ma250", zh: "MA250 上方", en: "Above MA250", f: "adj_close > MA250 的股票占比" },
];

const METRIC_EN: Record<string, string> = {
  breadth: "Advancers / (advancers + decliners); flat and invalid returns excluded",
  ew_ret: "Arithmetic mean of pct_chg/100 for eligible established stocks",
  cw_ret: "Sum(w × return); weights use previous market session float cap, normalized over available eligible stocks",
  hhi: "Sum(w²) × 10,000; larger values indicate concentration",
  top10_share: "Top10 by prior-session weight: sum(abs(w × return)) / total absolute contributions",
  csd: "Sample cross-sectional standard deviation; display in pp",
  iqr: "q75 minus q25",
  limit_up: "Eligible close ≥ positive official limit price × 0.999; missing limits stay unknown",
  new_high: "Adjusted close ≥ 252-observation maximum, with at least 250 observations",
  ma250: "Share above MA250 among stocks with sufficient valid history",
};

const fmtGate = (g: { id: number; value: number | null }) => {
  if (g.value === null || g.value === undefined) return "—";
  if ([4, 5, 6, 7, 11].includes(g.id)) return `${(g.value * 100).toFixed(2)}%`;
  if (g.id === 9) return `${(g.value * 100).toFixed(2)}pp`;
  if (g.id === 1) return g.value.toLocaleString("en-US");
  return `${g.value}`;
};

const GATE_ZH: Record<number, string> = {
  1: "股票数及环比",
  2: "主键唯一",
  3: "价格合法性",
  4: "收益一致性",
  5: "字段覆盖率",
  6: "广度合理性",
  7: "行业覆盖",
  8: "复权因子",
  9: "与昨日连续性",
  10: "成交量额有效",
  11: "涨跌停价覆盖",
  12: "四指数完整",
  13: "指数收益一致",
  14: "上市日期完整",
};

export default function About() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const { data: quality } = useQuery({ queryKey: ["quality"], queryFn: api.quality });
  const { data: updates } = useQuery({ queryKey: ["updates"], queryFn: api.updates });
  const { data: reconcile } = useQuery({ queryKey: ["reconcile"], queryFn: api.reconcile });

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        kicker={`${zh ? "方法与数据" : "Method"} / v0.2.4`}
        title={zh ? "数据口径与血缘" : "Data lineage and definitions"}
        dek={zh ? "数据血缘、指标口径、质量门禁、更新日志与源间对账" : "Lineage, metric definitions, quality gates, update log and source reconciliation"}
        chips={<><span className="pill">{meta?.last_trade_date ?? "—"}</span><span className="pill">{zh ? "门禁" : "Gates"} {quality ? `${quality.gates.filter((g) => g.pass).length}/${quality.gates.length}` : "—"}</span><span className="pill">{meta?.source ?? (zh ? "未知" : "unknown")}</span></>}
      />

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <Card title={lang === "en" ? "Data lineage" : "数据血缘"}>
            <div className="flex flex-col gap-2">
              {[
                { n: lang === "en" ? "Tushare Pro / snapshot" : "Tushare Pro / 本地快照", d: lang === "en" ? "daily, daily_basic, adj_factor, stk_limit, limit_list_d, moneyflow" : "daily、daily_basic、adj_factor、stk_limit、limit_list_d、moneyflow" },
                { n: "raw parquet", d: lang === "en" ? "Immutable landing zone, deduped by (ts_code, trade_date)" : "原始落地层，按 (ts_code, trade_date) 去重" },
                { n: "DuckDB · core", d: lang === "en" ? "stock_day, index_day, limit_event, flow_day, margin_day" : "stock_day、index_day、limit_event、flow_day、margin_day" },
                { n: "DuckDB · mart", d: lang === "en" ? "market_day, sector_day, monthly aggregates" : "market_day、sector_day、月度聚合" },
                { n: lang === "en" ? "App" : "应用层", d: lang === "en" ? "Flask API / single-file static export" : "Flask API / 单文件静态导出" },
              ].map((s, i) => (
                <div key={s.n} className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <span className="mono mt-[1px] text-[11px] text-[var(--faint)]">0{i + 1}</span>
                  <div>
                    <div className="text-[13px] text-[var(--text)]">{s.n}</div>
                    <div className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--muted)]">{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <Card title={lang === "en" ? "Snapshot status" : "数据状态"}>
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: lang === "en" ? "Source" : "数据源", v: meta?.source || "—" },
                { k: lang === "en" ? "First date" : "起始日", v: meta?.first_trade_date || "—" },
                { k: lang === "en" ? "Last date" : "截止日", v: meta?.last_trade_date || "—" },
                { k: lang === "en" ? "Sessions" : "交易日", v: meta?.n_days ?? "—" },
                { k: lang === "en" ? "Stocks" : "最新股票数", v: meta?.n_stocks ?? "—" },
                { k: lang === "en" ? "Universe" : "股票池", v: "SSE+SZSE" },
              ].map((s) => (
                <div key={s.k} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <MicroLabel>{s.k}</MicroLabel>
                  <div className="mono mt-1 text-[13px] text-[var(--text)]">{s.v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/5 px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--muted)]">
              {lang === "en"
                ? "Industry labels use current static mappings, not historical membership. Stocks without a known listing date are excluded. A 5% price limit is not proof of historical ST status. Optional event data may be unavailable; missing values stay unknown."
                : "行业使用当前静态映射，并非历史时点成员；缺上市日期的股票不进入指标样本。5%价格限制不等于历史ST身份。可选事件数据可能因权限缺失，缺失值保持未知。"}
            </div>
          </Card>
        </div>
      </div>

      <Card
        title={lang === "en" ? "Quality gates" : "质量门禁"}
        subtitle={
          quality
            ? `${quality.date} · ${quality.rows} rows · ${
                quality.passed
                  ? lang === "en"
                    ? "all blocking checks passed"
                    : "阻断级检查全部通过"
                  : lang === "en"
                    ? "blocking failures"
                    : "存在阻断项"
              }`
            : lang === "en"
              ? "no report yet"
              : "暂无报告"
        }
        right={
          <span className="pill h-[24px] px-2 text-[11px]">
            {quality ? `${quality.gates.filter((g) => g.pass).length}/${quality.gates.length}` : "—"}
          </span>
        }
        padded={false}
        bodyClass="pt-0"
      >
        <div className="grid grid-cols-1 gap-1.5 px-4 pb-3 sm:grid-cols-3">
          {(quality?.gates ?? []).map((g) => (
            <div key={g.id} className="flex items-center gap-2 rounded-md bg-[var(--panel-2)] px-2.5 py-[6px]">
              <span className="mono w-3 text-[11px] text-[var(--faint)]">{g.id}</span>
              <span
                className="h-[6px] w-[6px] shrink-0 rounded-full"
                style={{ background: g.pass ? "var(--down)" : g.level === "block" ? "var(--up)" : "var(--warn)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-2)]">
                {lang === "en" ? g.name : GATE_ZH[g.id] ?? g.name}
              </span>
              <span className="mono text-[11px] text-[var(--muted)]">{fmtGate(g)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <Card
            title={lang === "en" ? "Update log" : "更新日志"}
            subtitle={lang === "en" ? "Last 30 runs" : "最近 30 次运行"}
            right={<span className="pill h-[24px] px-2 text-[11px]">{updates?.length ?? 0}</span>}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="max-h-[260px] overflow-y-auto px-4 pb-3">
              <table className="w-full border-collapse text-[11.5px]">
                <thead className="sticky top-0 bg-[var(--panel)]">
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-[var(--faint)]">
                    <th className="py-1.5 font-medium">{lang === "en" ? "Date" : "日期"}</th>
                    <th className="font-medium">{lang === "en" ? "Status" : "状态"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Days" : "天数"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Sec" : "耗时"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Warn" : "告警"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(updates ?? []).map((u) => (
                    <tr key={u.date} className="border-t border-[var(--border)]">
                      <td className="mono py-[5px] text-[var(--text-2)]">{u.date}</td>
                      <td>
                        <span
                          className="inline-block h-[5px] w-[5px] rounded-full"
                          style={{ background: u.status === "ok" ? "var(--down)" : "var(--warn)" }}
                        />
                        <span className="ml-1.5 text-[var(--muted)]">{u.status}</span>
                      </td>
                      <td className="mono text-right text-[var(--text-2)]">{u.days}</td>
                      <td className="mono text-right text-[var(--text-2)]">{u.duration ?? "—"}</td>
                      <td className="mono text-right text-[var(--muted)]">{u.warnings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-5">
          <Card
            title={lang === "en" ? "Source reconciliation" : "源间对账"}
            subtitle={lang === "en" ? "Tushare vs akshare, sampled" : "Tushare vs akshare · 抽样"}
            right={<span className="pill h-[24px] px-2 text-[11px]">QA</span>}
          >
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { k: lang === "en" ? "Pairs" : "样本对", v: `${reconcile?.pairs ?? "—"}` },
                { k: "MAE (pp)", v: `${reconcile?.mae_pp ?? "—"}` },
                { k: "P95 (pp)", v: `${reconcile?.p95_pp ?? "—"}` },
                { k: "Max (pp)", v: `${reconcile?.max_pp ?? "—"}` },
              ].map((x) => (
                <div key={x.k} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                  <MicroLabel>{x.k}</MicroLabel>
                  <div className="mono mt-1 text-[14px] text-[var(--text)]">{x.v}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              {lang === "en"
                ? "Sampled cross-check only; Tushare remains the primary source. Differences above 0.1pp are flagged."
                : "仅抽样交叉校验，主源仍是 Tushare；差异 >0.1pp 会被标记。"}
            </p>
          </Card>
        </div>
      </div>

      <Card
        title={lang === "en" ? "Metric definitions" : "指标口径"}
        subtitle={lang === "en" ? "Core metrics from marts; display aggregation follows the metric contract" : "核心指标来自分析表；展示聚合遵循指标契约"}
        padded={false}
        bodyClass="pt-0"
      >
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full min-w-[560px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--faint)]">
                <th className="py-2 font-medium">{lang === "en" ? "Metric" : "指标"}</th>
                <th className="font-medium">{lang === "en" ? "Field" : "字段"}</th>
                <th className="font-medium">{lang === "en" ? "Definition" : "定义"}</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.k} className="border-t border-[var(--border)]">
                  <td className="py-[7px] text-[12.5px] text-[var(--text)]">{lang === "en" ? m.en : m.zh}</td>
                  <td className="mono text-[11px] text-[var(--faint)]">{m.k}</td>
                  <td className="text-[12px] text-[var(--muted)]">{zh ? m.f : METRIC_EN[m.k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between pb-2 text-[11.5px] text-[var(--faint)]">
        <span>BreadthLab v0.2.4 · DuckDB + Flask + React + ECharts</span>
        <span className="mono">data → lake → marts → app</span>
      </div>
    </div>
  );
}
