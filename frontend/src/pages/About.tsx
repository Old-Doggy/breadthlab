import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { Card, MicroLabel } from "../components/Card";

const METRICS: { k: string; zh: string; en: string; f: string }[] = [
  { k: "breadth", zh: "上涨占比", en: "Breadth", f: "N(涨) / (N(涨)+N(跌))，剔除平盘与无有效收益" },
  { k: "ew_ret", zh: "等权收益", en: "Equal-weight return", f: "mean(pct_chg/100)，全市场有效样本" },
  { k: "cw_ret", zh: "市值加权", en: "Cap-weight return", f: "Σ wᵢrᵢ，w 用前一日 circ_mv 归一" },
  { k: "hhi", zh: "集中度 HHI", en: "HHI", f: "Σ wᵢ² × 10000，越大越集中" },
  { k: "top10_share", zh: "Top10 波动占比", en: "Top10 share", f: "Top10 权重股 |wᵢrᵢ| / Σ|wᵢrᵢ|" },
  { k: "csd", zh: "分化度", en: "Dispersion", f: "横截面收益标准差（pp）" },
  { k: "iqr", zh: "IQR", en: "IQR", f: "q75 − q25，抗极值" },
  { k: "limit_up", zh: "涨停", en: "Limit-up", f: "limit_list_d 的 U 记录；价格判定用 stk_limit" },
  { k: "new_high", zh: "新高", en: "New high", f: "adj_close ≥ 过去 252 日最高（需满 250 日历史）" },
  { k: "ma250", zh: "MA250 上方", en: "Above MA250", f: "adj_close > MA250 的股票占比" },
];

const fmtGate = (g: { id: number; value: number | null }) => {
  if (g.value === null || g.value === undefined) return "—";
  if (g.id === 5 || g.id === 6 || g.id === 7) return `${(g.value * 100).toFixed(2)}%`;
  if (g.id === 9) return `${(g.value * 100).toFixed(2)}pp`;
  if (g.id === 1) return `${g.value.toFixed(2)}×`;
  return `${g.value}`;
};

const GATE_ZH: Record<number, string> = {
  1: "股票数环比",
  2: "主键唯一",
  3: "价格合法性",
  4: "收益一致性",
  5: "字段覆盖率",
  6: "广度合理性",
  7: "行业覆盖",
  8: "复权因子",
  9: "与昨日连续性",
};

export default function About() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const { data: quality } = useQuery({ queryKey: ["quality"], queryFn: api.quality });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{t("about.title")}</h1>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t("about.subtitle")}</p>
      </div>

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
                  <span className="mono mt-[1px] text-[10px] text-[var(--faint)]">0{i + 1}</span>
                  <div>
                    <div className="text-[12px] text-[var(--text)]">{s.n}</div>
                    <div className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">{s.d}</div>
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
                  <div className="mono mt-1 text-[12.5px] text-[var(--text)]">{s.v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/5 px-3 py-2.5 text-[10.5px] leading-relaxed text-[var(--muted)]">
              {lang === "en"
                ? "Descriptive analytics only. No forecasts, no buy/sell advice. Industry labels are mapped from Tushare classification to 31 SW level-1 sectors; a few stocks remain unmapped."
                : "本看板仅做描述性分析，不构成预测或投资建议。行业标签由 Tushare 分类映射到 31 个申万一级行业，少数股票未映射。"}
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
          <span className="pill h-[22px] px-2 text-[10px]">
            {quality ? `${quality.gates.filter((g) => g.pass).length}/9` : "—"}
          </span>
        }
        padded={false}
        bodyClass="pt-0"
      >
        <div className="grid grid-cols-1 gap-1.5 px-4 pb-3 sm:grid-cols-3">
          {(quality?.gates ?? []).map((g) => (
            <div key={g.id} className="flex items-center gap-2 rounded-md bg-[var(--panel-2)] px-2.5 py-[6px]">
              <span className="mono w-3 text-[9.5px] text-[var(--faint)]">{g.id}</span>
              <span
                className="h-[6px] w-[6px] shrink-0 rounded-full"
                style={{ background: g.pass ? "var(--down)" : g.level === "block" ? "var(--up)" : "var(--warn)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]">
                {lang === "en" ? g.name : GATE_ZH[g.id] ?? g.name}
              </span>
              <span className="mono text-[10px] text-[var(--muted)]">{fmtGate(g)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title={lang === "en" ? "Metric definitions" : "指标口径"}
        subtitle={lang === "en" ? "Same definition everywhere in the app" : "全站唯一口径，图表与接口不得重算"}
        padded={false}
        bodyClass="pt-0"
      >
        <div className="px-4 pb-3">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-[9.5px] uppercase tracking-wider text-[var(--faint)]">
                <th className="py-2 font-medium">{lang === "en" ? "Metric" : "指标"}</th>
                <th className="font-medium">{lang === "en" ? "Field" : "字段"}</th>
                <th className="font-medium">{lang === "en" ? "Definition" : "定义"}</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.k} className="border-t border-[var(--border)]">
                  <td className="py-[7px] text-[11.5px] text-[var(--text)]">{lang === "en" ? m.en : m.zh}</td>
                  <td className="mono text-[10px] text-[var(--faint)]">{m.k}</td>
                  <td className="text-[11px] text-[var(--muted)]">{m.f}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between pb-2 text-[10.5px] text-[var(--faint)]">
        <span>BreadthLab v0.1 · DuckDB + Flask + React + ECharts</span>
        <span className="mono">data → lake → marts → app</span>
      </div>
    </div>
  );
}
