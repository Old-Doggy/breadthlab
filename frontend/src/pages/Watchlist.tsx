import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowUpRight, Download, Trash2, Upload } from "lucide-react";
import { api, type StockRow } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, pct, ratio, trendClass } from "../lib/format";
import { Card } from "../components/Card";
import { PageHead } from "../components/PageHead";
import { Kpi } from "../components/Kpi";
import EChart from "../components/EChart";
import { contributionChart, sectorExposureChart, type BookRow } from "../lib/charts5";
import { holdingMetrics, portfolioReturn, parseWatchCsv, finiteQuantity } from "../lib/holdings";

type Row = StockRow & { shares: number; cost: number };
type Enriched = Row & ReturnType<typeof holdingMetrics>;

const SAMPLE: [string, number, number][] = [
  ["600519.SH", 100, 1650],
  ["300750.SZ", 200, 210],
  ["688981.SH", 300, 78],
  ["600036.SH", 500, 38],
  ["002594.SZ", 300, 105],
  ["300059.SZ", 1000, 22],
];

const SAMPLE_VIEW = [
  { name: "贵州茅台", sector: "食品饮料", w: 72 },
  { name: "宁德时代", sector: "电力设备", w: 58 },
  { name: "中芯国际", sector: "电子", w: 46 },
  { name: "招商银行", sector: "银行", w: 36 },
  { name: "比亚迪", sector: "汽车", w: 27 },
  { name: "东方财富", sector: "非银金融", w: 18 },
];

export default function Watchlist() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Record<string, { shares?: string; cost?: string }>>({});
  const [seeding, setSeeding] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const { data, isPending, error, refetch } = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist });
  const { data: market } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });
  const rows = (data ?? []) as Row[];
  const last = market?.[market.length - 1];

  const enriched = useMemo<Enriched[]>(
    () =>
      rows.map((r) => {
        return { ...r, ...holdingMetrics(r) };
      }),
    [rows],
  );

  const sorted = [...enriched].sort((a, b) => b.mv - a.mv || a.ts_code.localeCompare(b.ts_code));
  const cny = (v: number) => `¥${Math.round(v).toLocaleString("en-US")}`;

  const totalMv = enriched.reduce((a, r) => a + r.mv, 0);
  const missingValuation = enriched.some(r => r.shares > 0 && r.quoteUnknown);
  const totalCost = enriched.reduce((a, r) => a + r.cost * r.shares, 0);
  const totalPnl = enriched.reduce((a, r) => a + r.pnl, 0);
  const incomplete = enriched.some(r => r.shares > 0 && (r.quoteUnknown || r.is_stale));
  const todayPnl = enriched.some(r => r.today === null) ? null : enriched.reduce((a, r) => a + r.today!, 0);
  const invested = enriched.filter((r) => r.shares > 0);
  const portRet = invested.length
    ? portfolioReturn(enriched)
    : enriched.length
      ? enriched.some(r => r.quoteUnknown || r.is_stale) ? null : enriched.reduce((a, r) => a + r.ret, 0) / enriched.length
      : 0;
  const up = enriched.filter((r) => r.ret > 0).length;
  const topWeight = totalMv > 0 ? Math.max(...enriched.map((r) => r.mv), 0) / totalMv : 0;

  const sectorOption = useMemo(
    () => sectorExposureChart(p, enriched as BookRow[], lang),
    [p, enriched, lang],
  );
  const contribOption = useMemo(
    () => contributionChart(p, enriched as BookRow[], lang),
    [p, enriched, lang],
  );

  const save = async (code: string, patch: { shares?: number; cost?: number }) => {
    try { await api.updateWatch(code, patch); setOperationError(null);
      qc.invalidateQueries({ queryKey: ["watchlist"] }); }
    catch (e) { setOperationError(String(e)); }
  };

  const commit = (r: Row, field: "shares" | "cost") => {
    const raw = editing[r.ts_code]?.[field];
    if (raw === undefined) return;
    try { const v = finiteQuantity(raw); void save(r.ts_code, { [field]: v }); }
    catch (e) { setOperationError(String(e)); }
    setEditing((s) => ({ ...s, [r.ts_code]: { ...s[r.ts_code], [field]: undefined } }));
  };

  const exportCsv = () => {
    const lines = ["ts_code,shares,cost", ...enriched.map((r) => `${r.ts_code},${r.shares},${r.cost}`)];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ashare-radar_watchlist.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importCsv = async (file: File) => {
    try { const items = parseWatchCsv(await file.text());
      for (const i of items) await api.addWatch(i.ts_code, i.shares, i.cost);
      setOperationError(null);
    } catch(e) { setOperationError(String(e)); }
    finally { qc.invalidateQueries({ queryKey: ["watchlist"] }); }
  };

  const remove = async (code: string) => {
    try { await api.removeWatch(code); setOperationError(null);
      qc.invalidateQueries({ queryKey: ["watchlist"] }); }
    catch(e) { setOperationError(String(e)); }
  };

  const loadSample = async () => {
    setSeeding(true);
    try {
      for (const [code, shares, cost] of SAMPLE) await api.addWatch(code, shares, cost);
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    } catch(e) { setOperationError(String(e)); } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        kicker={`${zh ? "自选组合" : "Watchlist"} / ${last?.trade_date ?? "—"}`}
        title={zh ? "组合收益与行业暴露" : "Portfolio return and exposure"}
        dek={
          zh
            ? "持仓市值、浮动盈亏、行业暴露与今日贡献；可直接编辑股数/成本，支持 CSV 导入导出"
            : "Market value, P&L, sector exposure and today contribution; edit shares/cost inline or import/export CSV"
        }
        chips={
          <>
            <span className="pill">{rows.length} {zh ? "只自选" : "holdings"}</span>
            <span className="pill">{zh ? "组合 vs 市场" : "Book vs market"}</span>
            <span className="pill">{zh ? "CSV 可导入导出" : "CSV in / out"}</span>
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              disabled={!rows.length}
              className="flex h-[34px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-[11.5px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
            >
              <Download size={11} /> CSV
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-[34px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-[11.5px] text-[var(--muted)] hover:text-[var(--text)]"
            >
              <Upload size={11} /> CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
            />
          </div>
        }
      />

      {(error || operationError) && <div role="alert" className="card p-4 text-[var(--warn)]">{zh ? "持仓操作或加载未完成" : "Positions could not be loaded or saved"} · {operationError ?? String(error)} <button onClick={() => refetch()}>{zh ? "重试" : "Retry"}</button></div>}
      {incomplete && <div role="status" className="card p-3 text-[var(--warn)]">{zh ? "部分持仓缺报价或报价已过期：旧报价仅供估值，不代表可成交价格；组合今日收益暂不可用。" : "Some quotes are missing or stale. Last quotes are valuation references, not executable prices; today's portfolio return is unavailable."}</div>}
      {isPending ? <div className="card p-6">{zh ? "正在读取持仓…" : "Loading positions…"}</div> : !rows.length ? (
        <div className="card overflow-hidden">
          <div className="grid lg:grid-cols-[1.5fr_1fr]">
            <div className="p-5 md:p-8">
              <div className="kicker">{zh ? "从一只真正关心的股票开始" : "Start with one name you care about"}</div>
              <h2 className="serif mt-2 max-w-[520px] text-[23px] font-bold leading-[1.35] tracking-[-0.02em] text-[var(--text)]">
                {zh ? "先建一个能解释的组合" : "Build a book you can explain"}
              </h2>
              <p className="mt-2 max-w-[52ch] text-[12.5px] leading-[1.8] text-[var(--text-2)]">
                {zh
                  ? "添加持仓并填入股数与成本，页面汇总市值、浮动盈亏、行业暴露和今日贡献；不填股数时按等权展示"
                  : "A watchlist is not a bookmark folder. Add shares and cost, and the page shows where today's P&L came from, which sectors you are exposed to, and whether the book beat the equal-weight market"}
              </p>

              <div className="mt-6 space-y-4">
                {[
                  {
                    n: "01",
                    t: zh ? "添加你真正持有的股票" : "Add what you actually hold",
                    d: zh ? "从个股页搜索，或直接导入 CSV；代码支持沪深 A 股" : "Search from Stocks, or import a CSV; A-share codes supported",
                  },
                  {
                    n: "02",
                    t: zh ? "填股数与成本" : "Enter shares and cost",
                    d: zh ? "股数决定组合权重，成本决定盈亏；不填也能看等权组合" : "Shares drive weight, cost drives P&L; blank still gives an equal-weight view",
                  },
                  {
                    n: "03",
                    t: zh ? "查看行业暴露" : "Read sector exposure",
                    d: zh ? "行业暴露、集中度、今日贡献会随持仓自动更新" : "Sector exposure, concentration and today's contribution update with the book",
                  },
                ].map((s) => (
                  <div key={s.n} className="flex gap-3">
                    <span className="mono mt-[1px] text-[10.5px] text-[var(--copper)]">{s.n}</span>
                    <div>
                      <div className="text-[12.5px] text-[var(--text)]">{s.t}</div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--muted)]">{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-2">
                <button
                  onClick={loadSample}
                  disabled={seeding}
                  className="flex h-[32px] items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {seeding ? (zh ? "载入中…" : "Loading…") : zh ? "载入示例组合" : "Load sample book"}
                  {!seeding && <ArrowUpRight size={13} />}
                </button>
                <Link
                  to="/stocks"
                  className="flex h-[32px] items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 text-[12.5px] text-[var(--text-2)] transition-colors hover:text-[var(--text)]"
                >
                  {zh ? "去个股页挑选" : "Browse stocks"} <ArrowUpRight size={13} />
                </Link>
              </div>
            </div>

            <div className="border-t border-[var(--border)] bg-[var(--surface-2)] p-5 md:p-7 lg:border-l lg:border-t-0">
              <div className="flex items-center justify-between">
                <div className="micro">{zh ? "示例组合 · 示意" : "Sample book · preview"}</div>
                <span className="pill">{SAMPLE_VIEW.length} {zh ? "只" : "names"}</span>
              </div>
              <div className="mt-4 space-y-2.5">
                {SAMPLE_VIEW.map((s) => (
                  <div key={s.name} className="grid grid-cols-[1fr_74px] items-center gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] text-[var(--text-2)]">{s.name}</div>
                      <div className="micro mt-0.5">{s.sector}</div>
                    </div>
                    <div className="h-[4px] overflow-hidden rounded-full bg-[var(--panel-3)]">
                      <div className="h-full rounded-full bg-[var(--accent)]/45" style={{ width: `${s.w}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-lg border border-dashed border-[var(--border)] p-3 text-[11px] leading-relaxed text-[var(--muted)]">
                {zh
                  ? "示例仅用于预览布局，载入后可以逐行改股数/成本，或再移除。不会写入任何交易记录"
                  : "Preview only. Once loaded, edit shares/cost inline or remove names. No trade records are written"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label={zh ? "总市值" : "Market value"} value={money(missingValuation ? null : totalMv)} sub={zh ? `${invested.length} 只有股数` : `${invested.length} with shares`} hint={zh ? "现价 × 股数；缺报价时组合估值未知" : "Close × shares; unavailable if any quote is missing"} />
            <Kpi label={zh ? "总成本" : "Cost"} value={money(totalCost)} sub={zh ? "按持仓成本汇总" : "At cost"} hint={zh ? "Σ 成本 × 股数" : "Σ cost × shares"} />
            <Kpi
              label={zh ? "浮动盈亏" : "P&L"}
              value={missingValuation ? "—" : `${totalPnl >= 0 ? "+" : "−"}${money(Math.abs(totalPnl))}`}
              tone={totalPnl >= 0 ? "up" : "down"}
              sub={!missingValuation && totalCost > 0 ? `${zh ? "收益率" : "return"} ${pct(totalPnl / totalCost)}` : "—"}
            />
            <Kpi
              label={zh ? "今日盈亏" : "Today P&L"}
              value={todayPnl === null ? "—" : `${todayPnl >= 0 ? "+" : "−"}${money(Math.abs(todayPnl))}`}
              tone={(todayPnl ?? 0) >= 0 ? "up" : "down"}
              sub={zh ? "按前收盘参考价估算" : "Mark-to-market today"}
            />
            <Kpi label={zh ? "组合 vs 市场" : "Book vs market"} value={pct(portRet)} tone={trendClass(portRet) as "up" | "down" | "neutral"} sub={`${zh ? "等权市场" : "EW market"} ${pct(last?.ew_ret ?? null)}`} />
            <Kpi label={zh ? "最大单票" : "Top holding"} value={ratio(topWeight, 0)} sub={zh ? "集中度参考" : "Concentration"} hint={zh ? "最大持仓市值 / 组合总市值" : "Largest position / total MV"} />
          </div>

          <div className="grid grid-cols-12 gap-3.5">
            <div className="col-span-12 xl:col-span-7">
              <Card
                index="01"
                title={zh ? "行业暴露" : "Sector exposure"}
                subtitle={zh ? "按持仓市值 · 同一行业合并 · 权重 = 行业市值 / 组合市值" : "By market value, grouped by SW L1 · weight = sector MV / book MV"}
                right={<span className="pill">{new Set(enriched.map((r) => r.sw_l1)).size} {zh ? "个行业" : "sectors"}</span>}
                prov={zh ? "仅统计填写了股数的持仓；未填股数仍留在表内，但不进入暴露" : "Only positions with shares count toward exposure"}
                padded={false}
                bodyClass="pt-0"
                footer={
                  <div className="provline">
                    <span>SOURCE <b>daily / daily_basic</b></span>
                    <span>{zh ? "按申万一级" : "SW L1"}</span>
                    <span className="r">{zh ? "红色 = 上涨" : "red = up"}</span>
                  </div>
                }
              >
                <div className="h-[290px] px-2 pb-2">
                  {totalMv > 0 ? <EChart option={sectorOption} ariaLabel={zh ? "行业暴露" : "Sector exposure"} /> : <div className="flex h-full items-center justify-center text-[11.5px] text-[var(--faint)]">{zh ? "填写股数后显示行业暴露" : "Add shares to see exposure"}</div>}
                </div>
              </Card>
            </div>

            <div className="col-span-12 xl:col-span-5">
              <Card
                index="02"
                title={zh ? "今日盈亏贡献" : "Today's P&L contribution"}
                subtitle={zh ? "个股对组合今日盈亏的绝对贡献 · Top 10" : "Per-name contribution to today's book P&L · top 10"}
                right={<span className={`pill ${(todayPnl ?? 0) >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>{todayPnl === null ? "—" : `${todayPnl >= 0 ? "+" : "−"}${money(Math.abs(todayPnl))}`}</span>}
                prov={zh ? "股数 ×（收盘价 − 前收盘参考价）；假设股数不变，不含交易及现金分红" : "Shares × (close − previous reference close); unchanged shares, excluding trades and cash dividends"}
                padded={false}
                bodyClass="pt-0"
              >
                <div className="h-[290px] px-2 pb-2">
                  {invested.length ? <EChart option={contribOption} ariaLabel={zh ? "今日盈亏贡献" : "P&L contribution"} /> : <div className="flex h-full items-center justify-center text-[11.5px] text-[var(--faint)]">{zh ? "填写股数后显示贡献" : "Add shares to see contribution"}</div>}
                </div>
              </Card>
            </div>
          </div>

          <Card
            index="03"
            title={zh ? "持仓与自选" : "Positions"}
            subtitle={zh ? "可直接编辑股数/成本 · 组合权重按持仓市值 · 支持 CSV 导入导出" : "Edit shares / cost inline · weight by market value · CSV import/export"}
            right={
              <span className="pill">
                {zh ? "上涨" : "up"} {up}/{rows.length}
              </span>
            }
            prov={zh ? "未填股数时市值/权重显示为 —；成本为 0 时盈亏显示为 —" : "Blank shares show —; zero cost shows — for P&L"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>daily / daily_basic / watchlist</b></span>
                <span>N <b>{rows.length}</b></span>
                <span className="r">{zh ? "数据日期" : "as of"} {last?.trade_date ?? "—"}</span>
              </div>
            }
          >
            <div className="overflow-x-auto px-3 pb-3">
              <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-[var(--faint)]">
                    <th className="py-2 pl-2 font-medium">{zh ? "名称" : "Name"}</th>
                    <th className="text-right font-medium">{zh ? "股数" : "Shares"}</th>
                    <th className="text-right font-medium">{zh ? "成本" : "Cost"}</th>
                    <th className="text-right font-medium">{zh ? "现价" : "Price"}</th>
                    <th className="text-right font-medium">{zh ? "今日" : "Today"}</th>
                    <th className="text-right font-medium">{zh ? "市值" : "MV"}</th>
                    <th className="text-right font-medium">{zh ? "盈亏" : "P&L"}</th>
                    <th className="text-right font-medium">{zh ? "组合权重" : "Book weight"}</th>
                    <th className="text-right font-medium">{zh ? "今日盈亏" : "Today P&L"}</th>
                    <th className="w-[30px]" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const weight = totalMv > 0 ? r.mv / totalMv : 0;
                    const edit = editing[r.ts_code] || {};
                    return (
                      <tr key={r.ts_code} className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]">
                        <td className="py-[8px] pl-2">
                          <div className="text-[13px] text-[var(--text)]">{r.name}</div>
                          <div className="mono text-[10.5px] text-[var(--faint)]">{r.ts_code} · {r.sw_l1}</div>{(r.is_stale || r.quote_missing) && <div className="text-[10px] text-[var(--warn)]">{zh ? "最后报价" : "Last quote"} {r.quote_date ?? "—"}</div>}
                        </td>
                        <td className="text-right">
                          <input
                            value={edit.shares ?? String(r.shares || "")}
                            onChange={(e) => setEditing((s) => ({ ...s, [r.ts_code]: { ...s[r.ts_code], shares: e.target.value } }))}
                            onBlur={() => commit(r, "shares")}
                            onKeyDown={(e) => e.key === "Enter" && commit(r, "shares")}
                            className="mono w-[72px] rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-[12px] text-[var(--text)] outline-none hover:border-[var(--border)] focus:border-[var(--border-strong)]"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="text-right">
                          <input
                            value={edit.cost ?? String(r.cost || "")}
                            onChange={(e) => setEditing((s) => ({ ...s, [r.ts_code]: { ...s[r.ts_code], cost: e.target.value } }))}
                            onBlur={() => commit(r, "cost")}
                            onKeyDown={(e) => e.key === "Enter" && commit(r, "cost")}
                            className="mono w-[72px] rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-[12px] text-[var(--text)] outline-none hover:border-[var(--border)] focus:border-[var(--border-strong)]"
                            inputMode="decimal"
                          />
                        </td>
                        <td className="mono text-right text-[var(--text-2)]">{r.close?.toFixed(2) ?? "—"}</td>
                        <td className={`mono text-right ${trendClass(r.ret)}`}>{pct(r.ret)}</td>
                        <td className="mono text-right text-[var(--text-2)]">{r.mv ? money(r.mv) : "—"}</td>
                        <td className={`mono text-right ${trendClass(r.pnl)}`}>
                          {r.cost > 0 && !r.quoteUnknown ? `${money(r.pnl)} (${pct(r.pnlPct)})` : "—"}
                        </td>
                        <td className="mono text-right text-[var(--text-2)]">{weight ? ratio(weight, 0) : "—"}</td>
                        <td className={`mono text-right ${trendClass(r.today)}`}>{r.shares ? money(r.today) : "—"}</td>
                        <td className="pr-1 text-right">
                          <button
                            onClick={() => remove(r.ts_code)}
                            className="text-[var(--faint)] transition-colors hover:text-[var(--up)]"
                            title={zh ? "移除" : "Remove"}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between pb-2 text-[10.5px] text-[var(--faint)]">
            <span>{zh ? "未填股数时按等权展示；CSV 列：ts_code,shares,cost" : "Blank shares fall back to equal-weight; CSV: ts_code,shares,cost"}</span>
            <span className="mono">{last?.trade_date}</span>
          </div>
        </>
      )}
    </div>
  );
}
