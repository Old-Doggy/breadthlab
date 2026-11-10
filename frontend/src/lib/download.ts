export function downloadDataUrl(url: string | null, filename: string) {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export function downloadCsv(rows: (string | number)[][], filename: string) {
  const text = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
