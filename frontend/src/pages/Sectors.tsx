import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, type SectorDay } from "../lib/api";
import { useUI } from "../store/ui";
import { paletteFor } from "../lib/theme";
import { money, pct, ratio, trendClass } from "../lib/format";
import { sectorBubble } from "../lib/charts";
import { sectorHeatmap } from "../lib/charts2";
import { rotationIntensity, sectorRankHeatmap } from "../lib/charts3";
import EChart from "../components/EChart";
import { Card, MicroLabel } from "../components/Card";

export default function Sectors() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { theme, colorblind } = useUI();
  const p = paletteFor(theme, colorblind);
  const [params, setParams] = useSearchParams();
  const sel = params.get("sector");
  const setSel = (s: string | null) => {
    const p = new URLSearchParams(params);
    if (s) p.set("sector", s);
    else p.delete("sector");
    setParams(p, { replace: true });
  };

  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const d = meta?.last_trade_date;

  const { data: sectors } = useQuery({
    queryKey: ["sectors", d],
    queryFn: () => api.sectors(d as string),
    enabled: !!d,
  });
  const { data: monthly } = useQuery({ queryKey: ["sector-monthly"], queryFn: () => api.sectorMonthly() });
  const { data: rotation } = useQuery({ queryKey: ["rotation"], queryFn: api.rotation });
  const { data: ranks } = useQuery({ queryKey: ["sector-ranks"], queryFn: api.sectorRanks });
  const { data: stocks } = useQuery({
    queryKey: ["stocks", d, sel],
    queryFn: () => api.stocks(d as string, sel || undefined),
    enabled: !!d,
  });

  const rows = sectors ?? [];
  const selected = sel ?? rows[0]?.sw_l1 ?? null;
  const selRow = rows.find((r) => r.sw_l1 === selected) as SectorDay | undefined;

  const months = useMemo(() => {
    if (!monthly) return [];
    const all = [...new Set(monthly.map((m) => m.month))].sort();
    const keep = all.slice(-24);
    return monthly.filter((m) => keep.includes(m.month));
  }, [monthly]);

  const board = useMemo(() => [...rows].sort((a, b) => b.breadth - a.breadth), [rows]);
  const selStocks = (stocks ?? []).slice(0, 400);
  const top = selStocks.slice(0, 6);
  const bottom = selStocks.slice(-6).reverse();

  if (!rows.length) return <div className="skeleton h-[560px] w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">{t("sectors.title")}</h1>
          <p className="mt-1 text-[12px] text-[var(--muted)]">{t("sectors.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 text-[10.5px] text-[var(--muted)]">
          <span className="pill h-[24px]">
            <span className="mono">{d}</span>
          </span>
          <span className="pill h-[24px]">{rows.length} {lang === "en" ? "sectors" : "个行业"}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-8">
          <Card
            title={t("sectors.bubble")}
            subtitle={
              lang === "en"
                ? "X = return · Y = breadth · size = turnover · click to drill in"
                : "横轴收益 · 纵轴广度 · 大小 = 成交额 · 点击下钻"
            }
            right={
              <div className="flex items-center gap-2.5 text-[9.5px] text-[var(--muted)]">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: p.up }} />
                  {lang === "en" ? "up" : "上涨"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: p.down }} />
                  {lang === "en" ? "down" : "下跌"}
                </span>
              </div>
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[420px] px-2 pb-2">
              <EChart
                option={sectorBubble(p, rows, lang)}
                onEvents={{
                  click: (params: unknown) => {
                    const name = (params as { data?: { name?: string } })?.data?.name;
                    if (name) setSel(name);
                  },
                }}
              />
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card
            title={lang === "en" ? "Breadth ranking" : "行业广度排序"}
            subtitle={lang === "en" ? "Share of constituents advancing" : "行业内上涨股票占比"}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="flex max-h-[420px] flex-col overflow-y-auto px-3 pb-2">
              {board.map((s) => (
                <button
                  key={s.sw_l1}
                  onClick={() => setSel(s.sw_l1)}
                  className={`grid grid-cols-[86px_1fr_42px_52px] items-center gap-2 rounded-md px-2 py-[7px] text-left transition-colors ${
                    s.sw_l1 === selected ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel-2)]"
                  }`}
                >
                  <span className={`truncate text-[11.5px] ${s.sw_l1 === selected ? "text-[var(--text)]" : "text-[var(--text-2)]"}`}>
                    {s.sw_l1}
                  </span>
                  <div className="h-[4px] overflow-hidden rounded-full bg-[var(--panel-3)]">
                    <div className="h-full rounded-full" style={{ width: `${s.breadth * 100}%`, background: p.accent, opacity: 0.7 }} />
                  </div>
                  <span className="mono text-right text-[10.5px] text-[var(--muted)]">{ratio(s.breadth, 0)}</span>
                  <span className={`mono text-right text-[10.5px] ${trendClass(s.ew_ret)}`}>{pct(s.ew_ret)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card
        title={t("sectors.heatmap")}
        subtitle={
          lang === "en"
            ? "Monthly sector return, sorted by cumulative performance over the window"
            : "行业月度收益，按窗口累计收益排序"
        }
        right={<span className="pill h-[22px] px-2 text-[10px]">{months.length} {lang === "en" ? "months" : "个月"}</span>}
        padded={false}
        bodyClass="pt-0"
      >
        <div className="h-[460px] px-3 pb-2">
          {months.length ? <EChart option={sectorHeatmap(p, months, lang)} /> : <div className="skeleton h-full w-full" />}
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <Card
            title={lang === "en" ? "Rank migration matrix" : "排名迁移矩阵 · 20 日收益"}
            subtitle={
              lang === "en"
                ? "Rows = sectors · colour = rank, red is strongest · weekly sampling"
                : "行 = 行业 · 颜色越红排名越靠前 · 每周采样"
            }
            right={<span className="pill h-[22px] px-2 text-[10px]">26W</span>}
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[430px] px-2 pb-2">
              {(ranks?.length ?? 0) > 0 ? (
                <EChart option={sectorRankHeatmap(p, ranks!, lang)} />
              ) : (
                <div className="skeleton h-full w-full" />
              )}
            </div>
          </Card>
        </div>
        <div className="col-span-12 xl:col-span-5">
          <Card
            title={lang === "en" ? "Rotation intensity" : "轮动强度"}
            subtitle={
              lang === "en"
                ? "Mean absolute daily change in sector rank, last 3 years"
                : "行业排名日变化的绝对值均值 · 近 3 年"
            }
            right={
              rotation?.length ? (
                <span className="pill h-[22px] px-2 text-[10px]">
                  {lang === "en" ? "avg" : "均值"}{" "}
                  {(rotation.reduce((a, r) => a + r.rotation_intensity, 0) / rotation.length).toFixed(2)}
                </span>
              ) : null
            }
            padded={false}
            bodyClass="pt-0"
          >
            <div className="h-[340px] px-2 pb-2">
              {(rotation?.length ?? 0) > 0 ? (
                <EChart option={rotationIntensity(p, rotation!, lang)} />
              ) : (
                <div className="skeleton h-full w-full" />
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-4">
          <Card
            title={selected ? `${selected} · ${lang === "en" ? "inside" : "内部结构"}` : t("sectors.inside")}
            subtitle={
              selRow
                ? `${selRow.n} ${lang === "en" ? "stocks" : "只"} · ${lang === "en" ? "breadth" : "广度"} ${ratio(selRow.breadth, 0)} · ${lang === "en" ? "IQR" : "分化"} ${(selRow.iqr * 100).toFixed(1)}pp`
                : ""
            }
          >
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: lang === "en" ? "Equal-weight" : "等权收益", v: pct(selRow?.ew_ret ?? null), tone: trendClass(selRow?.ew_ret) },
                { k: lang === "en" ? "Cap-weight" : "市值加权", v: pct(selRow?.cw_ret ?? null), tone: trendClass(selRow?.cw_ret) },
                { k: lang === "en" ? "Turnover" : "成交额", v: money(selRow?.amount ?? null) },
                { k: lang === "en" ? "Limit-ups" : "涨停家数", v: `${selRow?.limit_up_n ?? "—"}` },
              ].map((s) => (
                <div key={s.k} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <MicroLabel>{s.k}</MicroLabel>
                  <div className={`mono mt-1.5 text-[15px] font-medium ${s.tone || ""}`}>{s.v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
              <p>
                {lang === "en"
                  ? "Cap-weight above equal-weight means heavyweights carried the sector."
                  : "市值加权高于等权，说明行业涨幅由大市值龙头贡献。"}
              </p>
              <p>
                {lang === "en"
                  ? "Wide IQR means the sector average hides a large split inside."
                  : "IQR 越大，说明行业均值掩盖了更明显的个股分化。"}
              </p>
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card title={lang === "en" ? "Leaders" : "行业内领涨"} padded={false} bodyClass="pt-0">
            <div className="flex flex-col px-3 pb-2">
              {top.map((s) => (
                <div key={s.ts_code} className="grid grid-cols-[1fr_76px_54px] items-center gap-2 border-b border-[var(--border)] px-2 py-[8px] last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[11.5px] text-[var(--text)]">{s.name}</div>
                    <div className="mono text-[9.5px] text-[var(--faint)]">{s.ts_code}</div>
                  </div>
                  <div className="mono text-right text-[10px] text-[var(--muted)]">{money(s.amount)}</div>
                  <div className={`mono text-right text-[11px] ${trendClass(s.ret)}`}>{pct(s.ret)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <Card title={lang === "en" ? "Laggards" : "行业内领跌"} padded={false} bodyClass="pt-0">
            <div className="flex flex-col px-3 pb-2">
              {bottom.map((s) => (
                <div key={s.ts_code} className="grid grid-cols-[1fr_76px_54px] items-center gap-2 border-b border-[var(--border)] px-2 py-[8px] last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-[11.5px] text-[var(--text)]">{s.name}</div>
                    <div className="mono text-[9.5px] text-[var(--faint)]">{s.ts_code}</div>
                  </div>
                  <div className="mono text-right text-[10px] text-[var(--muted)]">{money(s.amount)}</div>
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
