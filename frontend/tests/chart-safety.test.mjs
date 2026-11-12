import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as echarts from "echarts";

const temporary = mkdtempSync(join(tmpdir(), "breadthlab-chart-test-"));
process.on("exit", () => rmSync(temporary, { recursive: true, force: true }));
globalThis.window = { location: { search: "" } };
globalThis.localStorage = { getItem: () => null };
const output = join(temporary, "index.mjs");
const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const entries = ["charts", "charts2", "charts3", "charts4", "regime", "theme"];
for (const name of [...entries, "format", "html"]) {
  const source = readFileSync(join(frontend, "src", "lib", `${name}.ts`), "utf8");
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  writeFileSync(join(temporary, `${name}.mjs`), result.replace(/(from\s+["'])(\.\/[^"']+)(["'])/g, "$1$2.mjs$3"));
}
writeFileSync(output, entries.map((name) => `export * from './${name}.mjs';`).join("\n"));
const charts = await import(pathToFileURL(output));
const p = charts.paletteFor("dark", false);
const row = { trade_date: "2026-11-11", ew_ret: 0.01, breadth: 0.5, amount: 1e8, csd: 0.02,
  top10_share: 0.55, gain_share_top5pct: 0.3, hhi: 50, hs300_ret: null, cw_ret: null };

test("zero-based distribution bins retain their positions and total", () => {
  const option = charts.distributionChart(p, [{ b: 0, n: 2 }, { b: 1, n: 3 }, { b: 43, n: 5 }], { med: 0, n: 12 }, "en");
  assert.equal(option.series[0].data[0].value[1], 2);
  assert.equal(option.series[0].data[1].value[1], 3);
  assert.equal(option.series[0].data[43].value[1], 5);
  assert.match(option.graphic[0].style.text, /2/);
});

test("sector quadrants match return on x and breadth on y", () => {
  const option = charts.sectorBubble(p, [], "en");
  assert.equal(option.graphic.find((g) => g.left && g.top).style.text, "Divergent");
  assert.equal(option.graphic.find((g) => g.right && g.bottom).style.text, "Narrow rally");
});

test("regime scatter never moves a point across the true boundaries", () => {
  const option = charts.regimeScatter(p, [{ ...row, ew_ret: 0, breadth: 0.5 }], null, "en");
  assert.deepEqual(option.series[1].data[0].value.slice(0, 2), [0, 50]);
  const near = charts.regimeScatter(p, [{ ...row, ew_ret: 0.00001, breadth: 0.50001 }], null, "en");
  assert.deepEqual(near.series[1].data[0].value.slice(0, 2), [0.001, 50.001]);
});

test("concentration axis covers valid shares above 20 percent", () => {
  const option = charts.concentrationChart(p, [row], "en");
  assert.ok(option.yAxis.max >= 55);
});

test("HTML tooltips escape upstream names and codes", () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const option = charts.treemapChart(p, [], "en");
  const html = option.tooltip.formatter({ data: { name: malicious, code: malicious, ret: 0.01, value: 1 } });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  const sector = charts.sectorBubble(p, [], "en");
  assert.ok(!sector.tooltip.formatter({ data: { name: malicious, value: [1, 50, 1, 1, 1] } }).includes("<img"));
  const monthly = charts.monthlyPathChart(p, ["2026-01"], [], "en");
  assert.ok(!monthly.tooltip.formatter([{ dataIndex: 0, seriesName: malicious, value: 1, color: "#fff" }]).includes("<img"));
});

test("missing month does not become a flat return in cumulative paths", () => {
  const option = charts.monthlyPathChart(p, ["Jan", "Feb", "Mar"], [{ name: "x", values: [0.1, null, 0.1] }], "en");
  assert.deepEqual(option.series[0].data, [10, null, null]);
});

test("missing breadth is a gap instead of a zero-percent observation", () => {
  const option = charts.breadthArea(p, [{ ...row, breadth: null }]);
  assert.equal(option.series[0].data[0], null);
});

test("headlines do not infer missing index or unsupported causal claims", () => {
  assert.ok(!charts.headline(row, "en").includes("barely moved"));
  assert.ok(!charts.verdict({ ...row, ew_ret: -0.01, breadth: 0.7, hs300_ret: 0.02 }, "en").includes("index fell"));
  assert.ok(!charts.verdict({ ...row, breadth: 0.4 }, "en").includes("heavyweights"));
});

test("unavailable concentration stays missing rather than becoming zero", () => {
  const option = charts.concentrationChart(p, [{ ...row, top10_share: null, gain_share_top5pct: null, hhi: null }], "en");
  assert.equal(option.series[0].data[0], null);
});

test("selected rank line remains selectable even with an empty rank history", () => {
  const option = charts.rotationBump(p, [], "en", "Synthetic");
  assert.equal(option.series.length, 1);
  assert.equal(option.series[0].name, "Synthetic");
});

test("seal quality reference median averages two middle observations", () => {
  const option = charts.limitQualityChart(p, [0.01, 0.03].map((fd_ratio) => ({ trade_date: "2026-11-11", fd_ratio })), "en");
  assert.equal(option.series[0].markLine.data[0].yAxis, 2);
});

test("undefined dispersion and EW-CW gap never render as observed zero", () => {
  const option = charts.dispersionChart(p, [{ ...row, csd: null, iqr: null, ew_cw_gap: null }], "en");
  assert.equal(option.series[0].data[0], null);
  assert.equal(option.series[1].data[0], null);
  assert.ok(option.tooltip.formatter([{ dataIndex: 0 }]).includes("—"));
});

test("corrected chart options render through ECharts without errors", () => {
  const market = { ...row, n_adv: 3, n_dec: 2, iqr: 0.01, ew_cw_gap: null };
  const sector = { sw_l1: "Synthetic", ew_ret: -0.01, breadth: 0.7, amount: 1e8, n: 6, iqr: 0.02 };
  const options = [
    charts.breadthArea(p, [market, { ...market, breadth: null }]),
    charts.returnBreadth(p, [market], "en"),
    charts.sectorBubble(p, [sector], "en"),
    charts.distributionChart(p, [{ b: 0, n: 2 }, { b: 43, n: 2 }], { med: null, n: 6 }, "en"),
    charts.concentrationChart(p, [market, { ...market, top10_share: null }], "en"),
    charts.regimeScatter(p, [market], null, "en"),
    charts.rotationBump(p, [], "en", "Synthetic"),
    charts.monthlyPathChart(p, ["Jan", "Feb"], [{ name: "Synthetic", values: [0.1, null] }], "en"),
    charts.limitQualityChart(p, [{ trade_date: market.trade_date, fd_ratio: null }], "en"),
  ];
  for (const option of options) {
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 400 });
    try {
      chart.setOption({ ...option, animation: false });
      const svg = chart.renderToSVGString();
      assert.ok(svg.startsWith("<svg"));
      assert.ok(!svg.includes("NaN"));
    } finally {
      chart.dispose();
    }
  }
});
