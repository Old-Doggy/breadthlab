import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  bodyClass?: string;
  index?: string;
  prov?: string;
  footer?: ReactNode;
  variant?: "default" | "hero" | "flat";
}

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
  padded = true,
  bodyClass = "",
  index,
  prov,
  footer,
  variant = "default",
}: CardProps) {
  return (
    <section
      className={[
        "card flex min-w-0 flex-col",
        variant === "hero" ? "bg-[var(--surface-2)]" : "",
        variant === "flat" ? "border-0 bg-transparent shadow-none" : "",
        className,
      ].join(" ")}
    >
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 pb-2 pt-3 md:px-[18px] md:pt-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {index && <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--copper)]">{index}</span>}
              {title && (
                <h2 className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">
                  {title}
                </h2>
              )}
              {prov && (
                <span className="prov" title={prov} aria-label={prov} role="img">
                  ?
                </span>
              )}
            </div>
            {subtitle && <p className="mt-1 text-[11.5px] leading-[1.5] text-[var(--faint)]">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={`${padded ? "px-4 pb-4 md:px-[18px]" : ""} ${bodyClass} min-h-0 flex-1`}>{children}</div>
      {footer && <div className="mt-auto">{footer}</div>}
    </section>
  );
}

export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`micro ${className}`}>{children}</div>;
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`hairline ${className}`} />;
}
