import type { MarketDay } from "./api";

export type RegimeKey = "broad_up" | "concentrated_up" | "mixed" | "broad_down" | "unknown";

export const regimeOf = (m: Pick<MarketDay, "ew_ret" | "breadth">): RegimeKey => {
  if (m.breadth == null || !Number.isFinite(m.breadth) || !Number.isFinite(m.ew_ret)) return "unknown";
  if (m.ew_ret > 0) return m.breadth >= 0.5 ? "broad_up" : "concentrated_up";
  return m.breadth >= 0.5 ? "mixed" : "broad_down";
};

export const regimeLabel = (key: RegimeKey, lang: string): string => {
  const zh: Record<RegimeKey, string> = {
    broad_up: "普涨",
    concentrated_up: "集中上涨",
    mixed: "结构分化",
    broad_down: "普跌",
    unknown: "未知",
  };
  const en: Record<RegimeKey, string> = {
    broad_up: "Broad rally",
    concentrated_up: "Narrow rally",
    mixed: "Divergent",
    broad_down: "Broad selloff",
    unknown: "Unknown",
  };
  return (lang === "en" ? en : zh)[key];
};

/** Describe measured breadth and returns without inferring index attribution. */
export function verdict(m: MarketDay, lang: string): string {
  if (m.breadth == null || !Number.isFinite(m.breadth) || !Number.isFinite(m.ew_ret))
    return lang === "en" ? "Breadth or return is unavailable; no regime conclusion." : "广度或收益不可用，暂不判断市场状态。";
  const b = Math.round(m.breadth * 100);
  const ew = (m.ew_ret * 100).toFixed(2);
  const idx = m.hs300_ret == null ? (lang === "en" ? "unavailable" : "缺失") : `${(m.hs300_ret * 100).toFixed(2)}%`;
  const label = regimeLabel(regimeOf(m), lang);
  return lang === "en"
    ? `${label}: ${b}% of advancing/declining stocks advanced; equal-weight return ${ew}%; CSI 300 ${idx}.`
    : `${label}：上涨占涨跌家数的 ${b}%，等权收益 ${ew}%；沪深300 ${idx}。`;
}
export const quadrants = [
  { key: "broad_up", zh: "普涨", en: "Broad rally", color: "rgba(35,181,125,.05)" },
  { key: "concentrated_up", zh: "集中上涨", en: "Narrow rally", color: "rgba(232,163,61,.05)" },
  { key: "mixed", zh: "结构分化", en: "Divergent", color: "rgba(125,135,152,.04)" },
  { key: "broad_down", zh: "普跌", en: "Broad selloff", color: "rgba(240,85,90,.05)" },
];

/** Short page heading based on market breadth and equal-weight return. */
export function headline(m: Pick<MarketDay, "ew_ret" | "breadth" | "hs300_ret">, lang = "zh"): string {
  if (m.breadth == null || !Number.isFinite(m.breadth) || !Number.isFinite(m.ew_ret))
    return lang === "en" ? "Market breadth is unavailable" : "市场广度暂不可用";
  const b = Math.round(m.breadth * 100);
  const label = regimeLabel(regimeOf(m), lang);
  return lang === "en" ? `${label} — ${b}% advance/decline breadth` : `${label}：上涨广度 ${b}%`;
}
