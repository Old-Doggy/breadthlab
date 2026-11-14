import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { hasDataWarnings } from "../lib/viewMetrics";

export function StatusBar() {
  const { i18n } = useTranslation();
  const en = i18n.language === "en";
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });
  const { data: quality } = useQuery({ queryKey: ["quality"], queryFn: api.quality, staleTime: 60_000 });
  const gates = quality?.gates ?? [];
  const passed = gates.filter((g) => g.pass).length;
  const warnings = hasDataWarnings(meta, gates);
  const ok = meta?.status === "ok" && !!quality?.passed && !warnings;
  const stale = meta?.status === "stale" || meta?.status === "failed";
  const time = meta?.updated_at
    ? new Date(meta.updated_at).toLocaleTimeString(en ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <footer className="no-print hidden h-[30px] shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--border)] bg-[var(--bg-2)] px-3 font-mono text-[11px] tracking-[0.04em] text-[var(--faint)] md:flex md:gap-4 md:px-5">
      <span className={stale || !ok ? "text-[var(--warn)]" : "text-[var(--down)]"}>
        ● {stale ? (en ? "Update incomplete" : "更新未完成") : ok ? (en ? "Data checked" : "数据已校验") : (en ? "Data warnings" : "数据有告警")}
      </span>
      <span className="hidden sm:inline">{meta?.source || (en ? "unknown" : "未知")}</span>
      <span className="text-[var(--muted)]">{meta?.last_trade_date || "—"}</span>
      <span className="hidden md:inline">{meta?.n_stocks ? `${meta.n_stocks.toLocaleString("en-US")} ${en ? "stocks" : "只"}` : "—"}</span>
      <span className="hidden lg:inline">{en ? "Gates" : "门禁"} {gates.length ? `${passed}/${gates.length}` : "—"}</span>
      <span className="hidden lg:inline">{en ? "Updated" : "更新"} {time}</span>
      <span className="ml-auto hidden xl:inline">daily → core → mart</span>
      <span className="hidden md:inline text-[var(--border-strong)]">|</span>
      <span className="hidden md:inline">⌘K {en ? "Commands" : "命令"}</span>
      <span className="hidden md:inline">v0.3.0</span>
    </footer>
  );
}
