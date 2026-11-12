/** Display calculations: missing observations must remain distinguishable from zero. */
export function hasDataWarnings(meta: {warnings?: string[]} | undefined, gates: {pass: boolean}[]): boolean {
  return !!meta?.warnings?.length || gates.some(g => !g.pass);
}

export function cumulativePath(returns: (number | null)[]): (number | null)[] {
  let wealth = 1;
  let complete = true;
  return returns.map((ret) => {
    if (ret == null || !Number.isFinite(ret) || ret <= -1) complete = false;
    if (!complete) return null;
    wealth *= 1 + ret!;
    return wealth - 1;
  });
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values: number[], value: number | null): number | null {
  const valid = values.filter((v) => v != null && Number.isFinite(v));
  return value == null || !Number.isFinite(value) || !valid.length ? null
    : Math.round(100 * valid.filter((v) => v <= value).length / valid.length);
}

export function quoteAgeDays(day: string, now = Date.now()): number {
  const shanghaiDay = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  return Math.max(0, Math.floor((Date.parse(`${shanghaiDay}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000));
}

export function indexSummary(index: number | null, ew: number, lang: string): string {
  const display = (value: number) => `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
  if (lang === "en") return `CSI 300 ${index == null ? "unavailable" : display(index)}; equal-weight ${display(ew)}`;
  return `沪深300 ${index == null ? "暂无数据" : display(index)}，等权 ${display(ew)}`;
}
