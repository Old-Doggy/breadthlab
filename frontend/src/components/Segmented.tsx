interface Option<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-[2px] rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-[2px] ${className}`}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={[
              "rounded-[6px] px-2.5 py-[4px] text-[11px] font-medium transition-colors duration-150",
              active
                ? "bg-[var(--panel-3)] text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,.06)]"
                : "text-[var(--muted)] hover:text-[var(--text-2)]",
            ].join(" ")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
