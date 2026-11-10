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
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { setFmtLang } from "../lib/format";
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

function RailButton({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Gauge }) {
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
            className="absolute left-[-9px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full transition-opacity"
            style={{ background: "var(--accent)", opacity: isActive ? 1 : 0 }}
          />
          <Icon size={17} strokeWidth={isActive ? 2 : 1.6} />
          <span className="text-[9.5px] font-medium tracking-tight">{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** 移动端底部导航：桌面端隐藏。 */
function MobileNav() {
  const { t } = useTranslation();
  const items = [...NAV, { to: "/about", key: "about", icon: Info }];
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--bg)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-8">
        {items.map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-[3px] py-2 transition-colors ${
                  isActive ? "text-[var(--text)]" : "text-[var(--faint)]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} strokeWidth={isActive ? 2.1 : 1.6} />
                  <span className="text-[8.5px] leading-none">{t(`nav.${n.key}`)}</span>
                  <span
                    className="mt-[2px] h-[2px] w-4 rounded-full"
                    style={{ background: isActive ? "var(--accent)" : "transparent" }}
                  />
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export default function Shell() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme, colorblind, toggleColorblind, setLang } = useUI();
  const qc = useQueryClient();
  const location = useLocation();
  const [spin, setSpin] = useState(false);

  const { data: meta, isError } = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });

  const active = NAV.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));
  const title = active ? t(`nav.${active.key}`) : location.pathname.startsWith("/about") ? t("nav.about") : "";

  useEffect(() => {
    document.title = `${title} · BreadthLab`;
  }, [title]);

  useEffect(() => {
    setFmtLang(i18n.language);
  }, [i18n.language]);

  const refresh = () => {
    setSpin(true);
    qc.invalidateQueries();
    setTimeout(() => setSpin(false), 700);
  };

  const statusColor = isError ? "var(--warn)" : meta?.status === "ok" ? "var(--down)" : "var(--warn)";

  const stale = useMemo(() => {
    if (!meta?.last_trade_date) return null;
    const last = new Date(`${meta.last_trade_date}T00:00:00`).getTime();
    const days = Math.floor((Date.now() - last) / 86400000);
    if (days <= 7) return null;
    return { days, months: Math.round(days / 30) };
  }, [meta?.last_trade_date]);

  const printMode = location.hash.startsWith("#/briefing");
  if (printMode) {
    return (
      <div className="min-h-screen bg-white p-6 print:p-0">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      <aside className="no-print relative z-20 hidden w-[78px] shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-2)]/70 py-3 md:flex">
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
        <header className="no-print z-10 flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)]/85 px-3 backdrop-blur-xl md:h-[54px] md:px-6">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="micro hidden md:block">{t("brand")}</span>
            <span className="hidden text-[var(--faint)] md:block">/</span>
            <span className="truncate text-[13px] font-semibold tracking-tight text-[var(--text)]">{title}</span>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
            <div className="pill h-[26px] px-2 md:h-[27px] md:px-2.5">
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
              />
              <span className="hidden text-[11px] text-[var(--muted)] sm:inline">{t("common.dataAsOf")}</span>
              <span className="mono text-[10.5px] text-[var(--text-2)] md:text-[11px]">
                {isError ? "—" : meta?.last_trade_date?.slice(5) || "—"}
              </span>
            </div>

            <button
              onClick={refresh}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:text-[var(--text)] md:h-[27px] md:w-[27px]"
              title={t("common.refresh")}
            >
              <RefreshCw size={12.5} className={spin ? "animate-spin" : ""} />
            </button>

            <button
              onClick={() => setLang(i18n.language === "zh" ? "en" : "zh")}
              className="flex h-[26px] items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-1.5 text-[10.5px] text-[var(--muted)] transition-colors hover:text-[var(--text)] md:h-[27px] md:px-2 md:text-[11px]"
              title={t("common.lang")}
            >
              <Languages size={11.5} />
              {i18n.language === "zh" ? "中" : "EN"}
            </button>

            <button
              onClick={toggleTheme}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)] transition-colors hover:text-[var(--text)] md:h-[27px] md:w-[27px]"
              title={t("common.theme")}
            >
              {theme === "dark" ? <Sun size={12.5} /> : <Moon size={12.5} />}
            </button>
          </div>
        </header>

        {stale && (
          <div className="no-print flex items-center gap-2 border-b border-[var(--warn)]/25 bg-[var(--warn)]/[0.07] px-3 py-1.5 text-[10.5px] text-[var(--warn)] md:px-6">
            <span className="inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--warn)]" />
            <span className="truncate">
              {i18n.language === "en"
                ? `Data is ${stale.months} months behind. Run scripts/update.ps1 to refresh.`
                : `数据已落后约 ${stale.months} 个月，运行 scripts/update.ps1 更新`}
            </span>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1620px] px-3 py-3 pb-24 print:p-0 md:px-6 md:py-5 md:pb-6">
            <div key={location.pathname} className="rise">
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
