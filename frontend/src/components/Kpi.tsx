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

export function Kpi({ label, value, sub, delta, tone = "neutral", spark, sparkTone, accent = false }: KpiProps) {
  const valueColor =
    tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "accent" ? "var(--accent)" : "var(--text)";
  return (
    <div className="card flex min-w-0 flex-col justify-between gap-2 overflow-hidden p-3 md:gap-3 md:p-[18px]">
      <div className="flex items-center justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {delta && <span className="mono text-[10px] text-[var(--muted)] md:text-[10.5px]">{delta}</span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div
          className="mono whitespace-nowrap text-[19px] font-semibold leading-none tracking-tight md:text-[22px]"
          style={{ color: accent ? "var(--accent)" : valueColor }}
        >
          {value}
        </div>
        {spark && spark.length > 1 && (
          <div className="hidden shrink-0 opacity-90 sm:block">
            <Sparkline values={spark} tone={sparkTone || tone} width={58} height={22} />
          </div>
        )}
      </div>
      {sub && <div className="truncate text-[10px] leading-tight text-[var(--muted)] md:text-[11px]">{sub}</div>}
    </div>
  );
}
