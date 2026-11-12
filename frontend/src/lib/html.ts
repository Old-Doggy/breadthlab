/** Escape dynamic values before inserting them into an ECharts HTML tooltip. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** A missing observation invalidates cumulative return from the chosen start. */
export function cumulativeReturns(values: (number | null | undefined)[]): (number | null)[] {
  let wealth: number | null = 1;
  return values.map((value) => {
    if (wealth === null || value == null || !Number.isFinite(value) || value < -1) {
      wealth = null;
      return null;
    }
    wealth *= 1 + value;
    return wealth - 1;
  });
}
