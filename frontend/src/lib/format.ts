export const pct = (v: number | null | undefined, digits = 2, signed = true): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return signed && v > 0 ? `+${s}%` : `${s}%`;
};

export const ratio = (v: number | null | undefined, digits = 0): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
};

export const num = (v: number | null | undefined, digits = 0): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

let fmtLang =
  new URLSearchParams(window.location.search).get("lang") ||
  localStorage.getItem("bl.lang") ||
  "zh";
export const setFmtLang = (l: string) => {
  fmtLang = l;
};

export const money = (v: number | null | undefined, lang = fmtLang): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (lang === "en") {
    if (abs >= 1e12) return `¥${(v / 1e12).toFixed(2)}T`;
    if (abs >= 1e8) return `¥${(v / 1e8).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e4) return `¥${(v / 1e4).toFixed(0)}K`;
    return `¥${v.toFixed(0)}`;
  }
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(v / 1e8).toFixed(abs >= 1e10 ? 0 : 1)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return v.toFixed(0);
};

export const signed = (v: number | null | undefined, digits = 2): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
};

export const trendClass = (v: number | null | undefined): string =>
  v === null || v === undefined || Number.isNaN(v) ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat";

export const shortDate = (d: string): string => (d ? d.slice(5).replace("-", "/") : "—");

export const weekday = (d: string, lang = fmtLang): string => {
  if (!d) return "";
  const dt = new Date(`${d}T00:00:00`);
  const zh = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dt.getDay()];
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
  return lang === "en" ? en : zh;
};
