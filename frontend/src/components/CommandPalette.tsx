import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useUI } from "../store/ui";
import { api, type StockRow } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Item {
  group: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t, i18n } = useTranslation();
  const { theme, colorblind, toggleTheme, toggleColorblind, setLang } = useUI();
  const zh = i18n.language === "zh";
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const { data: stocks } = useQuery({
    queryKey: ["cmdk-stocks", meta?.last_trade_date],
    queryFn: () => api.stocks(meta!.last_trade_date, undefined, 6000),
    enabled: open && !!meta?.last_trade_date && q.trim().length > 0,
    staleTime: 5 * 60_000,
  });

  const go = (to: string) => () => { navigate(to); onClose(); };

  const items: Item[] = useMemo(
    () => [
      { group: zh ? "跳转" : "Go to", label: t("nav.today"), hint: "G T", keywords: "today 今日 概览", run: go("/") },
      { group: zh ? "跳转" : "Go to", label: t("nav.market"), hint: "G M", keywords: "market 市场 结构", run: go("/market") },
      { group: zh ? "跳转" : "Go to", label: t("nav.regime"), hint: "G R", keywords: "regime 状态 地图", run: go("/regime") },
      { group: zh ? "跳转" : "Go to", label: t("nav.sectors"), hint: "G S", keywords: "sectors 行业", run: go("/sectors") },
      { group: zh ? "跳转" : "Go to", label: t("nav.stocks"), hint: "G K", keywords: "stocks 个股", run: go("/stocks") },
      { group: zh ? "跳转" : "Go to", label: t("nav.sentiment"), hint: "G E", keywords: "sentiment 情绪 涨停", run: go("/sentiment") },
      { group: zh ? "跳转" : "Go to", label: t("nav.watchlist"), hint: "G W", keywords: "watchlist 自选 组合", run: go("/watchlist") },
      { group: zh ? "跳转" : "Go to", label: t("nav.about"), hint: "G A", keywords: "about method 方法 数据", run: go("/about") },
      {
        group: zh ? "视图" : "View",
        label: zh ? (theme === "dark" ? "切换到浅色主题" : "切换到深色主题") : theme === "dark" ? "Switch to light" : "Switch to dark",
        hint: "⌘ L",
        keywords: "theme light dark 主题 浅色 深色",
        run: () => { toggleTheme(); onClose(); },
      },
      {
        group: zh ? "视图" : "View",
        label: zh ? (i18n.language === "zh" ? "切换到 English" : "切换到中文") : i18n.language === "zh" ? "Switch to English" : "切换到中文",
        hint: "⌘ I",
        keywords: "language 语言 中文 english",
        run: () => { setLang(i18n.language === "zh" ? "en" : "zh"); onClose(); },
      },
      {
        group: zh ? "视图" : "View",
        label: colorblind ? (zh ? "关闭色盲友好配色" : "Disable colorblind palette") : zh ? "开启色盲友好配色" : "Enable colorblind palette",
        hint: "⌘ B",
        keywords: "colorblind 色盲 配色",
        run: () => { toggleColorblind(); onClose(); },
      },
      {
        group: zh ? "数据" : "Data",
        label: zh ? "打开每日简报（打印视图）" : "Open daily briefing (print)",
        hint: "↵",
        keywords: "briefing 简报 pdf 打印",
        run: () => { window.open("#/briefing", "_blank"); onClose(); },
      },
      {
        group: zh ? "数据" : "Data",
        label: zh ? "刷新全部数据" : "Refresh all data",
        hint: "⌘ R",
        keywords: "refresh 刷新 更新",
        run: () => { qc.invalidateQueries(); onClose(); },
      },
    ],
    [zh, t, theme, i18n.language, colorblind, navigate, toggleTheme, toggleColorblind, setLang, onClose, qc],
  );

  const searchKey = q.trim().toLowerCase();

  const stockResults = useMemo<Item[]>(() => {
    if (!searchKey || !stocks?.length) return [];
    const rank = (s: StockRow) => {
      const code = s.ts_code.toLowerCase();
      const name = s.name.toLowerCase();
      if (code === searchKey || name === searchKey) return 0;
      if (code.startsWith(searchKey) || name.startsWith(searchKey)) return 1;
      return 2;
    };
    return stocks
      .filter((s) => `${s.name} ${s.ts_code} ${s.sw_l1}`.toLowerCase().includes(searchKey))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 10)
      .map((s) => ({
        group: zh ? "个股" : "Stocks",
        label: s.name,
        hint: s.ts_code,
        keywords: `${s.name} ${s.ts_code} ${s.sw_l1}`,
        run: () => {
          navigate(`/stocks?stock=${encodeURIComponent(s.ts_code)}`);
          onClose();
        },
      }));
  }, [searchKey, stocks, zh, navigate, onClose]);

  const sectorResults = useMemo<Item[]>(() => {
    if (!searchKey || !stocks?.length) return [];
    const names = [...new Set(stocks.map((s) => s.sw_l1).filter(Boolean))];
    return names
      .filter((name) => name.toLowerCase().includes(searchKey))
      .slice(0, 5)
      .map((name) => ({
        group: zh ? "行业" : "Sectors",
        label: name,
        hint: zh ? "行业" : "sector",
        keywords: name,
        run: () => {
          navigate(`/sectors?sector=${encodeURIComponent(name)}`);
          onClose();
        },
      }));
  }, [searchKey, stocks, zh, navigate, onClose]);

  const filtered = useMemo(() => {
    if (!searchKey) return items;
    const commands = items.filter((i) => `${i.label} ${i.keywords}`.toLowerCase().includes(searchKey));
    return [...stockResults, ...sectorResults, ...commands];
  }, [items, searchKey, stockResults, sectorResults]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setIdx((v) => Math.min(v, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((v) => Math.min(v + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setIdx((v) => Math.max(v - 1, 0)); }
      if (e.key === "Enter" && filtered[idx]) { e.preventDefault(); filtered[idx].run(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, idx, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [idx, open]);

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="cmdk-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk-panel" role="dialog" aria-modal="true" aria-label={zh ? "命令面板" : "Command palette"}>
        <div className="cmdk-input">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            placeholder={zh ? "搜索股票代码、名称、行业或页面" : "Search stock code, name, sector or page"}
            aria-label={zh ? "命令搜索" : "Command search"}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">{zh ? "没有匹配的命令" : "No matching commands"}</div>}
          {filtered.map((item, i) => {
            const head = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.label + i}>
                {head && <div className="cmdk-group">{item.group}</div>}
                <div
                  className="cmdk-item"
                  data-i={i}
                  data-on={i === idx}
                  onMouseEnter={() => setIdx(i)}
                  onClick={item.run}
                  role="button"
                  tabIndex={-1}
                >
                  <span>{item.label}</span>
                  <span>{item.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
