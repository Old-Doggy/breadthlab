import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { palettes } from "../lib/theme";
import { money, num, pct, ratio, trendClass } from "../lib/format";
import { Card, MicroLabel } from "../components/Card";

export default function Watchlist() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme } = useUI();
  const p = palettes[theme];
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist });
  const { data: market } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });
  const rows = data ?? [];
  const last = market?.[market.length - 1];

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const rets = rows.map((r) => r.ret);
    const ew = rets.reduce((a, b) => a + b, 0) / rets.length;
    const up = rets.filter((r) => r > 0).length;
    const contrib = rows
      .map((r) => ({ code: r.ts_code, name: r.name, c: r.ret / rows.length }))
      .sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
    return { ew, up, contrib, best: Math.max(...rets), worst: Math.min(...rets) };
  }, [rows]);

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
        <span className="pill h-[24px]">
          {rows.length} {lang === "en" ? "holdings" : "只自选"}
        </span>
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
                  for (const c of ["600519.SH", "300750.SZ", "688981.SH", "600036.SH", "002594.SZ", "300059.SZ"]) {
                    await api.addWatch(c);
                  }
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { k: lang === "en" ? "Equal-weight return" : "自选等权收益", v: pct(summary?.ew ?? null), tone: trendClass(summary?.ew) },
              { k: lang === "en" ? "Market EW" : "全市场等权", v: pct(last?.ew_ret ?? null), tone: trendClass(last?.ew_ret) },
              {
                k: lang === "en" ? "Excess" : "超额",
                v: pct((summary?.ew ?? 0) - (last?.ew_ret ?? 0)),
                tone: trendClass((summary?.ew ?? 0) - (last?.ew_ret ?? 0)),
              },
              { k: lang === "en" ? "Holdings advancing" : "自选上涨占比", v: ratio((summary?.up ?? 0) / rows.length, 0) },
            ].map((s) => (
              <div key={s.k} className="card card-pad">
                <MicroLabel>{s.k}</MicroLabel>
                <div className={`mono mt-2 text-[21px] font-semibold ${s.tone || ""}`}>{s.v}</div>
              </div>
            ))}
          </div>

          <Card
            title={lang === "en" ? "Positions" : "持仓与自选"}
            subtitle={
              lang === "en"
                ? "Equal weights · contribution = return / N"
                : "按等权计算 · 贡献 = 收益 / 持仓数"
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="px-3 pb-3">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="text-left text-[9.5px] uppercase tracking-wider text-[var(--faint)]">
                    <th className="py-2 pl-2 font-medium">{lang === "en" ? "Name" : "名称"}</th>
                    <th className="font-medium">{lang === "en" ? "Sector" : "行业"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Return" : "收益"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Contribution" : "贡献"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Float cap" : "流通市值"}</th>
                    <th className="text-right font-medium">{lang === "en" ? "Amount" : "成交额"}</th>
                    <th className="w-[36px]" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const contrib = r.ret / rows.length;
                    const w = Math.min(100, (Math.abs(contrib) / Math.max(1e-9, Math.abs(summary?.contrib[0]?.c ?? 1))) * 100);
                    return (
                      <tr key={r.ts_code} className="border-t border-[var(--border)] hover:bg-[var(--panel-2)]">
                        <td className="py-[9px] pl-2">
                          <div className="text-[12px] text-[var(--text)]">{r.name}</div>
                          <div className="mono text-[9.5px] text-[var(--faint)]">{r.ts_code}</div>
                        </td>
                        <td className="text-[10.5px] text-[var(--muted)]">{r.sw_l1}</td>
                        <td className={`mono text-right ${trendClass(r.ret)}`}>{pct(r.ret)}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="relative h-[4px] w-[64px] overflow-hidden rounded-full bg-[var(--panel-3)]">
                              <div
                                className="absolute top-0 h-full rounded-full"
                                style={{
                                  width: `${w / 2}%`,
                                  left: contrib >= 0 ? "50%" : `${50 - w / 2}%`,
                                  background: contrib >= 0 ? p.up : p.down,
                                  opacity: 0.8,
                                }}
                              />
                            </div>
                            <span className={`mono w-[52px] ${trendClass(contrib)}`}>
                              {contrib >= 0 ? "+" : ""}
                              {(contrib * 100).toFixed(2)}%
                            </span>
                          </div>
                        </td>
                        <td className="mono text-right text-[var(--text-2)]">{(r.circ_mv / 1e4).toFixed(0)}亿</td>
                        <td className="mono text-right text-[var(--text-2)]">{money(r.amount)}</td>
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

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[
              { k: lang === "en" ? "Best" : "最佳", v: pct(summary?.best ?? null), tone: "up" },
              { k: lang === "en" ? "Worst" : "最差", v: pct(summary?.worst ?? null), tone: "down" },
              { k: lang === "en" ? "Total amount" : "合计成交额", v: money(rows.reduce((a, b) => a + (b.amount || 0), 0)) },
            ].map((s) => (
              <div key={s.k} className="card card-pad">
                <MicroLabel>{s.k}</MicroLabel>
                <div className={`mono mt-2 text-[16px] font-medium ${s.tone || ""}`}>{s.v}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
