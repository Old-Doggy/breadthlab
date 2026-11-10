import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Download, Trash2, Upload } from "lucide-react";
import { api, type StockRow } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, pct, ratio, trendClass } from "../lib/format";
import { Card, MicroLabel } from "../components/Card";

type Row = StockRow & { shares: number; cost: number };

export default function Watchlist() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Record<string, { shares?: string; cost?: string }>>({});

  const { data } = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist });
  const { data: market } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });
  const rows = (data ?? []) as Row[];
  const last = market?.[market.length - 1];

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const shares = Number(r.shares) || 0;
        const cost = Number(r.cost) || 0;
        const mv = shares * (r.close || 0);
        const pnl = cost > 0 ? (r.close - cost) * shares : 0;
        const pnlPct = cost > 0 ? r.close / cost - 1 : 0;
        const today = shares * (r.close || 0) * (r.ret || 0);
        return { ...r, shares, cost, mv, pnl, pnlPct, today };
      }),
    [rows],
  );

  const sorted = [...enriched].sort((a, b) => b.mv - a.mv || a.ts_code.localeCompare(b.ts_code));
  const cny = (v: number) => `¥${Math.round(v).toLocaleString("en-US")}`;

  const totalMv = enriched.reduce((a, r) => a + r.mv, 0);
  const totalCost = enriched.reduce((a, r) => a + r.cost * r.shares, 0);
  const totalPnl = enriched.reduce((a, r) => a + r.pnl, 0);
  const todayPnl = enriched.reduce((a, r) => a + r.today, 0);
  const invested = enriched.filter((r) => r.shares > 0);
  const portRet = invested.length
    ? invested.reduce((a, r) => a + r.ret * (r.mv / (totalMv || 1)), 0)
    : enriched.length
      ? enriched.reduce((a, r) => a + r.ret, 0) / enriched.length
      : 0;
  const up = enriched.filter((r) => r.ret > 0).length;

  const save = async (code: string, patch: { shares?: number; cost?: number }) => {
    await api.updateWatch(code, patch);
    qc.invalidateQueries({ queryKey: ["watchlist"] });
  };

  const commit = (r: Row, field: "shares" | "cost") => {
    const raw = editing[r.ts_code]?.[field];
    if (raw === undefined) return;
    const v = Number(raw);
    if (!Number.isNaN(v)) void save(r.ts_code, { [field]: v });
    setEditing((s) => ({ ...s, [r.ts_code]: { ...s[r.ts_code], [field]: undefined } }));
  };

  const exportCsv = () => {
    const lines = ["ts_code,shares,cost", ...enriched.map((r) => `${r.ts_code},${r.shares},${r.cost}`)];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "breadthlab_watchlist.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    for (const line of text.split(/\r?\n/).slice(1)) {
      const [code, shares, cost] = line.split(",").map((s) => s.trim());
      if (!code) continue;
      const s = Number(shares) || 0;
      const c = Number(cost) || 0;
      if (rows.some((r) => r.ts_code === code)) await api.updateWatch(code, { shares: s, cost: c });
      else await api.addWatch(code, s, c);
    }
    qc.invalidateQueries({ queryKey: ["watchlist"] });
  };

  const remove = async (code: string) => {
    await api.removeWatch(code);
    qc.invalidateQueries({ queryKey: ["watchlist"] });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">{t("watchlist.title")}</h1>
          <p className="mt-1 text-[12px] text-[var(--muted)]">{t("watchlist.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill h-[24px]">
            {rows.length} {lang === "en" ? "holdings" : "只自选"}
          </span>
          <button
            onClick={exportCsv}
            disabled={!rows.length}
            className="flex h-[24px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[10.5px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <Download size={11} /> CSV
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-[24px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[10.5px] text-[var(--muted)] hover:text-[var(--text)]"
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
      </div>

      {!rows.length ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-3 py-14">
            <div className="text-[13px] text-[var(--muted)]">{t("watchlist.empty")}</div>
            <div className="flex items-center gap-2">
              <Link
                to="/stocks"
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[11.5px] text-[var(--text-2)] hover:text-[var(--text)]"
              >
                {lang === "en" ? "Browse stocks →" : "去个股页挑选 →"}
              </Link>
              <button
                onClick={async () => {
                  const sample: [string, number, number][] = [
                    ["600519.SH", 100, 1650],
                    ["300750.SZ", 200, 210],
                    ["688981.SH", 300, 78],
                    ["600036.SH", 500, 38],
                    ["002594.SZ", 300, 105],
                    ["300059.SZ", 1000, 22],
                  ];
                  for (const [c, s, k] of sample) await api.addWatch(c, s, k);
                  qc.invalidateQueries({ queryKey: ["watchlist"] });
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[11.5px] text-[var(--muted)] hover:text-[var(--text)]"
              >
                {lang === "en" ? "Load sample book" : "载入示例组合"}
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              { k: lang === "en" ? "Market value" : "总市值", v: cny(totalMv) },
              { k: lang === "en" ? "Cost" : "总成本", v: cny(totalCost) },
              { k: lang === "en" ? "P&L" : "浮动盈亏", v: cny(totalPnl), tone: trendClass(totalPnl) },
              {
                k: lang === "en" ? "P&L %" : "盈亏比例",
                v: totalCost > 0 ? pct(totalPnl / totalCost) : "—",
                tone: trendClass(totalPnl),
              },
              { k: lang === "en" ? "Today" : "今日盈亏", v: cny(todayPnl), tone: trendClass(todayPnl) },
              {
                k: lang === "en" ? "Book vs market" : "组合 vs 市场",
                v: `${pct(portRet)} / ${pct(last?.ew_ret ?? 0)}`,
                tone: trendClass(portRet - (last?.ew_ret ?? 0)),
              },
            ].map((s) => (
              <div key={s.k} className="card card-pad">
                <MicroLabel>{s.k}</MicroLabel>
                <div className={`mono mt-2 text-[17px] font-semibold ${s.tone || ""}`}>{s.v}</div>
              </div>
            ))}
          </div>

          <Card
            title={lang === "en" ? "Positions" : "持仓与自选"}
            subtitle={
              lang === "en"
                ? "Edit shares / cost inline · weight uses market value · CSV import/export"
                : "可直接编辑股数/成本 · 权重按市值 · 支持 CSV 导入导出"
            }
            right={
              <span className="pill h-[22px] px-2 text-[10px]">
                {lang === "en" ? "up" : "上涨"} {up}/{rows.length}
              </span>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="overflow-x-auto px-3 pb-3">
              <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
                <thead>
                  <tr className="text-left text-[9.5px] uppercase tracking-wider text-[var(--faint)]">
                    <th className="py-2 pl-2 font-medium">{lang === "en" ? "Name" : "名称"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Shares" : "股数"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Cost" : "成本"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Price" : "现价"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Return" : "今日"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Market value" : "市值"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "P&L" : "盈亏"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Weight" : "权重"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Today P&L" : "今日盈亏"}</th>
                    <th className="w-[30px]" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const weight = totalMv > 0 ? r.mv / totalMv : 0;
                    const edit = editing[r.ts_code] || {};
                    return (
                      <tr key={r.ts_code} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
                        <td className="py-[8px] pl-2">
                          <div className="text-[12px] text-[var(--text)]">{r.name}</div>
                          <div className="mono text-[9.5px] text-[var(--faint)]">{r.ts_code} · {r.sw_l1}</div>
                        </td>
                        <td className="text-right">
                          <input
                            value={edit.shares ?? String(r.shares || "")}
                            onChange={(e) => setEditing((s) => ({ ...s, [r.ts_code]: { ...s[r.ts_code], shares: e.target.value } }))}
                            onBlur={() => commit(r, "shares")}
                            onKeyDown={(e) => e.key === "Enter" && commit(r, "shares")}
                            className="mono w-[72px] rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-[11px] text-[var(--text)] outline-none hover:border-[var(--border)] focus:border-[var(--border-strong)]"
                            inputMode="numeric"
                          />
                        </td>
                        <td className="text-right">
                          <input
                            value={edit.cost ?? String(r.cost || "")}
                            onChange={(e) => setEditing((s) => ({ ...s, [r.ts_code]: { ...s[r.ts_code], cost: e.target.value } }))}
                            onBlur={() => commit(r, "cost")}
                            onKeyDown={(e) => e.key === "Enter" && commit(r, "cost")}
                            className="mono w-[72px] rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-[11px] text-[var(--text)] outline-none hover:border-[var(--border)] focus:border-[var(--border-strong)]"
                            inputMode="decimal"
                          />
                        </td>
                        <td className="mono text-right text-[var(--text-2)]">{r.close?.toFixed(2)}</td>
                        <td className={`mono text-right ${trendClass(r.ret)}`}>{pct(r.ret)}</td>
                        <td className="mono text-right text-[var(--text-2)]">{r.mv ? money(r.mv) : "—"}</td>
                        <td className={`mono text-right ${trendClass(r.pnl)}`}>
                          {r.cost > 0 ? `${money(r.pnl)} (${pct(r.pnlPct)})` : "—"}
                        </td>
                        <td className="mono text-right text-[var(--text-2)]">{weight ? ratio(weight, 0) : "—"}</td>
                        <td className={`mono text-right ${trendClass(r.today)}`}>{r.shares ? money(r.today) : "—"}</td>
                        <td className="pr-1 text-right">
                          <button
                            onClick={() => remove(r.ts_code)}
                            className="text-[var(--faint)] transition-colors hover:text-[var(--up)]"
                            title={lang === "en" ? "Remove" : "移除"}
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
            <span>
              {lang === "en"
                ? "Equal-weight if shares are blank; CSV columns: ts_code,shares,cost"
                : "未填股数时按等权展示；CSV 列：ts_code,shares,cost"}
            </span>
            <span className="mono">{last?.trade_date}</span>
          </div>
        </>
      )}
    </div>
  );
}
