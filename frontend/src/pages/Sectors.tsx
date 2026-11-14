import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type SectorDay } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, pct, ratio, trendClass } from "../lib/format";
import { sectorBubble } from "../lib/charts";
import { treemapChart } from "../lib/charts2";
import { monthlyPathChart, rotationBump, rotationPulse } from "../lib/charts3";
import { downloadDataUrl } from "../lib/download";
import EChart, { type EChartHandle } from "../components/EChart";
import { Card } from "../components/Card";
import { MonthlyGrid } from "../components/MonthlyGrid";
import { DataState } from "../components/DataState";
import { cumulativePath, median } from "../lib/viewMetrics";
import { PageHead } from "../components/PageHead";

export default function Sectors() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const chartRef = useRef<EChartHandle>(null);
  const [params, setParams] = useSearchParams();
  const sel = params.get("sector");
  const setSel = (s: string | null) => {
    const next = new URLSearchParams(params);
    if (s) next.set("sector", s);
    else next.delete("sector");
    setParams(next, { replace: true });
  };

  const { data: meta, isError: metaError, isPending: metaPending } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const d = meta?.last_trade_date;

  const { data: sectors, isError: sectorError, isPending: sectorPending } = useQuery({
    queryKey: ["sectors", d],
    queryFn: () => api.sectors(d as string),
    enabled: !!d,
  });
  const { data: monthly } = useQuery({ queryKey: ["sector-monthly"], queryFn: () => api.sectorMonthly() });
  const { data: rotation } = useQuery({ queryKey: ["rotation"], queryFn: api.rotation });
  const { data: ranks } = useQuery({ queryKey: ["sector-ranks"], queryFn: api.sectorRanks });
  const { data: allStocks } = useQuery({
    queryKey: ["stocks-all", d],
    queryFn: () => api.stocks(d as string),
    enabled: !!d,
  });
  const { data: stocks } = useQuery({
    queryKey: ["stocks", d, sel],
    queryFn: () => api.stocks(d as string, sel || undefined),
    enabled: !!d,
  });

  const rows = sectors ?? [];
  const selected = sel ?? rows[0]?.sw_l1 ?? null;
  const selRow = rows.find((r) => r.sw_l1 === selected) as SectorDay | undefined;

  const [heatWindow, setHeatWindowState] = useState<12 | 24>(params.get("hm") === "24" ? 24 : 12);
  const [heatScope, setHeatScopeState] = useState<"focus" | "all">(params.get("hs") === "all" ? "all" : "focus");

  const setHeatWindow = (v: 12 | 24) => {
    setHeatWindowState(v);
    const next = new URLSearchParams(params);
    next.set("hm", String(v));
    setParams(next, { replace: true });
  };

  const setHeatScope = (fn: (s: "focus" | "all") => "focus" | "all") => {
    const v = fn(heatScope);
    setHeatScopeState(v);
    const next = new URLSearchParams(params);
    next.set("hs", v);
    setParams(next, { replace: true });
  };

  const heat = useMemo(() => {
    const all = [...new Set((monthly ?? []).map((m) => m.month))].sort();
    const winMonths = all.slice(-heatWindow);
    const winSet = new Set(winMonths);
    const rows = (monthly ?? []).filter((m) => winSet.has(m.month));
    const ret = new Map(rows.map((m) => [`${m.month}|${m.sw_l1}`, m.ew_ret_cum]));
    const scored = [...new Set(rows.map((m) => m.sw_l1))]
      .map((name) => {
        const monthlyReturns = winMonths.map((mo) => ret.get(`${mo}|${name}`) ?? null);
        const path = cumulativePath(monthlyReturns);
        return { name, score: path[path.length - 1] ?? null, values: monthlyReturns };
      })
      .filter((row): row is { name: string; score: number; values: (number | null)[] } => row.score != null)
      .sort((a, b) => b.score - a.score);
    const groups = heatScope === "all" ? [scored] : scored.length <= 12 ? [scored] : [scored.slice(0, 6), scored.slice(-6)];
    const shown = groups.flat();
    const barMax = Math.max(...shown.flatMap((s) => s.values.map((v) => Math.abs(v ?? 0))), 0.01);
    return { months: winMonths, rows: rows.length, groups, count: shown.length, barMax };
  }, [monthly, heatWindow, heatScope]);
  const heatMax = Math.max(...heat.groups.flat().map((s) => Math.abs(s.score)), 0.01);

  const board = useMemo(() => [...rows].sort((a, b) => b.breadth - a.breadth), [rows]);

  const rotStats = useMemo(() => {
    const list = [...(rotation ?? [])].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    if (!list.length) return null;
    const latest = list[list.length - 1];
    const last20 = list.slice(-20);
    const avg20 = last20.reduce((a, r) => a + r.rotation_intensity, 0) / Math.max(1, last20.length);
    const pctile = list.filter((r) => r.rotation_intensity <= latest.rotation_intensity).length / list.length;
    return { latest: latest.rotation_intensity, avg20, pctile, days: list.length };
  }, [rotation]);
  const quadCounts = useMemo(() => {
    const broad = rows.filter((r) => r.ew_ret > 0 && r.breadth >= 0.5).length;
    const narrow = rows.filter((r) => r.ew_ret > 0 && r.breadth < 0.5).length;
    const selloff = rows.filter((r) => r.ew_ret < 0 && r.breadth < 0.5).length;
    return { broad, narrow, selloff, mixed: rows.length - broad - narrow - selloff, over50: rows.filter((r) => r.breadth >= 0.5).length };
  }, [rows]);
  const selStocks = (stocks ?? []).filter((s) => s.sw_l1 === selected).sort((a, b) => b.ret - a.ret);
  const top = selStocks.slice(0, 6);
  const bottom = selStocks.slice(-6).reverse();

  if (!rows.length) return <DataState error={metaError || sectorError} loading={metaPending || (!!d && sectorPending && !sectorError)} />;

  const best = board[0];
  const worst = board[board.length - 1];
  const upCount = rows.filter((r) => r.ew_ret > 0).length;
  const med = median(rows.map((r) => r.ew_ret));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHead
        kicker={`${zh ? "行业参与" : "Sectors"} / ${d} · ${rows.length} ${zh ? "个申万一级" : "SW L1"}`}
        title={
          zh
            ? `${best.sw_l1} ${ratio(best.breadth, 0)} 的股票在涨，${worst.sw_l1} 只有 ${ratio(worst.breadth, 0)}`
            : `${best.sw_l1} ${ratio(best.breadth, 0)} advancing vs ${worst.sw_l1} ${ratio(worst.breadth, 0)}`
        }
        dek={
          zh
            ? `同一天，${rows.length} 个申万一级行业的上涨占比从 ${ratio(worst.breadth, 0)} 到 ${ratio(best.breadth, 0)}；可查看收益、成交额、行业内部结构与月度轨迹`
            : `On the same day, sector breadth ranges from ${ratio(worst.breadth, 0)} to ${ratio(best.breadth, 0)}; inspect returns, turnover, internal structure and monthly paths`
        }
        chips={
          <>
            <span className="pill">{zh ? "申万一级" : "SW L1"}</span>
            <span className="pill">{zh ? "等权" : "Equal-weight"}</span>
            <span className="pill">{zh ? "31 个行业" : "31 sectors"}</span>
          </>
        }
        right={
          <div className="flex items-center gap-4">
            {[
              { k: zh ? "上涨行业" : "Sectors up", v: `${upCount} / ${rows.length}` },
              { k: zh ? "最强广度" : "Broadest", v: `${best.sw_l1} ${ratio(best.breadth, 0)}` },
              { k: zh ? "最弱广度" : "Narrowest", v: `${worst.sw_l1} ${ratio(worst.breadth, 0)}` },
            ].map((s, i) => (
              <div key={s.k} className={i ? "border-l border-[var(--border)] pl-4" : ""}>
                <div className="micro">{s.k}</div>
                <div className="mono mt-1 text-[13px] text-[var(--text)]">{s.v}</div>
              </div>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-8">
          <Card
            index="01"
            title={zh ? "收益 × 广度" : "Return × breadth"}
            subtitle={zh ? "横轴 = 行业等权收益 · 纵轴 = 上涨占比 · 气泡 = 成交额 · 四象限：普涨 / 集中 / 普跌 / 分化" : "Bubble = turnover · quadrants at 0% / 50% · click to drill in"}
            right={
              <div className="flex items-center gap-2.5 text-[10.5px] text-[var(--faint)]">
                {[
                  { c: p.up, l: `${zh ? "普涨" : "Broad"} ${quadCounts.broad}` },
                  { c: p.copper, l: `${zh ? "集中" : "Narrow"} ${quadCounts.narrow}` },
                  { c: p.down, l: `${zh ? "普跌" : "Selloff"} ${quadCounts.selloff}` },
                  { c: p.muted, l: `${zh ? "分化" : "Mixed"} ${quadCounts.mixed}` },
                ].map((q) => (
                  <span key={q.l} className="flex items-center gap-1">
                    <i className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: q.c }} />
                    {q.l}
                  </span>
                ))}
                <button
                  onClick={() => downloadDataUrl(chartRef.current?.getDataURL(p.bg) ?? null, `ashare-radar_sectors_${d ?? ""}.png`)}
                  className="ml-1 h-[27px] rounded border border-[var(--border)] px-2 font-mono text-[11px] text-[var(--faint)] hover:text-[var(--text)]"
                >
                  PNG
                </button>
              </div>
            }
            prov={zh ? "横轴行业等权收益，纵轴行业内上涨占比，气泡面积按成交额" : "x = EW return, y = breadth, size = turnover"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>daily / sw_daily</b></span>
                <span>N <b>{rows.length}</b></span>
                <span>{zh ? "申万一级" : "SW L1"}</span>
                <a className="r hover:underline" href="#/about">{zh ? "口径说明 →" : "Method →"}</a>
              </div>
            }
          >
            <div className="h-[360px] px-1 pb-1 md:h-[420px] md:px-2">
              <EChart
                ref={chartRef}
                option={sectorBubble(p, rows, lang, selected)}
                onEvents={{
                  click: (params: unknown) => {
                    const name = (params as { data?: { name?: string } })?.data?.name;
                    if (name) setSel(name);
                  },
                }}
                ariaLabel={zh ? "行业收益与广度气泡图" : "Sector return vs breadth"}
              />
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card
            index="02"
            title={zh ? "行业广度榜" : "Breadth ranking"}
            subtitle={zh ? "行业内上涨股票占比 · 50% 是分水岭 · 点击下钻" : "Share of constituents advancing · 50% is the divide"}
            right={<span className="pill">{quadCounts.over50}/{rows.length} ≥50%</span>}
            prov={zh ? "广度 = 行业内上涨家数 /（上涨+下跌）；右列为当日等权收益" : "Breadth = advancers / (adv + dec); right column is EW return"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>sw_daily</b></span>
                <span>{zh ? "申万一级" : "SW L1"}</span>
                <span className="r">{zh ? "按广度排序" : "sorted by breadth"}</span>
              </div>
            }
          >
            <div className="flex max-h-[420px] flex-col overflow-y-auto px-2 pb-2">
              <div className="grid grid-cols-[20px_68px_1fr_38px_48px] items-center gap-2 px-2 pb-1 pt-1 text-[10.5px] uppercase tracking-wider text-[var(--faint)]">
                <span>#</span>
                <span>{zh ? "行业" : "Sector"}</span>
                <span className="text-center">0% · 50% · 100%</span>
                <span className="text-right">{zh ? "广度" : "Breadth"}</span>
                <span className="text-right">{zh ? "今日" : "Today"}</span>
              </div>
              {board.map((s, i) => (
                <button
                  key={s.sw_l1}
                  onClick={() => setSel(s.sw_l1)}
                  className={`grid grid-cols-[20px_68px_1fr_38px_48px] items-center gap-2 rounded px-2 py-[5px] text-left transition-colors ${
                    s.sw_l1 === selected ? "bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/20" : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className={`mono text-[10.5px] ${i < 3 ? "text-[var(--copper)]" : "text-[var(--faint)]"}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={`truncate text-[11.5px] ${s.sw_l1 === selected ? "text-[var(--text)]" : "text-[var(--text-2)]"}`}>
                    {s.sw_l1}
                  </span>
                  <div className="relative h-[5px] rounded-full bg-[var(--surface-2)]">
                    <span className="absolute left-1/2 top-[-2px] z-10 h-[9px] w-px bg-[var(--border-strong)]" />
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${s.breadth * 100}%`, background: s.breadth >= 0.5 ? p.accent : p.muted, opacity: 0.95 }}
                    />
                  </div>
                  <span className="mono text-right text-[11px] text-[var(--muted)]">{ratio(s.breadth, 0)}</span>
                  <span className={`mono text-right text-[11px] ${trendClass(s.ew_ret)}`}>{pct(s.ew_ret)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card
        index="03"
        title={zh ? "市场云图 · 成交额 × 今日涨跌" : "Market map · turnover × return"}
        subtitle={zh ? "面积 = 成交额 · 颜色 = 涨跌幅 · 分组 = 申万一级 · 成交额前 30 只 · 点击色块选行业" : "Area = turnover · colour = return · grouped by SW L1 · top 30 by turnover · click a tile to select"}
        right={<div className="flex items-center gap-1.5"><span className="micro">跌</span><span className="h-[6px] w-20 rounded-full" style={{ background: `linear-gradient(90deg, ${p.down}, #b9a67a, ${p.up})` }} /><span className="micro">涨</span></div>}
        prov={zh ? "面积 = 成交额；颜色按当日涨跌幅连续映射，低涨幅接近沙色，高涨幅深红，跌幅转绿" : "Area = turnover; colour maps continuously from green through sand to red"}
        padded={false}
        bodyClass="pt-0"
        footer={
          <div className="provline">
            <span>SOURCE <b>daily / daily_basic</b></span>
            <span>{zh ? "流通市值" : "float cap"}</span>
            <span>{zh ? "申万一级" : "SW L1"}</span>
            <span className="r">{zh ? "红涨绿跌" : "red up / green down"}</span>
          </div>
        }
      >
        <div className="h-[380px] px-2 pb-2 md:px-3">
          {allStocks?.length ? (
            <EChart
              option={treemapChart(p, allStocks, lang)}
              onEvents={{
                click: (params: unknown) => {
                  const sector = (params as { data?: { sector?: string } })?.data?.sector;
                  if (sector) setSel(sector);
                },
              }}
              ariaLabel={zh ? "市场热力图" : "Market treemap"}
            />
          ) : (
            <DataState />
          )}
        </div>
      </Card>

      <Card
        index="04"
        title={zh ? "行业月度收益 · 轨迹" : "Monthly return paths"}
        subtitle={
          zh
            ? `近 ${heatWindow} 个月 · ${heatScope === "focus" ? "领涨 / 落后各 6 · 小倍数 · 同一纵轴 · 点击卡片选中" : "31 个申万一级行业 · 12M 累计收益排序"}`
            : `Last ${heatWindow} months · ${heatScope === "focus" ? "top / bottom 6 · cumulative paths · click a line" : "all 31 SW L1 · ranked by 12M cumulative return"}`
        }
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-md border border-[var(--border)] bg-[var(--surface)] p-0.5">
              {([12, 24] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setHeatWindow(v)}
                  className={`rounded px-2 py-[3px] font-mono text-[10.5px] transition-colors ${
                    heatWindow === v ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {v}M
                </button>
              ))}
            </div>
            <button
              onClick={() => setHeatScope((s) => (s === "focus" ? "all" : "focus"))}
              className="rounded-md border border-[var(--border)] px-2 py-[4px] text-[11px] text-[var(--muted)] transition-colors hover:text-[var(--text)]"
            >
              {heatScope === "focus" ? (zh ? "重点 12" : "Focus 12") : zh ? "全部 31" : "All 31"}
            </button>
          </div>
        }
        prov={
          zh
            ? heatScope === "focus"
              ? "每条线 = 该行业区间累计收益（月初归一为 0）；点击线选中行业"
              : "横条 = 区间累计收益；按 12M 累计收益排序"
            : "Each line = compounded monthly return; click a line to select"
        }
        padded={false}
        bodyClass="pt-0"
        footer={
          <div className="provline">
            <span>SOURCE <b>sw_daily</b></span>
            <span>{zh ? "申万一级" : "SW L1"}</span>
            <span>{heat.count} {zh ? "个行业" : "sectors"} · {heat.months.length} {zh ? "个月" : "months"} · {heat.months[0]?.slice(0, 7)} → {heat.months[heat.months.length - 1]?.slice(0, 7)}</span>
            <span className="r">{heatScope === "focus" ? (zh ? "累计复利" : "compounded") : zh ? `${heatWindow}M 累计` : `${heatWindow}M cumulative`}</span>
          </div>
        }
      >
        <div className="px-3 pb-3">
          {!heat.rows ? (
            <DataState />
          ) : heatScope === "all" ? (
            <div className="space-y-0.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="micro">{zh ? `${heatWindow}M 累计收益排序` : `${heatWindow}M cumulative ranking`}</span>
                <span className="micro text-[var(--faint)]">{zh ? "点击行下钻" : "click to drill"}</span>
              </div>
              {heat.groups[0].map((s) => {
                const w = (Math.abs(s.score) / heatMax) * 50;
                return (
                  <button
                    key={s.name}
                    onClick={() => setSel(s.name)}
                    className={`grid w-full grid-cols-[68px_1fr_58px] items-center gap-2 rounded px-1 py-[4px] text-left transition-colors ${
                      s.name === selected ? "bg-[var(--accent)]/10" : "hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    <span className={`truncate text-[11px] ${s.name === selected ? "text-[var(--text)]" : "text-[var(--text-2)]"}`}>{s.name}</span>
                    <span className="relative h-[7px] rounded-full bg-[var(--surface-2)]">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
                      <span
                        className="absolute inset-y-0 rounded-full"
                        style={{
                          width: `${w}%`,
                          left: s.score >= 0 ? "50%" : `${50 - w}%`,
                          background: s.score >= 0 ? p.up : p.down,
                          opacity: 0.82,
                        }}
                      />
                    </span>
                    <span className={`mono text-right text-[11px] ${trendClass(s.score)}`}>{pct(s.score)}</span>
                  </button>
                );
              })}
            </div>
          ) : heat.groups.length > 1 ? (
            <MonthlyGrid groups={heat.groups} months={heat.months} p={p} lang={lang} onSelect={setSel} />
          ) : (
            <div className="h-[260px]">
              <EChart
                option={monthlyPathChart(p, heat.months, heat.groups[0], lang)}
                onEvents={{
                  click: (params) => {
                    const name = (params as { seriesName?: string }).seriesName;
                    if (name) setSel(name);
                  },
                }}
                ariaLabel={zh ? "行业累计收益曲线" : "Sector cumulative return paths"}
              />
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-7">
          <Card
            index="05"
            title={zh ? "排名迁移 · 20 日收益" : "Rank migration"}
            subtitle={zh ? "20 日收益排名 · 26 周 · 每周采样 · 越靠上越强" : "20-day return rank · 26 weeks · weekly sample · higher is stronger"}
            right={<span className="pill">26W</span>}
            prov={zh ? "选取平均排名前3、区间波动最大2，并纳入当前选中行业；排名1=最强" : "Top 3 by average rank, top 2 movers, with the selected sector included; rank 1 = strongest"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>sw_daily · rank20</b></span>
                <span>{zh ? "每周采样" : "weekly"}</span>
                <a className="r hover:underline" href="#/stocks">{zh ? "查看全部个股 →" : "View all stocks →"}</a>
              </div>
            }
          >
            <div className="h-[390px] px-2 pb-2">
              {(ranks?.length ?? 0) > 0 ? (
                <EChart
                  option={rotationBump(p, ranks!, lang, selected)}
                  onEvents={{
                    click: (params: unknown) => {
                      const name = (params as { seriesName?: string })?.seriesName;
                      if (name) setSel(name);
                    },
                  }}
                  ariaLabel={zh ? "行业排名迁移" : "Sector rank migration"}
                />
              ) : (
                <DataState />
              )}
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-5">
          <Card
            index="06"
            title={zh ? "轮动强度" : "Rotation pulse"}
            subtitle={zh ? "月度平均排名变化 · 越高轮动越快" : "Monthly mean rank change · higher = faster rotation"}
            right={<span className="pill">3Y</span>}
            prov={zh ? "每日计算行业 20 日收益排名的平均绝对变化，再按月平均" : "Daily mean absolute rank change, averaged by month"}
            padded={false}
            bodyClass="pt-0"
            footer={
              <div className="provline">
                <span>SOURCE <b>sw_daily · rank20</b></span>
                <span>{rotStats ? `${rotStats.days} ${zh ? "个交易日" : "sessions"}` : "—"}</span>
                <span className="r">{zh ? "月度平均" : "monthly avg"}</span>
              </div>
            }
          >
            {rotStats ? (
              <>
                <div className="grid grid-cols-3 gap-2 px-4 pb-1 pt-3">
                  {[
                    { k: zh ? "最新日" : "Latest", v: rotStats.latest.toFixed(2), tone: "text-[var(--copper)]" },
                    { k: zh ? "20 日均值" : "20D avg", v: rotStats.avg20.toFixed(2), tone: "text-[var(--text)]" },
                    { k: zh ? "3Y 分位" : "3Y pct", v: ratio(rotStats.pctile, 0), tone: "text-[var(--text)]" },
                  ].map((s) => (
                    <div key={s.k}>
                      <div className="micro">{s.k}</div>
                      <div className={`mono mt-1.5 text-[21px] leading-none tracking-[-0.03em] ${s.tone}`}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div className="h-[245px] px-2 pb-1">
                  <EChart option={rotationPulse(p, rotation!, lang)} ariaLabel={zh ? "轮动强度" : "Rotation pulse"} />
                </div>
                <div className="px-4 pb-3 text-[11px] leading-relaxed text-[var(--faint)]">
                  {zh ? "柱越高，行业排名换得越快；最近月份柱为铜色，虚线为 12 个月均值" : "Taller bars mean faster rank changes; latest month bar is copper, dashed = 12-month mean"}
                </div>
              </>
            ) : (
              <DataState />
            )}
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-4">
          <Card
            index="07"
            title={selected ? `${selected} · ${zh ? "内部结构" : "inside"}` : zh ? "行业内结构" : "Inside"}
            subtitle={
              selRow
                ? `${selRow.n} ${zh ? "只" : "stocks"} · ${zh ? "广度" : "breadth"} ${ratio(selRow.breadth, 0)} · IQR ${(selRow.iqr * 100).toFixed(1)}pp`
                : ""
            }
            prov={zh ? "q10–q90 为行业内收益分布，竖线为中位数" : "q10–q90 distribution, line = median"}
          >
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { k: zh ? "等权收益" : "Equal-weight", v: pct(selRow?.ew_ret ?? null), tone: trendClass(selRow?.ew_ret) },
                { k: zh ? "行业流通市值加权" : "Sector float-cap weight", v: pct(selRow?.cw_ret ?? null), tone: trendClass(selRow?.cw_ret) },
                { k: zh ? "成交额" : "Turnover", v: money(selRow?.amount ?? null) },
                { k: zh ? "涨停家数" : "Limit-ups", v: `${selRow?.limit_up_n ?? "—"}` },
              ].map((s) => (
                <div key={s.k}>
                  <div className="micro">{s.k}</div>
                  <div className={`mono mt-1 text-[14px] ${s.tone || "text-[var(--text)]"}`}>{s.v}</div>
                </div>
              ))}
            </div>

            {selRow ? (
              <div className="mt-3">
                <div className="flex items-center justify-between font-mono text-[10.5px] text-[var(--faint)]">
                  <span>q10 {pct(selRow.q10 ?? null)}</span>
                  <span>{zh ? "行业内分布" : "inside distribution"}</span>
                  <span>q90 {pct(selRow.q90 ?? null)}</span>
                </div>
                <div className="relative mt-1.5 h-[6px] rounded-full bg-[var(--surface-2)]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[var(--accent)]/25"
                    style={{ left: `${Math.max(0, Math.min(100, (((selRow.q10 ?? 0) * 100 + 11) / 22) * 100))}%`, width: `${Math.max(2, Math.min(100, (((selRow.q90 ?? 0) - (selRow.q10 ?? 0)) * 100 / 22) * 100))}%` }}
                  />
                  <div
                    className="absolute inset-y-0 rounded-full bg-[var(--accent)]/60"
                    style={{ left: `${Math.max(0, Math.min(100, (((selRow.q25 ?? 0) * 100 + 11) / 22) * 100))}%`, width: `${Math.max(1, Math.min(100, (((selRow.q75 ?? 0) - (selRow.q25 ?? 0)) * 100 / 22) * 100))}%` }}
                  />
                  <div className="absolute -top-[2px] h-[10px] w-[2px] rounded bg-[var(--text)]" style={{ left: `${Math.max(0, Math.min(99, (((selRow.med_ret ?? 0) * 100 + 11) / 22) * 100))}%` }} />
                </div>
              </div>
            ) : null}

            {selRow ? (
              <div className="mono mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
                {zh ? "等权 − 流通市值加权" : "EW − float-cap"} {((selRow.ew_ret - selRow.cw_ret) * 100).toFixed(2)}pp · IQR {(selRow.iqr * 100).toFixed(2)}pp
              </div>
            ) : null}
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card index="08" title={zh ? "行业内领涨" : "Leaders"} padded={false} bodyClass="pt-0">
            <div className="flex flex-col px-3 pb-2">
              {top.map((s) => (
                <div key={s.ts_code} className="grid grid-cols-[1fr_70px_48px] items-center gap-2 border-b border-[var(--border)] px-1 py-[7px] last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[11.5px] text-[var(--text)]">{s.name}</div>
                    <div className="mono text-[10.5px] text-[var(--faint)]">{s.ts_code}</div>
                  </div>
                  <div className="mono text-right text-[10.5px] text-[var(--muted)]">{money(s.amount)}</div>
                  <div className={`mono text-right text-[11px] ${trendClass(s.ret)}`}>{pct(s.ret)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card index="09" title={zh ? "行业内领跌" : "Laggards"} padded={false} bodyClass="pt-0">
            <div className="flex flex-col px-3 pb-2">
              {bottom.map((s) => (
                <div key={s.ts_code} className="grid grid-cols-[1fr_70px_48px] items-center gap-2 border-b border-[var(--border)] px-1 py-[7px] last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[11.5px] text-[var(--text)]">{s.name}</div>
                    <div className="mono text-[10.5px] text-[var(--faint)]">{s.ts_code}</div>
                  </div>
                  <div className="mono text-right text-[10.5px] text-[var(--muted)]">{money(s.amount)}</div>
                  <div className={`mono text-right text-[11px] ${trendClass(s.ret)}`}>{pct(s.ret)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
