export type Theme = "dark" | "light";

export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  panel3: string;
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
  copper: string;
  copperSoft: string;
  warn: string;
  grid: string;
  axis: string;
}

const dark: Palette = {
  bg: "#08090b",
  panel: "#0f1114",
  panel2: "#14171b",
  panel3: "#1a1d22",
  border: "#1e2126",
  text: "#ecedef",
  text2: "#c5c9d1",
  muted: "#9aa1aa",
  faint: "#7b828c",
  up: "#e5484d",
  upSoft: "rgba(229,72,77,0.16)",
  down: "#1fa97a",
  downSoft: "rgba(31,169,122,0.16)",
  accent: "#d9a441",
  accentSoft: "rgba(217,164,65,0.16)",
  copper: "#c9a227",
  copperSoft: "rgba(201,162,39,0.14)",
  warn: "#d9a441",
  grid: "rgba(255,255,255,0.2)",
  axis: "rgba(255,255,255,0.32)",
};

const light: Palette = {
  bg: "#f6f2e8",
  panel: "#fffdf8",
  panel2: "#f3eee3",
  panel3: "#e9e3d5",
  border: "#e2dbcb",
  text: "#1a1b1d",
  text2: "#45413a",
  muted: "#665f53",
  faint: "#7f7768",
  up: "#a83a3a",
  upSoft: "rgba(168,58,58,0.10)",
  down: "#2e6b57",
  downSoft: "rgba(46,107,87,0.10)",
  accent: "#a16207",
  accentSoft: "rgba(161,98,7,0.10)",
  copper: "#8c2f2f",
  copperSoft: "rgba(140,47,47,0.08)",
  warn: "#b54708",
  grid: "rgba(26,27,29,0.20)",
  axis: "rgba(26,27,29,0.32)",
};

export const palettes: Record<Theme, Palette> = { dark, light };

/** 色盲友好：涨=蓝、跌=橙，不依赖红绿 */
const darkCb: Palette = {
  ...dark,
  up: "#4c8dff",
  down: "#e8a33d",
  upSoft: "rgba(76,141,255,.16)",
  downSoft: "rgba(232,163,61,.16)",
};
const lightCb: Palette = {
  ...light,
  up: "#175cd3",
  down: "#b54708",
  upSoft: "rgba(23,92,211,.10)",
  downSoft: "rgba(181,71,8,.10)",
};

export const paletteFor = (theme: Theme, colorblind: boolean): Palette =>
  colorblind ? (theme === "dark" ? darkCb : lightCb) : palettes[theme];

/** 分类色板：不含红绿，红绿只表方向 */
export const seriesColors = (p: Palette): string[] =>
  p.bg === "#f6f2e8"
    ? ["#a16207", "#be185d", "#6d28d9", "#c2410c", "#475569", "#9d174d", "#7c2d12", "#334155"]
    : SW_COLORS;

export const SW_COLORS = [
  "#d9a441",
  "#e0619b",
  "#c47a3d",
  "#7c8aa0",
  "#b58b5a",
  "#d65db1",
  "#a8a29a",
  "#6b6255",
];

/** ECharts 基础主题：字体、提示框、坐标轴、动画 */
export function baseChart(p: Palette) {
  return {
    backgroundColor: "transparent",
    animation: true,
    animationDuration: 240,
    animationEasing: "cubicOut" as const,
    textStyle: {
      fontFamily:
        '"Inter Variable", Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
      color: p.text2,
      fontSize: 12.5,
    },
    tooltip: {
      backgroundColor: p.panel2,
      borderColor: p.border,
      borderWidth: 1,
      padding: [9, 11],
      textStyle: { color: p.text, fontSize: 12.5 },
      extraCssText:
        "backdrop-filter: blur(10px); border-radius: 8px; box-shadow: 0 16px 40px rgba(0,0,0,.42);",
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
    axisLabel: {
      color: p.muted,
      fontSize: 12,
      fontFamily: "JetBrains Mono Variable, JetBrains Mono, monospace",
    },
    splitLine: { lineStyle: { color: p.grid, width: 1 } },
  };
}
