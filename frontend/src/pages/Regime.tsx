import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type MarketDay } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, pct, ratio, shortDate, trendClass } from "../lib/format";
import { regimeScatter, regimeColor } from "../lib/charts2";
import { regimeLabel, regimeOf, type RegimeKey } from "../lib/regime";
import EChart from "../components/EChart";
import { Card, MicroLabel } from "../components/Card";
import { PageHead } from "../components/PageHead";
import { Segmented } from "../components/Segmented";

const RANGES = [
  { value: "1Y", label: "1Y", n: 250 },
  { value: "3Y", label: "3Y", n: 750 },
  { value: "ALL", label: "ALL", n: 99999 },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];

const KEYS: RegimeKey[] = ["broad_up", "concentrated_up", "mixed", "broad_down"];

function std(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
  return { m, v };
}

export default function Regime() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const zh = lang === "zh";
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const [params, setParams] = useSearchParams();
  const range = (params.get("range") as RangeKey) || "3Y";
  const setRange = (r: RangeKey) => {
    const p = new URLSearchParams(params);
    p.set("range", r);
    setParams(p, { replace: true });
  };
  const [sel, setSel] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["market-all"], queryFn: () => api.marketSeries() });
  const all = data ?? [];
  const rows = useMemo(() => all.slice(-(RANGES.find((r) => r.value === range)?.n ?? 750)), [all, range]);

  const selected = sel ?? rows[rows.length - 1]?.trade_date ?? null;
  const selRow = rows.find((r) => r.trade_date === selected);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    KEYS.forEach((k) => (c[k] = 0));
    rows.forEach((r) => (c[regimeOf(r)] += 1));
    return c;
  }, [rows]);

  const regimeStats = useMemo(() => {
    const runs: Record<string, number[]> = { broad_up: [], concentrated_up: [], mixed: [], broad_down: [] };
    let cur: string | null = null;
    let len = 0;
    rows.forEach((r) => {
      const k = regimeOf(r);
      if (k === cur) len++;
      else {
        if (cur) runs[cur].push(len);
        cur = k;
        len = 1;
      }
    });
    if (cur) runs[cur].push(len);
    const agg = new Map(KEYS.map((k) => [k, { n: 0, s5: 0, c5: 0, s20: 0, c20: 0 }]));
    rows.forEach((r, i) => {
      const a = agg.get(regimeOf(r))!;
      a.n++;
      const f5 = rows.slice(i + 1, i + 6);
      if (f5.length === 5) {
        a.s5 += f5.reduce((x, y) => x * (1 + y.ew_ret), 1) - 1;
        a.c5++;
      }
      const f20 = rows.slice(i + 1, i + 21);
      if (f20.length === 20) {
        a.s20 += f20.reduce((x, y) => x * (1 + y.ew_ret), 1) - 1;
        a.c20++;
      }
    });
    return KEYS.map((k) => {
      const ds = runs[k];
      const a = agg.get(k)!;
      return {
        k,
        avgDur: ds.length ? ds.reduce((x, y) => x + y, 0) / ds.length : 0,
        fwd5: a.c5 ? a.s5 / a.c5 : null,
        fwd20: a.c20 ? a.s20 / a.c20 : null,
      };
    });
  }, [rows]);

  const similar = useMemo(() => {
    if (!selRow || rows.length < 30) return [] as { r: MarketDay; d: number }[];
    const ew = std(rows.map((r) => r.ew_ret));
    const br = std(rows.map((r) => r.breadth));
    const cs = std(rows.map((r) => r.csd));
    const tp = std(rows.map((r) => r.top10_share || 0));
    const z = (v: number, s: { m: number; v: number }) => (v - s.m) / s.v;
    return rows
      .filter((r) => r.trade_date !== selRow.trade_date)
      .map((r) => {
        const d = Math.sqrt(
          (z(r.ew_ret, ew) - z(selRow.ew_ret, ew)) ** 2 +
            (z(r.breadth, br) - z(selRow.breadth, br)) ** 2 +
            (z(r.csd, cs) - z(selRow.csd, cs)) ** 2 +
            (z(r.top10_share || 0, tp) - z(selRow.top10_share || 0, tp)) ** 2,
        );
        return { r, d };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 7);
  }, [rows, selRow]);

  if (!rows.length) return <div className="skeleton h-[560px] w-full" />;

  const total = rows.length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        kicker={`${zh ? "市场状态" : "Market state"} / ${rows[0].trade_date} → ${rows[rows.length - 1].trade_date} · ${total}D`}
        title={zh ? "收益 × 广度：四种状态" : "Return × breadth: four states"}
        dek={
          zh
            ? "横轴是等权收益，纵轴是上涨股票占比；按 0% 和 50% 分成四个区间，点的大小是成交额，虚线是最近 30 个交易日的轨迹"
            : "x = equal-weight return, y = share of advancers; split at 0% and 50%, size = turnover, dashed line = last 30 sessions"
        }
        chips={
          <>
            <span className="pill">{zh ? "点选任意一天" : "Click any day"}</span>
            <span className="pill">{zh ? "大小 = 成交额" : "Size = turnover"}</span>
            <span className="pill">{zh ? "虚线 = 最近 30 日轨迹" : "Dashed = last 30 sessions"}</span>
          </>
        }
        right={<Segmented options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-9">
          <Card
            index="01"
            prov={zh ? "散点 = 交易日；横轴等权收益，纵轴上涨占比，大小按成交额" : "Each dot = a session; x = EW return, y = breadth, size = turnover"}
            title={t("regime.scatter")}
            subtitle={
              lang === "en"
                ? "Each dot is a trading day · size = turnover · dashed line = last 30 sessions"
                : "每个点是一个交易日 · 大小 = 成交额 · 虚线 = 最近 30 日轨迹"
            }
            right={
              selRow ? (
                <div className="flex items-center gap-2">
                  <span className="mono text-[12px] text-[var(--text-2)]">{selRow.trade_date}</span>
                  <span className="pill h-[24px] px-2 text-[11px]">{regimeLabel(regimeOf(selRow), lang)}</span>
                </div>
              ) : null
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[500px] px-1 pb-1 md:h-[520px]">
              <EChart
                option={regimeScatter(p, rows, selected, lang)}
                ariaLabel="收益与广度的状态散点图，含四象限与近 30 日轨迹"
                onEvents={{
                  click: (params: unknown) => {
                    const d = (params as { data?: { trade_date?: string } })?.data?.trade_date;
                    if (d) setSel(d);
                  },
                }}
              />
            </div>
          </Card>
        </div>

        <div className="col-span-12 flex flex-col gap-4 xl:col-span-3">
          <Card index="02" title={t("regime.stats")} subtitle={lang === "en" ? `${total} sessions in range` : `区间共 ${total} 个交易日`}>
            <div className="flex flex-col gap-3">
              {KEYS.map((k) => {
                const n = counts[k];
                const share = total ? n / total : 0;
                return (
                  <div key={k}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
                        <span className="h-[7px] w-[7px] rounded-full" style={{ background: regimeColor(k) }} />
                        {regimeLabel(k, lang)}
                      </span>
                      <span className="mono text-[12.5px] text-[var(--text)]">
                        {n}
                        <span className="ml-1 text-[11px] text-[var(--muted)]">{ratio(share, 0)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-[3px] w-full rounded-full bg-[var(--panel-3)]">
                      <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: regimeColor(k), opacity: 0.75 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <div className="grid grid-cols-[1fr_42px_50px_54px] text-[11px] uppercase tracking-wider text-[var(--faint)]">
                <span>{lang === "en" ? "Regime" : "状态"}</span>
                <span className="text-right">{lang === "en" ? "dur" : "持续"}</span>
                <span className="text-right">{lang === "en" ? "fwd5" : "后5日"}</span>
                <span className="text-right">{lang === "en" ? "fwd20" : "后20日"}</span>
              </div>
              {regimeStats.map((s) => (
                <div key={s.k} className="grid grid-cols-[1fr_42px_50px_54px] items-center py-[3px] text-[11.5px]">
                  <span className="flex items-center gap-1.5 text-[var(--text-2)]">
                    <span className="h-[5px] w-[5px] rounded-full" style={{ background: regimeColor(s.k) }} />
                    {regimeLabel(s.k, lang)}
                  </span>
                  <span className="mono text-right text-[var(--muted)]">{s.avgDur.toFixed(1)}d</span>
                  <span className={`mono text-right ${trendClass(s.fwd5)}`}>{s.fwd5 == null ? "—" : pct(s.fwd5)}</span>
                  <span className={`mono text-right ${trendClass(s.fwd20)}`}>{s.fwd20 == null ? "—" : pct(s.fwd20)}</span>
                </div>
              ))}

            </div>
          </Card>

          <Card
            index="03"
            title={t("regime.similar")}
            subtitle={
              lang === "en"
                ? "Nearest sessions in (return, breadth, dispersion, concentration)"
                : "按收益、广度、分化度、集中度的标准化距离"
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="flex flex-col px-3 pb-2">
              {similar.map(({ r, d }) => (
                <button
                  key={r.trade_date}
                  onClick={() => setSel(r.trade_date)}
                  className="flex items-center gap-2 rounded-md px-2 py-[7px] text-left transition-colors hover:bg-[var(--panel-2)]"
                >
                  <span className="mono w-[58px] text-[12px] text-[var(--text-2)]">{shortDate(r.trade_date)}</span>
                  <span className={`mono w-[46px] text-[11.5px] ${r.ew_ret >= 0 ? "up" : "down"}`}>{pct(r.ew_ret)}</span>
                  <span className="mono w-[38px] text-[11.5px] text-[var(--muted)]">{ratio(r.breadth, 0)}</span>
                  <span className="ml-auto mono text-[11px] text-[var(--faint)]">d={d.toFixed(2)}</span>
                </button>
              ))}
              {!similar.length && <div className="py-6 text-center text-[12px] text-[var(--muted)]">—</div>}
            </div>
          </Card>
        </div>
      </div>

      {selRow && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            { k: t("metric.ew"), v: pct(selRow.ew_ret), tone: selRow.ew_ret >= 0 ? "up" : "down" },
            { k: t("metric.breadth"), v: ratio(selRow.breadth, 0) },
            { k: t("metric.csd"), v: `${(selRow.csd * 100).toFixed(2)}pp` },
            { k: t("metric.top10"), v: ratio(selRow.top10_share, 0) },
            { k: t("metric.limitUp"), v: `${selRow.limit_up_list_n ?? "—"} / ${selRow.limit_down_list_n ?? "—"}` },
            { k: t("metric.amount"), v: money(selRow.amount) },
          ].map((s) => (
            <div key={s.k} className="card px-4 py-3">
              <MicroLabel>{s.k}</MicroLabel>
              <div className={`mono mt-2 text-[16px] font-semibold ${s.tone === "up" ? "up" : s.tone === "down" ? "down" : ""}`}>{s.v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
