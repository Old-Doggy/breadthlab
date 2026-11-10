import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";
import { MicroLabel } from "./Card";

interface KpiProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  tone?: "up" | "down" | "accent" | "neutral";
  spark?: number[];
  sparkTone?: "up" | "down" | "accent" | "neutral";
  accent?: boolean;
}

export function Kpi({
  label,
  value,
  sub,
  delta,
  tone = "neutral",
  spark,
  sparkTone,
  accent = false,
}: KpiProps) {
  const valueColor =
    tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "accent" ? "var(--accent)" : "var(--text)";
  return (
    <div className="card card-pad flex flex-col justify-between gap-3 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {delta && <span className="text-[10.5px] mono text-[var(--muted)]">{delta}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div
          className="mono text-[22px] font-semibold leading-none tracking-tight whitespace-nowrap"
          style={{ color: accent ? "var(--accent)" : valueColor }}
        >
          {value}
        </div>
        {spark && spark.length > 1 && (
          <div className="shrink-0 opacity-90">
            <Sparkline values={spark} tone={sparkTone || tone} width={64} height={24} />
          </div>
        )}
      </div>
      {sub && <div className="text-[11px] leading-tight text-[var(--muted)] truncate">{sub}</div>}
    </div>
  );
}
