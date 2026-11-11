import type { MarketDay } from "./api";

export type RegimeKey = "broad_up" | "concentrated_up" | "mixed" | "broad_down";

export const regimeOf = (m: Pick<MarketDay, "ew_ret" | "breadth">): RegimeKey => {
  if (m.ew_ret > 0) return m.breadth >= 0.6 ? "broad_up" : m.breadth < 0.45 ? "concentrated_up" : "mixed";
  return m.breadth >= 0.6 ? "mixed" : m.breadth < 0.45 ? "broad_down" : "mixed";
};

export const regimeLabel = (key: RegimeKey, lang: string): string => {
  const zh: Record<RegimeKey, string> = {
    broad_up: "普涨",
    concentrated_up: "集中上涨",
    mixed: "结构分化",
    broad_down: "普跌",
  };
  const en: Record<RegimeKey, string> = {
    broad_up: "Broad rally",
    concentrated_up: "Narrow rally",
    mixed: "Divergent",
    broad_down: "Broad selloff",
  };
  return (lang === "en" ? en : zh)[key];
};

/** 为 hero 区生成一句人话结论。 */
export function verdict(m: MarketDay, lang: string): string {
  const b = Math.round(m.breadth * 100);
  const idx = ((m.hs300_ret ?? 0) * 100).toFixed(2);
  const top = Math.round((m.top10_share || 0) * 100);
  if (lang === "en") {
    if (m.ew_ret > 0 && m.breadth < 0.45)
      return `CSI 300 ${idx > "0" ? "+" : ""}${idx}% but only ${b}% of stocks rose — the gain was carried by a handful of heavyweights (top 10 ≈ ${top}% of the move).`;
    if (m.ew_ret < 0 && m.breadth >= 0.6)
      return `The index fell ${idx}% while ${b}% of stocks actually rose — the drag came from large caps, not the broad tape.`;
    if (m.ew_ret < 0 && m.breadth < 0.45)
      return `Broad selloff: only ${b}% of stocks advanced and the equal-weight market fell ${(m.ew_ret * 100).toFixed(2)}%.`;
    return `Broad participation: ${b}% of stocks advanced with an equal-weight return of ${(m.ew_ret * 100).toFixed(2)}%.`;
  }
  if (m.ew_ret > 0 && m.breadth < 0.45)
    return `沪深300 收涨 ${idx}%，但只有 ${b}% 的股票上涨——涨幅集中在少数权重股，Top10 贡献了 ${top}% 的指数涨跌。`;
  if (m.ew_ret < 0 && m.breadth >= 0.6)
    return `指数下跌 ${idx}%，但 ${b}% 的股票其实在涨——拖累来自大市值，而不是全市场。`;
  if (m.ew_ret < 0 && m.breadth < 0.45)
    return `普跌：仅 ${b}% 的股票上涨，等权收益 ${(m.ew_ret * 100).toFixed(2)}%，下跌具有广泛参与。`;
  return `普涨：${b}% 的股票上涨，等权收益 ${(m.ew_ret * 100).toFixed(2)}%，上涨具备广泛参与。`;
}

export const quadrants = [
  { key: "broad_up", zh: "普涨", en: "Broad rally", color: "rgba(35,181,125,.05)" },
  { key: "concentrated_up", zh: "集中上涨", en: "Narrow rally", color: "rgba(232,163,61,.05)" },
  { key: "mixed", zh: "结构分化", en: "Divergent", color: "rgba(125,135,152,.04)" },
  { key: "broad_down", zh: "普跌", en: "Broad selloff", color: "rgba(240,85,90,.05)" },
];

/** 页面级结论句：短、无句号、用于衬线大标题。 */
export function headline(m: Pick<MarketDay, "ew_ret" | "breadth" | "hs300_ret">, lang = "zh"): string {
  const b = Math.round(m.breadth * 100);
  const idx = (m.hs300_ret ?? 0) * 100;
  const quiet = Math.abs(idx) < 0.25;
  if (lang === "en") {
    if (m.ew_ret > 0 && quiet) return `The index barely moved — ${b}% of stocks rose`;
    if (m.ew_ret > 0 && m.breadth >= 0.6) return `${b}% of stocks are rising`;
    if (m.ew_ret > 0 && m.breadth < 0.45) return `The index is up, but only ${b}% of stocks joined`;
    if (m.ew_ret < 0 && m.breadth >= 0.6) return `The index is down, most stocks are up`;
    if (m.ew_ret < 0 && m.breadth < 0.45) return `Broad selloff — only ${b}% advanced`;
    return `Split tape — ${b}% of stocks are up`;
  }
  if (m.ew_ret > 0 && quiet) return `指数几乎没动，${b}% 的股票在涨`;
  if (m.ew_ret > 0 && m.breadth >= 0.6) return `普涨：${b}% 的股票在涨`;
  if (m.ew_ret > 0 && m.breadth < 0.45) return `指数在涨，但只有 ${b}% 的股票跟上了`;
  if (m.ew_ret < 0 && m.breadth >= 0.6) return `指数在跌，多数股票却在涨`;
  if (m.ew_ret < 0 && m.breadth < 0.45) return `普跌：仅 ${b}% 的股票上涨`;
  return `结构分化：${b}% 的股票在涨`;
}
