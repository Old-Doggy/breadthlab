export type Theme = "dark" | "light";

export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  text: string;
  text2: string;
  muted: string;
  faint: string;
  up: string;
  upSoft: string;
  down: string;
  downSoft: string;
  accent: string;
  accentSoft: string;
  warn: string;
  grid: string;
  axis: string;
}

const dark: Palette = {
  bg: "#05070b",
  panel: "#0a0e15",
  panel2: "#0e131c",
  border: "rgba(255,255,255,0.07)",
  text: "#e9eef6",
  text2: "#b9c2d0",
  muted: "#7d8798",
  faint: "#5a6274",
  up: "#f0555a",
  upSoft: "rgba(240,85,90,0.16)",
  down: "#23b57d",
  downSoft: "rgba(35,181,125,0.16)",
  accent: "#5b8cff",
  accentSoft: "rgba(91,140,255,0.16)",
  warn: "#e8a33d",
  grid: "rgba(255,255,255,0.055)",
  axis: "rgba(255,255,255,0.12)",
};

const light: Palette = {
  bg: "#f3f5f8",
  panel: "#ffffff",
  panel2: "#f8fafc",
  border: "#e3e7ee",
  text: "#0d1526",
  text2: "#364152",
  muted: "#667085",
  faint: "#98a2b3",
  up: "#d92d20",
  upSoft: "rgba(217,45,32,0.10)",
  down: "#067647",
  downSoft: "rgba(6,118,71,0.10)",
  accent: "#175cd3",
  accentSoft: "rgba(23,92,211,0.10)",
  warn: "#b54708",
  grid: "rgba(13,21,38,0.07)",
  axis: "rgba(13,21,38,0.14)",
};

export const palettes: Record<Theme, Palette> = { dark, light };

export const SW_COLORS = [
  "#5b8cff",
  "#f0555a",
  "#23b57d",
  "#e8a33d",
  "#9b7bff",
  "#2bb7c9",
  "#e0619b",
  "#8f9bb3",
];

/** ECharts 的基础主题片段：字体、提示框、坐标轴、动画。 */
export function baseChart(p: Palette) {
  return {
    backgroundColor: "transparent",
    animation: true,
    animationDuration: 520,
    animationEasing: "cubicOut" as const,
    textStyle: {
      fontFamily:
        '"Inter Variable", Inter, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      color: p.text2,
      fontSize: 12,
    },
    tooltip: {
      backgroundColor: p.panel,
      borderColor: p.border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: p.text, fontSize: 12 },
      extraCssText:
        "backdrop-filter: blur(12px); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.35);",
      axisPointer: {
        type: "line" as const,
        lineStyle: { color: p.axis, width: 1, type: "dashed" as const },
      },
    },
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
  };
}

export function axisStyle(p: Palette) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: 11, fontFamily: "JetBrains Mono Variable, monospace" },
    splitLine: { lineStyle: { color: p.grid, width: 1 } },
  };
}
