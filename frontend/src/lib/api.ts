/* 数据层：既支持 Flask API，也支持「单文件静态导出」模式。
 * 静态模式下 window.__BL_DATA__ 由 export_static.py 注入，所有请求走本地内存。 */

const BASE = "";

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = params
    ? "?" +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const res = await fetch(`${BASE}${path}${qs}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface Meta {
  last_trade_date: string;
  first_trade_date: string;
  updated_at: string | null;
  n_stocks: number;
  n_days: number;
  source: string;
  status: "ok" | "stale" | "failed";
  warnings: string[];
  alert?: { time: string; stage: string; message: string; log?: string | null } | null;
}

export interface MarketDay {
  trade_date: string;
  n_valid: number;
  n_adv: number;
  n_dec: number;
  n_flat: number;
  breadth: number;
  ew_ret: number;
  cw_ret: number;
  med_ret: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  iqr: number;
  csd: number;
  skew: number;
  amount: number;
  turnover_rate: number;
  hhi: number;
  max_weight: number;
  top10_share: number;
  top10_contrib_pct: number;
  gain_share_top5pct: number;
  ew_cw_gap: number;
  limit_up_n: number;
  limit_down_n: number;
  limit_up_list_n: number;
  limit_down_list_n: number;
  broken_n: number;
  broken_rate: number | null;
  max_streak: number;
  streak_n: number;
  first_board_n: number;
  limit_fd_amount: number;
  new_high_n: number;
  new_low_n: number;
  ma20_breadth: number;
  ma60_breadth: number;
  ma250_breadth: number;
  hs300_ret: number | null;
  zz500_ret: number | null;
  zz1000_ret: number | null;
  sse_ret: number | null;
  flow_breadth: number | null;
  net_mf_amount: number | null;
  main_net_amount: number | null;
  rzye: number | null;
  rzmre: number | null;
}

export interface SectorDay {
  trade_date: string;
  sw_l1: string;
  n: number;
  n_adv: number;
  n_dec: number;
  breadth: number;
  ew_ret: number;
  med_ret: number;
  cw_ret: number;
  q25: number;
  q75: number;
  q10?: number;
  q90?: number;
  iqr: number;
  csd: number;
  amount: number;
  turnover_rate: number;
  limit_up_n: number;
}

export interface SectorMonth {
  month: string;
  sw_l1: string;
  n_days: number;
  breadth: number;
  ew_ret: number;
  cw_ret: number;
  iqr: number;
  amount: number;
  ew_ret_cum: number;
}

export interface StockRow {
  ts_code: string;
  name: string;
  sw_l1: string;
  market: string;
  trade_date: string;
  close: number;
  ret: number;
  circ_mv: number;
  total_mv: number;
  turnover_rate: number;
  pe_ttm: number;
  pb: number;
  amount: number;
  is_limit_up: boolean;
  is_limit_down: boolean;
  shares?: number;
  cost?: number;
}

export interface Contributor {
  ts_code: string;
  name: string;
  sw_l1: string;
  ret: number;
  weight: number;
  contrib: number;
}

export interface MarketDayDetail extends MarketDay {
  contributors: Contributor[];
  sectors: SectorDay[];
}

export interface DistBin {
  b: number;
  n: number;
  lo: number;
  hi: number;
}

export interface Distribution {
  bins: DistBin[];
  stats: {
    n: number;
    med: number;
    p05: number;
    p25: number;
    p75: number;
    p95: number;
    mean: number;
    sd: number;
  };
}

export interface UpdateLog {
  date: string;
  status: string;
  days: number;
  duration: number | null;
  warnings: number;
}

export interface PePercentile {
  pe: number;
  pct: number;
  n: number;
}

export interface Reconcile {
  generated_at?: string;
  stocks?: number;
  pairs?: number;
  mae_pp?: number;
  p95_pp?: number;
  max_pp?: number;
  share_gt_0_1pp?: number;
}

export interface RotationDay {
  trade_date: string;
  rotation_intensity: number;
  n_sectors?: number;
}

export interface SectorRank {
  trade_date: string;
  sw_l1: string;
  rank20: number;
  ret20?: number;
}

export interface LimitQuality {
  trade_date: string;
  fd_ratio: number | null;
  open_share: number | null;
  avg_open_times: number | null;
  n_limit_up: number;
}

export interface QualityGate {
  id: number;
  name: string;
  pass: boolean;
  value: number | null;
  threshold: string;
  level: "block" | "warn";
  message: string;
}

export interface QualityReport {
  date: string;
  generated_at: string;
  rows: number;
  gates: QualityGate[];
  passed: boolean;
  blocking: number[];
}

export interface StaticPayload {
  meta: Meta;
  market: MarketDay[];
  sectors: Record<string, SectorDay[]>;
  sector_monthly: SectorMonth[];
  rotation?: RotationDay[];
  sector_ranks?: SectorRank[];
  contrib: Record<string, Contributor[]>;
  distribution: Record<string, Distribution>;
  stocks: StockRow[];
  watch_pool: StockRow[];
  stock_series?: Record<string, [string, number, number, number, number, number][]>;
  pe_percentile?: Record<string, PePercentile>;
  limit_quality?: LimitQuality[];
  updates?: UpdateLog[];
  reconcile?: Reconcile;
  quality?: QualityReport;
}

declare global {
  interface Window {
    __BL_DATA__?: StaticPayload;
  }
}

const S: StaticPayload | undefined = typeof window !== "undefined" ? window.__BL_DATA__ : undefined;
export const isStatic = !!S;

const ok = <T>(v: T) => Promise.resolve(v);

function monthAgg(rows: MarketDay[]): MarketDay[] {
  const g = new Map<string, MarketDay[]>();
  rows.forEach((r) => {
    const k = r.trade_date.slice(0, 7) + "-01";
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(r);
  });
  return [...g.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, rs]) => {
      const n = rs.length;
      const mean = (f: (r: MarketDay) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
      return {
        ...rs[rs.length - 1],
        trade_date: k,
        n_valid: rs.reduce((a, r) => a + r.n_valid, 0),
        breadth: mean((r) => r.breadth),
        ew_ret: mean((r) => r.ew_ret),
        cw_ret: mean((r) => r.cw_ret),
        med_ret: mean((r) => r.med_ret),
        csd: mean((r) => r.csd),
        amount: rs.reduce((a, r) => a + r.amount, 0),
        hhi: mean((r) => r.hhi),
        top10_share: mean((r) => r.top10_share),
      } as MarketDay;
    });
}

const inRange = (d: string, start?: string, end?: string) =>
  (!start || d >= start) && (!end || d <= end);

const WATCH_KEY = "bl.watch";

export interface WatchItem {
  ts_code: string;
  shares: number;
  cost: number;
}

function readWatch(): WatchItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]");
    return (Array.isArray(raw) ? raw : []).map((x: unknown) => {
      if (typeof x === "string") return { ts_code: x, shares: 0, cost: 0 };
      const o = x as WatchItem;
      return { ts_code: o.ts_code, shares: Number(o.shares) || 0, cost: Number(o.cost) || 0 };
    });
  } catch {
    return [];
  }
}

function writeWatch(items: WatchItem[]) {
  const seen = new Set<string>();
  const clean = items.filter((x) => {
    if (!x.ts_code || seen.has(x.ts_code)) return false;
    seen.add(x.ts_code);
    return true;
  });
  localStorage.setItem(WATCH_KEY, JSON.stringify(clean));
}

export const api = {
  meta: () => (S ? ok(S.meta) : get<Meta>("/api/meta")),

  quality: () => (S ? ok(S.quality ?? null) : get<QualityReport | null>("/api/quality")),

  distribution: (date: string) =>
    S
      ? ok(
          S.distribution[date] ?? {
            bins: [],
            stats: { n: 0, med: 0, p05: 0, p25: 0, p75: 0, p95: 0, mean: 0, sd: 0 },
          },
        )
      : get<Distribution>(`/api/distribution/${date}`),

  marketSeries: (start?: string, end?: string, freq: "day" | "month" = "day") => {
    if (S) {
      const rows = S.market.filter((r) => inRange(r.trade_date, start, end));
      return ok(freq === "month" ? monthAgg(rows) : rows);
    }
    return get<MarketDay[]>("/api/market/series", { start, end, freq });
  },

  marketDay: (date: string) => {
    if (S) {
      const row = S.market.find((r) => r.trade_date === date) ?? S.market[S.market.length - 1];
      return ok({
        ...row,
        contributors: S.contrib[date] ?? [],
        sectors: S.sectors[date] ?? [],
      } as MarketDayDetail);
    }
    return get<MarketDayDetail>(`/api/market/day/${date}`);
  },

  sectors: (date: string) => (S ? ok(S.sectors[date] ?? []) : get<SectorDay[]>("/api/sectors", { date })),

  sectorSeries: (start?: string, end?: string) => {
    if (S) {
      const all = Object.values(S.sectors).flat().filter((r) => inRange(r.trade_date, start, end));
      return ok(all);
    }
    return get<SectorDay[]>("/api/sectors/series", { start, end });
  },

  sectorMonthly: (start?: string, end?: string) => {
    if (S) return ok(S.sector_monthly.filter((r) => inRange(r.month, start, end)));
    return get<SectorMonth[]>("/api/sectors/monthly", { start, end });
  },

  rotation: () => (S ? ok(S.rotation ?? []) : get<RotationDay[]>("/api/rotation")),

  limitQuality: () => (S ? ok(S.limit_quality ?? []) : get<LimitQuality[]>("/api/limit-quality")),

  updates: () => (S ? ok(S.updates ?? []) : get<UpdateLog[]>("/api/updates")),

  reconcile: () => (S ? ok(S.reconcile ?? null) : get<Reconcile | null>("/api/reconcile")),

  sectorRanks: () => (S ? ok(S.sector_ranks ?? []) : get<SectorRank[]>("/api/sector-ranks")),

  stocks: (date: string, sector?: string, limit = 6000) => {
    if (S) {
      const rows = S.stocks.filter((r) => (!sector ? true : r.sw_l1 === sector));
      return ok(rows.slice(0, limit));
    }
    return get<StockRow[]>("/api/stocks", { date, sector, limit });
  },

  valuation: (code: string) => {
    if (S) return ok(S.pe_percentile?.[code] ?? null);
    return get<PePercentile | null>(`/api/valuation/${code}`);
  },

  stockSeries: (code: string, start?: string, end?: string) => {
    if (S) {
      const raw = S.stock_series?.[code] ?? [];
      return ok(
        raw.map(([d, o, h, l, c, v]) => ({ trade_date: d, open: o, high: h, low: l, close: c, vol: v })),
      );
    }
    return get<{ trade_date: string; open: number; high: number; low: number; close: number; vol: number }[]>(
      `/api/stock/${code}`,
      { start, end },
    );
  },

  watchlist: () => {
    if (S) {
      const items = readWatch();
      const map = new Map(items.map((i) => [i.ts_code, i]));
      return ok(
        S.watch_pool
          .filter((r) => map.has(r.ts_code))
          .map((r) => ({ ...r, shares: map.get(r.ts_code)!.shares, cost: map.get(r.ts_code)!.cost })),
      );
    }
    return get<StockRow[]>("/api/watchlist");
  },

  addWatch: (code: string, shares = 0, cost = 0) => {
    if (S) {
      const items = readWatch();
      if (!items.some((i) => i.ts_code === code)) items.push({ ts_code: code, shares, cost });
      writeWatch(items);
      return ok({ ok: true });
    }
    return fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ts_code: code, shares, cost }),
    }).then((r) => r.json());
  },

  updateWatch: (code: string, patch: { shares?: number; cost?: number }) => {
    if (S) {
      const items = readWatch().map((i) => (i.ts_code === code ? { ...i, ...patch } : i));
      writeWatch(items);
      return ok({ ok: true });
    }
    return fetch(`/api/watchlist/${encodeURIComponent(code)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json());
  },

  removeWatch: (code: string) => {
    if (S) {
      writeWatch(readWatch().filter((c) => c.ts_code !== code));
      return ok({ ok: true });
    }
    return fetch(`/api/watchlist/${encodeURIComponent(code)}`, { method: "DELETE" }).then((r) => r.json());
  },
};
