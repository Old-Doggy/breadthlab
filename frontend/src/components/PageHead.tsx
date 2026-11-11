import type { ReactNode } from "react";

export function Prov({ text, label = "?" }: { text: string; label?: string }) {
  return (
    <span className="prov" title={text} aria-label={text} role="img">
      {label}
    </span>
  );
}

interface PageHeadProps {
  kicker: ReactNode;
  title: ReactNode;
  dek?: ReactNode;
  chips?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export function PageHead({ kicker, title, dek, chips, right, className = "" }: PageHeadProps) {
  return (
    <header className={`flex flex-wrap items-end gap-x-6 gap-y-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <div className="kicker">{kicker}</div>
        <h1 className="serif mt-2 max-w-[760px] text-[20px] font-bold leading-[1.3] tracking-[-0.02em] text-[var(--text)] sm:text-[24px] md:text-[30px]">
          {title}
        </h1>
        {dek && <p className="mt-2 max-w-[980px] text-[12px] leading-[1.7] text-[var(--text-2)] sm:text-[13px]">{dek}</p>}
        {chips && <div className="mt-3 flex flex-wrap items-center gap-1.5">{chips}</div>}
      </div>
      {right && <div className="w-full shrink-0 sm:w-auto">{right}</div>}
    </header>
  );
}
