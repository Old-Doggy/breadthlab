import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CandlestickChart,
  Flame,
  Gauge,
  Info,
  Languages,
  Layers3,
  Moon,
  RefreshCw,
  ScatterChart,
  Star,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useUI } from "../store/ui";
import { useTranslation } from "react-i18next";

const NAV = [
  { to: "/", key: "today", icon: Gauge },
  { to: "/market", key: "market", icon: Activity },
  { to: "/regime", key: "regime", icon: ScatterChart },
  { to: "/sectors", key: "sectors", icon: Layers3 },
  { to: "/stocks", key: "stocks", icon: CandlestickChart },
  { to: "/sentiment", key: "sentiment", icon: Flame },
  { to: "/watchlist", key: "watchlist", icon: Star },
] as const;

function Logo() {
  return (
    <div className="relative grid h-9 w-9 place-items-center rounded-[11px] border border-[var(--border-strong)] bg-[var(--panel-2)]">
      <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden>
        <rect x="2.5" y="11" width="3.2" height="6.5" rx="1" fill="var(--faint)" />
        <rect x="8.4" y="7" width="3.2" height="10.5" rx="1" fill="var(--accent)" />
        <rect x="14.3" y="2.5" width="3.2" height="15" rx="1" fill="var(--up)" />
        <path d="M1.5 6.2 L7 3.4 L12.4 5.4 L18.5 1.6" stroke="var(--text)" strokeOpacity=".55" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function RailButton({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Gauge;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "group relative flex h-[54px] w-[60px] flex-col items-center justify-center gap-1 rounded-xl transition-colors duration-200",
          isActive
            ? "bg-[var(--panel-2)] text-[var(--text)]"
            : "text-[var(--faint)] hover:bg-[var(--panel-2)] hover:text-[var(--text-2)]",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span
            className="absolute left-[-8px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full transition-opacity"
            style={{ background: "var(--accent)", opacity: isActive ? 1 : 0 }}
          />
          <Icon size={17} strokeWidth={isActive ? 2 : 1.6} />
          <span className="text-[9.5px] font-medium tracking-tight">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Shell() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme, lang, setLang } = useUI();
  const qc = useQueryClient();
  const location = useLocation();
  const [spin, setSpin] = useState(false);

  const { data: meta, isError } = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });

  const active = NAV.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));
  const title = active ? t(`nav.${active.key}`) : location.pathname.startsWith("/about") ? t("nav.about") : "";

  useEffect(() => {
    document.title = `${title} · BreadthLab`;
  }, [title]);

  const refresh = () => {
    setSpin(true);
    qc.invalidateQueries();
    setTimeout(() => setSpin(false), 700);
  };

  const statusColor = isError ? "var(--warn)" : meta?.status === "ok" ? "var(--down)" : "var(--warn)";

  return (
    <div className="flex h-full w-full">
      <aside className="relative z-20 flex w-[78px] shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-2)]/70 py-3">
        <div className="mb-4 mt-1">
          <Logo />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map((n) => (
            <RailButton key={n.to} to={n.to} label={t(`nav.${n.key}`)} icon={n.icon} />
          ))}
        </nav>
        <div className="flex flex-col items-center gap-1">
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                isActive ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text-2)]"
              }`
            }
            title={t("nav.about")}
          >
            <Info size={16} strokeWidth={1.7} />
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-[54px] shrink-0 items-center gap-4 border-b border-[var(--border)] bg-[var(--bg)]/80 px-6 backdrop-blur-xl">
          <div className="flex items-baseline gap-2">
            <span className="micro hidden sm:block">{t("brand")}</span>
            <span className="text-[var(--faint)]">/</span>
            <span className="text-[13px] font-semibold tracking-tight text-[var(--text)]">{title}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="pill h-[27px]">
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
              />
              <span className="text-[11px] text-[var(--muted)]">{t("common.dataAsOf")}</span>
              <span className="mono text-[11px] text-[var(--text-2)]">
                {isError ? "—" : (meta?.last_trade_date || "—")}
              </span>
            </div>

            <button
              onClick={refresh}
              className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              title={t("common.refresh")}
            >
              <RefreshCw size={13} className={spin ? "animate-spin" : ""} />
            </button>

            <button
              onClick={() => setLang(i18n.language === "zh" ? "en" : "zh")}
              className="flex h-[27px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              title={t("common.lang")}
            >
              <Languages size={12} />
              {lang === "zh" ? "中" : "EN"}
            </button>

            <button
              onClick={toggleTheme}
              className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              title={t("common.theme")}
            >
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1620px] px-6 py-5">
            <div key={location.pathname} className="rise">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
