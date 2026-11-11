import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

export function StatusBar() {
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });
  const { data: quality } = useQuery({ queryKey: ["quality"], queryFn: api.quality, staleTime: 60_000 });
  const gates = quality?.gates ?? [];
  const passed = gates.filter((g) => g.pass).length;
  const ok = meta?.status === "ok" && (quality ? quality.passed : true);
  const stale = meta?.status === "stale" || meta?.status === "failed";
  const time = meta?.updated_at
    ? new Date(meta.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <footer className="no-print hidden h-[30px] shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--border)] bg-[var(--bg-2)] px-3 font-mono text-[11px] tracking-[0.04em] text-[var(--faint)] md:flex md:gap-4 md:px-5">
      <span className={stale ? "text-[var(--warn)]" : "text-[var(--down)]"}>
        ● {stale ? "数据滞后" : ok ? "数据正常" : "门禁告警"}
      </span>
      <span className="hidden sm:inline">{meta?.source || "TUSHARE"}</span>
      <span className="text-[var(--muted)]">{meta?.last_trade_date || "—"}</span>
      <span className="hidden md:inline">{meta?.n_stocks ? `${meta.n_stocks.toLocaleString("en-US")} 只` : "—"}</span>
      <span className="hidden lg:inline">门禁 {gates.length ? `${passed}/${gates.length}` : "—"}</span>
      <span className="hidden lg:inline">更新 {time}</span>
      <span className="ml-auto hidden xl:inline">daily → core → mart</span>
      <span className="hidden md:inline text-[var(--border-strong)]">|</span>
      <span className="hidden md:inline">⌘K 命令</span>
      <span className="hidden md:inline">v2.4</span>
    </footer>
  );
}
