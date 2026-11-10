import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Star, X } from "lucide-react";
import { api, type StockRow } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor, axisStyle, baseChart } from "../lib/theme";
import { money, num, pct, ratio, shortDate, trendClass } from "../lib/format";
import { downloadCsv } from "../lib/download";
import EChart from "../components/EChart";
import { Card, MicroLabel } from "../components/Card";

type SortKey = "ret" | "circ_mv" | "turnover_rate" | "amount";

type Bar = { trade_date: string; open: number; high: number; low: number; close: number; vol: number };

function klineOption(p: (typeof palettes)["dark"], bars: Bar[]) {
  const dates = bars.map((b) => shortDate(b.trade_date));
  const ohlc = bars.map((b) => [b.open, b.close, b.low, b.high]);
  const vols = bars.map((b) => ({
    value: b.vol,
    itemStyle: { color: b.close >= b.open ? p.up : p.down, opacity: 0.55 },
  }));
  return {
    ...baseChart(p),
    grid: [
      { left: 4, right: 6, top: 6, height: "60%", containLabel: true },
      { left: 4, right: 6, top: "72%", height: "16%", containLabel: true },
    ],
    tooltip: { ...baseChart(p).tooltip, trigger: "axis", axisPointer: { type: "cross" } },
    xAxis: [
      {
        type: "category",
        data: dates,
        gridIndex: 0,
        ...axisStyle(p),
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: "category",
        data: dates,
        gridIndex: 1,
        ...axisStyle(p),
        splitLine: { show: false },
        axisLabel: { ...axisStyle(p).axisLabel, fontSize: 8, interval: Math.max(0, Math.floor(dates.length / 4)) },
      },
    ],
    yAxis: [
      { scale: true, gridIndex: 0, ...axisStyle(p), axisLabel: { ...axisStyle(p).axisLabel, fontSize: 9 } },
      { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
    ],
    series: [
      {
        type: "candlestick",
        data: ohlc,
        itemStyle: { color: p.up, color0: p.down, borderColor: p.up, borderColor0: p.down },
      },
      { type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: "62%" },
    ],
    dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: 55, end: 100 }],
  } as never;
}

export default function Stocks() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const qc = useQueryClient();

  const [sector, setSector] = useState<string>("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ret");
  const [sel, setSel] = useState<StockRow | null>(null);

  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const d = meta?.last_trade_date;
  const { data: sectors } = useQuery({
    queryKey: ["sectors", d],
    queryFn: () => api.sectors(d as string),
    enabled: !!d,
  });
  const { data: stocks } = useQuery({
    queryKey: ["stocks", d, sector],
    queryFn: () => api.stocks(d as string, sector || undefined),
    enabled: !!d,
  });

  const { data: series } = useQuery({
    queryKey: ["stock-series", sel?.ts_code],
    queryFn: () => api.stockSeries(sel!.ts_code),
    enabled: !!sel,
  });

  const all = stocks ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? all.filter((s) => s.name?.toLowerCase().includes(q) || s.ts_code.toLowerCase().includes(q))
      : all;
    return [...list].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [all, query, sortKey]);

  const topSectors = useMemo(
    () => (sectors ?? []).slice().sort((a, b) => b.n - a.n).slice(0, 9),
    [sectors],
  );

  const scatterOption = useMemo(() => {
    const pts = filtered.slice(0, 3000).map((s) => ({
      name: s.name,
      value: [
        Math.log10(Math.max((s.circ_mv || 1) / 1e4, 0.5)),
        +(s.ret * 100).toFixed(2),
        s.amount || 0,
        s.turnover_rate || 0,
      ],
      itemStyle: {
        color: s.ret >= 0 ? p.up : p.down,
        opacity: s.is_limit_up || s.is_limit_down ? 1 : 0.55,
        borderColor: s.is_limit_up || s.is_limit_down ? p.text : "transparent",
        borderWidth: s.is_limit_up || s.is_limit_down ? 1 : 0,
      },
      raw: s,
    }));
    const maxAmt = Math.max(...pts.map((x) => x.value[2]), 1);
    const ys = pts.map((x) => x.value[1]);
    const ymax = 21;
    return {
      ...baseChart(p),
      grid: { left: 8, right: 14, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        ...baseChart(p).tooltip,
        formatter: (params: unknown) => {
          const q = params as { data: { raw: StockRow } };
          const s = q.data.raw;
          return `<div style="min-width:168px">
            <div style="font-weight:600">${s.name} <span style="color:${p.muted};font-family:monospace;font-size:10px">${s.ts_code}</span></div>
            <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Return" : "收益"}</span><b style="color:${s.ret >= 0 ? p.up : p.down}">${(s.ret * 100).toFixed(2)}%</b></div>
            <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Float cap" : "流通市值"}</span><b>${(s.circ_mv / 1e4).toFixed(0)}亿</b></div>
            <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Turnover" : "换手率"}</span><b>${(s.turnover_rate || 0).toFixed(2)}%</b></div>
            <div style="display:flex;justify-content:space-between;gap:16px"><span>${lang === "en" ? "Amount" : "成交额"}</span><b>${money(s.amount)}</b></div>
          </div>`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: 4,
        ...axisStyle(p),
        axisLabel: {
          ...axisStyle(p).axisLabel,
          formatter: (v: number) => `${Math.round(Math.pow(10, v))}亿`,
          fontSize: 9,
          showMaxLabel: false,
        },
      },
      yAxis: {
        type: "value",
        min: -ymax,
        max: ymax,
        ...axisStyle(p),
        axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 10 },
      },
      series: [
        {
          type: "scatter",
          data: pts,
          symbolSize: (val: number[]) => 3 + Math.sqrt((val[2] || 0) / maxAmt) * 16,
          emphasis: { scale: 1.4, itemStyle: { borderColor: p.text, borderWidth: 1, opacity: 1 } },
        },
        {
          type: "line",
          data: [],
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: p.axis, type: "dashed", width: 1 },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
        },
      ],
    } as never;
  }, [filtered, p]);

  const histOption = useMemo(() => {
    const vals = filtered.map((s) => s.ret * 100);
    const N = 30;
    const lo = -11;
    const hi = 11;
    const step = (hi - lo) / N;
    const counts = new Array(N).fill(0) as number[];
    vals.forEach((v) => {
      const i = Math.min(N - 1, Math.max(0, Math.floor((v - lo) / step)));
      counts[i] += 1;
    });
    const centers = Array.from({ length: N }, (_, i) => lo + (i + 0.5) * step);
    return {
      ...baseChart(p),
      grid: { left: 4, right: 8, top: 10, bottom: 20, containLabel: true },
      xAxis: {
        type: "value",
        min: -11,
        max: 11,
        splitNumber: 4,
        ...axisStyle(p),
        splitLine: { show: false },
        axisLabel: { ...axisStyle(p).axisLabel, formatter: "{value}%", fontSize: 9, showMinLabel: false, showMaxLabel: false },
      },
      yAxis: { type: "value", ...axisStyle(p), axisLabel: { show: false }, splitLine: { show: false } },
      series: [
        {
          type: "bar",
          data: counts.map((n, i) => ({
            value: [centers[i], n],
            itemStyle: { color: centers[i] >= 0 ? p.up : p.down, opacity: 0.8, borderRadius: 1 },
          })),
          barWidth: 6,
        },
      ],
    } as never;
  }, [filtered, p]);

  const up = filtered.filter((s) => s.ret > 0).length;
  const flat = filtered.filter((s) => s.ret === 0).length;

  if (!d) return <div className="skeleton h-[600px] w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">{t("stocks.title")}</h1>
          <p className="mt-1 text-[12px] text-[var(--muted)]">{t("stocks.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("common.search")}
              className="h-[28px] w-[200px] rounded-lg border border-[var(--border)] bg-[var(--panel-2)] pl-8 pr-3 text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--border-strong)]"
            />
          </div>
          <span className="pill h-[28px]">
            <span className="mono">{filtered.length}</span>
            <span className="text-[10px]">{lang === "en" ? "stocks" : "只"}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setSector("")}
          className={`rounded-full border px-3 py-[5px] text-[11px] transition-colors ${
            sector === "" ? "border-transparent bg-[var(--accent)] text-white" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          {t("common.all")}
        </button>
        {topSectors.map((s) => (
          <button
            key={s.sw_l1}
            onClick={() => setSector(s.sw_l1 === sector ? "" : s.sw_l1)}
            className={`rounded-full border px-3 py-[5px] text-[11px] transition-colors ${
              sector === s.sw_l1
                ? "border-transparent bg-[var(--accent)] text-white"
                : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {s.sw_l1}
            <span className="ml-1.5 text-[9.5px] opacity-60">{s.n}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-8">
          <Card
            title={`${lang === "en" ? "Size × return" : "市值 × 收益"} · ${d}`}
            subtitle={
              lang === "en"
                ? "x = float cap (log) · y = daily return · outlined dots are limit moves"
                : "横轴 = 流通市值（对数）· 纵轴 = 当日收益 · 描边为涨跌停"
            }
            right={
              <span className="pill h-[22px] px-2 text-[10px]">
                {lang === "en" ? "click a dot for detail" : "点击查看详情"}
              </span>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[420px] px-2 pb-2">
              <EChart
                option={scatterOption}
                onEvents={{
                  click: (params: unknown) => {
                    const raw = (params as { data?: { raw?: StockRow } })?.data?.raw;
                    if (raw) setSel(raw);
                  },
                }}
              />
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          {sel ? (
            <Card
              title={
                <span className="flex items-center gap-2">
                  {sel.name}
                  <span className="mono text-[10px] font-normal text-[var(--faint)]">{sel.ts_code}</span>
                </span>
              }
              subtitle={`${sel.sw_l1} · ${sel.market}`}
              right={
                <button
                  onClick={() => setSel(null)}
                  className="flex h-[24px] w-[24px] items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
                >
                  <X size={12} />
                </button>
              }
            >
              {series && series.length > 1 ? (
                <div className="mb-3 h-[210px]">
                  <EChart option={klineOption(p, series)} />
                </div>
              ) : (
                <div className="mb-3 rounded-md border border-dashed border-[var(--border)] px-2 py-3 text-center text-[10px] text-[var(--faint)]">
                  {lang === "en"
                    ? "K-line history is available for top-60 / sample stocks in static mode; full history needs the Flask API."
                    : "静态模式下仅 Top60 / 示例股带 K 线；完整历史需本地 Flask 服务。"}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { k: lang === "en" ? "Return" : "当日收益", v: pct(sel.ret), tone: trendClass(sel.ret) },
                  { k: lang === "en" ? "Float cap" : "流通市值", v: `${(sel.circ_mv / 1e4).toFixed(0)}亿` },
                  { k: lang === "en" ? "Turnover" : "换手率", v: `${(sel.turnover_rate || 0).toFixed(2)}%` },
                  { k: lang === "en" ? "Amount" : "成交额", v: money(sel.amount) },
                  { k: "PE(TTM)", v: sel.pe_ttm ? sel.pe_ttm.toFixed(1) : "—" },
                  { k: "PB", v: sel.pb ? sel.pb.toFixed(2) : "—" },
                ].map((x) => (
                  <div key={x.k} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
                    <MicroLabel>{x.k}</MicroLabel>
                    <div className={`mono mt-1 text-[14px] font-medium ${x.tone || ""}`}>{x.v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={async () => {
                    await api.addWatch(sel.ts_code);
                    qc.invalidateQueries({ queryKey: ["watchlist"] });
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] py-2 text-[11.5px] text-[var(--text-2)] transition-colors hover:text-[var(--text)]"
                >
                  <Star size={13} />
                  {lang === "en" ? "Add to watchlist" : "加入自选"}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10.5px] text-[var(--faint)]">
                <span>
                  {sel.is_limit_up ? (lang === "en" ? "limit-up" : "涨停") : sel.is_limit_down ? (lang === "en" ? "limit-down" : "跌停") : "—"}
                </span>
                <span className="mono">{sel.trade_date}</span>
              </div>
            </Card>
          ) : (
            <Card
              title={t("stocks.distribution")}
              subtitle={lang === "en" ? "Cross-section of the filtered universe" : "当前筛选范围的收益分布"}
              right={
                <span className="pill h-[22px] px-2 text-[10px]">
                  ↑ {ratio(up / Math.max(1, filtered.length), 0)}
                </span>
              }
              padded={false}
              bodyClass="pt-0"
            >
              <div className="h-[240px] px-2 pb-1">
                <EChart option={histOption} />
              </div>
              <div className="grid grid-cols-3 gap-2 px-4 pb-3">
                {[
                  { k: lang === "en" ? "Advancers" : "上涨", v: `${up}` },
                  { k: lang === "en" ? "Flat" : "平盘", v: `${flat}` },
                  { k: lang === "en" ? "Decliners" : "下跌", v: `${filtered.length - up - flat}` },
                ].map((x) => (
                  <div key={x.k} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2">
                    <MicroLabel>{x.k}</MicroLabel>
                    <div className="mono mt-1 text-[14px] text-[var(--text)]">{x.v}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card
        title={lang === "en" ? "Constituents" : "个股明细"}
        subtitle={
          lang === "en" ? "Top 200 after sorting · click a row for detail" : "排序后展示前 200 只 · 点击查看详情"
        }
        right={
          <div className="flex items-center gap-1">
            {(
              [
                ["ret", lang === "en" ? "Return" : "收益"],
                ["circ_mv", lang === "en" ? "Cap" : "市值"],
                ["turnover_rate", lang === "en" ? "Turnover" : "换手"],
                ["amount", lang === "en" ? "Amount" : "成交额"],
              ] as [SortKey, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`rounded-md px-2 py-[3px] text-[10px] transition-colors ${
                  sortKey === k ? "bg-[var(--panel-3)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() =>
                downloadCsv(
                  [
                    ["ts_code", "name", "sector", "ret", "circ_mv", "turnover_rate", "amount", "pe_ttm", "pb"],
                    ...filtered.map((r) => [
                      r.ts_code,
                      r.name,
                      r.sw_l1,
                      r.ret,
                      r.circ_mv,
                      r.turnover_rate,
                      r.amount,
                      r.pe_ttm,
                      r.pb,
                    ]),
                  ],
                  `breadthlab_stocks_${d ?? ""}.csv`,
                )
              }
              className="ml-1 rounded-md border border-[var(--border)] px-1.5 py-[2px] text-[9.5px] text-[var(--muted)] hover:text-[var(--text)]"
              title={lang === "en" ? "Export filtered rows" : "导出当前筛选结果"}
            >
              CSV
            </button>
          </div>
        }
        padded={false}
        bodyClass="pt-0"
      >
        <div className="max-h-[420px] overflow-y-auto px-3 pb-2">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-[var(--panel)]">
              <tr className="text-left text-[9.5px] uppercase tracking-wider text-[var(--faint)]">
                <th className="py-2 pl-2 font-medium">{lang === "en" ? "Name" : "名称"}</th>
                <th className="font-medium">{lang === "en" ? "Sector" : "行业"}</th>
                <th className="text-right font-medium">{lang === "en" ? "Return" : "收益"}</th>
                <th className="text-right font-medium">{lang === "en" ? "Float cap" : "流通市值"}</th>
                <th className="text-right font-medium">{lang === "en" ? "Turnover" : "换手"}</th>
                <th className="text-right font-medium">{lang === "en" ? "Amount" : "成交额"}</th>
                <th className="pr-2 text-right font-medium">PE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((s) => (
                <tr
                  key={s.ts_code}
                  onClick={() => setSel(s)}
                  className="cursor-pointer border-t border-[var(--border)] transition-colors hover:bg-[var(--panel-2)]"
                >
                  <td className="py-[7px] pl-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11.5px] text-[var(--text)]">{s.name}</span>
                      <span className="mono text-[9px] text-[var(--faint)]">{s.ts_code}</span>
                    </div>
                  </td>
                  <td className="text-[10.5px] text-[var(--muted)]">{s.sw_l1}</td>
                  <td className={`mono text-right ${trendClass(s.ret)}`}>{pct(s.ret)}</td>
                  <td className="mono text-right text-[var(--text-2)]">{(s.circ_mv / 1e4).toFixed(0)}亿</td>
                  <td className="mono text-right text-[var(--text-2)]">{(s.turnover_rate || 0).toFixed(1)}%</td>
                  <td className="mono text-right text-[var(--text-2)]">{money(s.amount)}</td>
                  <td className="mono pr-2 text-right text-[var(--faint)]">{s.pe_ttm ? s.pe_ttm.toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between pb-2 text-[10.5px] text-[var(--faint)]">
        <span>{lang === "en" ? "Universe: SSE + SZSE main board / ChiNext / STAR" : "股票池：沪深主板 + 创业板 + 科创板"}</span>
        <span className="mono">
          {num(filtered.length)} {lang === "en" ? "rows" : "只"} · {d}
        </span>
      </div>
    </div>
  );
}
