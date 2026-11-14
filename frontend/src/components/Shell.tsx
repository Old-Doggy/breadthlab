import { quoteAgeDays } from "../lib/viewMetrics";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CandlestickChart,
  FileText,
  Flame,
  Gauge,
  Info,
  Languages,
  Layers3,
  Moon,
  MoreHorizontal,
  Palette,
  RefreshCw,
  ScatterChart,
  Search,
  Star,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { setFmtLang } from "../lib/format";
import { useUI } from "../store/ui";
import { useTranslation } from "react-i18next";
import { CommandPalette } from "./CommandPalette";
import { UpdateControl } from "./UpdateControl";
import { StatusBar } from "./StatusBar";

function friendlyAlert(message: string | undefined, zh: boolean): string {
  const raw = (message || "").trim();
  if (!raw) return zh ? "更新脚本未完成，请稍后重试" : "The update did not finish; please retry";
  if (/traceback|module not found|no module named/i.test(raw)) {
    return zh ? "更新环境或数据源异常，请使用顶部“拉取今日数据”重试" : "The update environment or data source failed; retry with “Fetch today”";
  }
  if (/permission/i.test(raw)) return zh ? "数据源权限不足，本次更新未完成" : "Data-source permission denied";
  if (/quality|gate/i.test(raw)) return zh ? "数据质量校验未通过，本次更新已中止" : "Quality gates failed; update stopped";
  const one = raw.split(/\r?\n/).filter((x) => x.trim() && !/^Traceback/i.test(x.trim())).pop() || raw;
  return one.length > 120 ? `${one.slice(0, 120)}…` : one;
}

const NAV = [
  { to: "/", key: "today", icon: Gauge },
  { to: "/market", key: "market", icon: Activity },
  { to: "/regime", key: "regime", icon: ScatterChart },
  { to: "/sectors", key: "sectors", icon: Layers3 },
  { to: "/stocks", key: "stocks", icon: CandlestickChart },
  { to: "/sentiment", key: "sentiment", icon: Flame },
  { to: "/watchlist", key: "watchlist", icon: Star },
] as const;

const MORE = [
  { to: "/regime", key: "regime", icon: ScatterChart },
  { to: "/sentiment", key: "sentiment", icon: Flame },
  { to: "/watchlist", key: "watchlist", icon: Star },
  { to: "/about", key: "about", icon: Info },
] as const;

function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center overflow-hidden rounded-[9px]"
      style={{ width: size, height: size }}
    >
      <img src="/favicon.png" alt="" className="h-full w-full rounded-[9px] object-cover" />
    </span>
  );
}

function RailButton({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Gauge }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "group relative flex h-[60px] w-[56px] flex-col items-center justify-center gap-1 rounded-[10px] transition-colors duration-150",
          isActive
            ? "bg-[var(--surface-2)] text-[var(--text)]"
            : "text-[var(--faint)] hover:bg-[var(--surface-2)] hover:text-[var(--text-2)]",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <span
            className="absolute left-[-4px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity"
            style={{ background: "var(--accent)", opacity: isActive ? 1 : 0 }}
          />
          <Icon size={18} strokeWidth={isActive ? 2 : 1.7} />
          <span className="text-[11px] font-medium leading-none">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Shell() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme, colorblind, toggleColorblind, setLang } = useUI();
  const qc = useQueryClient();
  const location = useLocation();
  const [spin, setSpin] = useState(false);
  const [cmdk, setCmdk] = useState(new URLSearchParams(window.location.search).get("cmd") === "1");
  const [more, setMore] = useState(false);

  const { data: meta, isError } = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 60_000 });

  const active = NAV.find((n) => (n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to)));
  const title = active
    ? t(`nav.${active.key}`)
    : location.pathname.startsWith("/about")
      ? t("nav.about")
      : "";
  const moreActive = MORE.some((n) => location.pathname.startsWith(n.to));

  useEffect(() => {
    document.title = `${title} · ${i18n.language === "zh" ? "A股雷达" : "Ashare Radar"}`;
  }, [title]);

  useEffect(() => {
    setFmtLang(i18n.language);
  }, [i18n.language]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdk((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMore(false);
  }, [location.pathname]);

  const refresh = () => {
    setSpin(true);
    qc.invalidateQueries();
    window.setTimeout(() => setSpin(false), 700);
  };

  const statusColor = isError ? "var(--warn)" : meta?.status === "ok" ? "var(--down)" : "var(--warn)";

  const stale = useMemo(() => {
    if (!meta?.last_trade_date) return null;
    const days = quoteAgeDays(meta.last_trade_date);
    if (days < 1) return null;
    return { days };
  }, [meta?.last_trade_date]);

  const printMode = location.pathname.startsWith("/briefing");
  if (printMode) {
    return (
      <div className="min-h-screen bg-white p-6 print:p-0">
        <Outlet />
      </div>
    );
  }

  const time = meta?.updated_at
    ? new Date(meta.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="flex h-full w-full">
      <aside className="no-print relative z-20 hidden w-[64px] shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-2)] py-3 md:flex">
        <div className="mb-4">
          <Logo />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map((n) => (
            <RailButton key={n.to} to={n.to} label={t(`nav.${n.key}`)} icon={n.icon} />
          ))}
        </nav>
        <div className="flex flex-col items-center gap-2">
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `grid h-8 w-8 place-items-center rounded-lg transition-colors ${
                isActive ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--faint)] hover:text-[var(--text-2)]"
              }`
            }
            title={t("nav.about")}
          >
            <Info size={16} strokeWidth={1.7} />
          </NavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print z-10 flex h-[58px] shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-3 md:gap-3 md:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="md:hidden">
              <Logo size={28} />
            </span>
            <span className="micro hidden md:inline">{t("brand")}</span>
            <span className="hidden text-[var(--faint)] md:inline">/</span>
            <span className="truncate text-[14px] font-semibold tracking-tight text-[var(--text)]">{title}</span>
          </div>

          <button
            onClick={() => setCmdk(true)}
            className="ml-auto hidden h-[34px] w-[320px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] text-[var(--faint)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--muted)] md:flex"
            aria-label={i18n.language === "zh" ? "打开命令面板" : "Open command palette"}
          >
            <Search size={15} />
            <span className="truncate">{i18n.language === "zh" ? "搜索股票、行业或页面" : "Search stocks, sectors, metrics"}</span>
            <kbd className="ml-auto rounded border border-[var(--border-strong)] px-1 py-[1px] font-mono text-[11px]">⌘K</kbd>
          </button>

          <button
            onClick={() => setCmdk(true)}
            className="ml-auto grid h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] md:hidden"
            aria-label="Command"
          >
            <Search size={15} />
          </button>

          <UpdateControl />

          <div className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] sm:flex">
            <span
              className="inline-block h-[6px] w-[6px] rounded-full"
              style={{ background: statusColor, boxShadow: `0 0 7px ${statusColor}` }}
            />
            <span className="font-mono text-[11px] text-[var(--muted)]">
              {isError ? "—" : meta?.last_trade_date?.slice(5) || "—"} · {time}
            </span>
          </div>

          <a
            href="#/briefing"
            target="_blank"
            rel="noreferrer"
            className="hidden h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-[var(--text)] sm:grid"
            title={i18n.language === "zh" ? "每日简报" : "Daily briefing"}
            aria-label={i18n.language === "zh" ? "每日简报" : "Daily briefing"}
          >
            <FileText size={15} />
          </a>

          <button
            onClick={refresh}
            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
          >
            <RefreshCw size={15} className={spin ? "animate-spin" : ""} />
          </button>

          <button
            onClick={() => setLang(i18n.language === "zh" ? "en" : "zh")}
            className="hidden h-[34px] items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--text)] sm:flex"
            title={t("common.lang")}
          >
            <Languages size={15} />
            {i18n.language === "zh" ? "中" : "EN"}
          </button>

          <button
            onClick={toggleColorblind}
            className="hidden h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-[var(--text)] sm:grid"
            title={i18n.language === "en" ? (colorblind ? "Default palette" : "Colorblind palette (blue/orange)") : (colorblind ? "多色（默认）" : "色盲友好（蓝/橙）")}
            aria-pressed={colorblind}
          >
            <Palette size={15} className={colorblind ? "text-[var(--accent)]" : ""} />
          </button>

          <button
            onClick={toggleTheme}
            className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            title={t("common.theme")}
            aria-label={t("common.theme")}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </header>

        {meta?.alert && !location.pathname.startsWith("/labs") && (
          <div className="no-print flex items-center gap-2 border-b border-[var(--up)]/30 bg-[var(--up-soft)] px-3 py-1.5 text-[11.5px] text-[var(--up)] md:px-5">
            <span className="inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--up)]" />
            <span className="truncate">
              {i18n.language === "en"
                ? `Last update failed at ${meta.alert.time.slice(5, 16).replace("T", " ")} — ${friendlyAlert(meta.alert.message, false)}`
                : `上次更新失败 · ${meta.alert.time.slice(5, 16).replace("T", " ")} · ${friendlyAlert(meta.alert.message, true)}`}
            </span>
            <a href="#/about" className="ml-auto shrink-0 underline">
              {i18n.language === "en" ? "Details" : "详情"}
            </a>
          </div>
        )}

        {isError && (
          <div className="no-print flex items-center gap-2 border-b border-[var(--warn)]/25 bg-[var(--warn-soft)] px-3 py-1.5 text-[11.5px] text-[var(--warn)] md:px-5">
            <span className="inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--warn)]" />
            <span className="truncate">
              {i18n.language === "en" ? "Data unavailable — retrying…" : "数据暂不可用 · 稍后自动重试"}
            </span>
          </div>
        )}

        {stale && (
          <div className="no-print flex items-center gap-2 border-b border-[var(--warn)]/25 bg-[var(--warn-soft)] px-3 py-1.5 text-[11.5px] text-[var(--warn)] md:px-5">
            <span className="inline-block h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--warn)]" />
            <span className="truncate">
              {i18n.language === "en"
                ? `Latest observation: ${meta?.last_trade_date} (${stale.days} calendar days ago); holidays may explain the gap. Refresh to check.`
                : `最新数据 ${meta?.last_trade_date}，距今 ${stale.days} 个自然日；可能包含休市日，可刷新确认。`}
            </span>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1560px] px-3 py-4 pb-24 md:px-5 md:py-5 md:pb-6">
            <div key={location.pathname} className="rise">
              <Outlet />
            </div>
          </div>
        </main>

        <StatusBar />
      </div>

      {/* mobile bottom nav */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--bg)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid grid-cols-5">
          {[
            { to: "/", key: "today", icon: Gauge },
            { to: "/market", key: "market", icon: Activity },
            { to: "/sectors", key: "sectors", icon: Layers3 },
            { to: "/stocks", key: "stocks", icon: CandlestickChart },
          ].map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  `flex h-[54px] flex-col items-center justify-center gap-1 ${
                    isActive ? "text-[var(--text)]" : "text-[var(--faint)]"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} strokeWidth={isActive ? 2.1 : 1.7} />
                    <span className="text-[11px] leading-none">{t(`nav.${n.key}`)}</span>
                  </>
                )}
              </NavLink>
            );
          })}
          <button
            onClick={() => setMore((v) => !v)}
            className={`flex h-[54px] flex-col items-center justify-center gap-1 ${
              more || moreActive ? "text-[var(--text)]" : "text-[var(--faint)]"
            }`}
            aria-expanded={more}
          >
            {more ? <X size={18} /> : <MoreHorizontal size={18} />}
            <span className="text-[11px] leading-none">{i18n.language === "zh" ? "更多" : "More"}</span>
          </button>
        </div>
      </nav>

      {more && (
        <div className="no-print fixed inset-0 z-40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-0 bg-black/45" />
          <div
            className="absolute inset-x-0 bottom-[54px] rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)] p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="micro">{i18n.language === "zh" ? "更多页面" : "More"}</span>
              <button onClick={() => setMore(false)} className="text-[var(--faint)]" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MORE.map((n) => {
                const Icon = n.icon;
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[13px] text-[var(--text-2)]"
                  >
                    <Icon size={15} />
                    {t(`nav.${n.key}`)}
                  </NavLink>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--text-2)]"
              >
                {theme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
                {theme === "dark" ? "浅色" : "深色"}
              </button>
              <button
                onClick={() => setLang(i18n.language === "zh" ? "en" : "zh")}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--text-2)]"
              >
                <Languages size={12} />
                {i18n.language === "zh" ? "EN" : "中文"}
              </button>
              <button
                onClick={toggleColorblind}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)]"
                aria-label="Colorblind"
              >
                <Palette size={15} className={colorblind ? "text-[var(--accent)]" : ""} />
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} />
    </div>
  );
}
