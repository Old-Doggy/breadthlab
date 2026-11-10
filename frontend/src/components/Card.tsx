import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  bodyClass?: string;
}

export function Card({ title, subtitle, right, children, className = "", padded = true, bodyClass = "" }: CardProps) {
  return (
    <section className={`card flex flex-col min-w-0 ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pt-3.5 pb-2.5 md:px-5 md:pt-4 md:pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold tracking-tight text-[var(--text)] truncate">{title}</h2>}
            {subtitle && <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--muted)]">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={`${padded ? "px-5 pb-4" : ""} ${bodyClass} flex-1 min-h-0`}>{children}</div>
    </section>
  );
}

export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`micro ${className}`}>{children}</div>;
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`hairline ${className}`} />;
}
