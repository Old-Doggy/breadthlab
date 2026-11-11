// 前端性能与 E2E：单文件 dashboard 的加载、切页、下钻、加自选。
// 用法: node scripts/e2e.mjs [file]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] || "dist/BreadthLab.html";
const file = path.resolve(target);
const url = "file:///" + file.replace(/\\/g, "/");
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  pipe: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--no-sandbox", "--no-first-run", "--allow-file-access-from-files"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

const t0 = Date.now();
await page.goto(url, { waitUntil: "load", timeout: 120000 });
await page.waitForSelector(".card", { timeout: 30000 });
const loadMs = Date.now() - t0;
const paint = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
  return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), fcp: Math.round(fcp?.startTime || 0) };
});

const steps = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    steps.push({ name, ok: true, ms: Date.now() - t });
  } catch (e) {
    steps.push({ name, ok: false, ms: Date.now() - t, error: String(e).slice(0, 160) });
  }
}

const clickNav = async (hash, sel) => {
  await page.evaluate((h) => (window.location.hash = h), hash);
  await page.waitForSelector(sel, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 400));
};

await step("Today renders verdict", async () => {
  await page.waitForFunction(() => document.querySelectorAll(".card").length >= 3, { timeout: 15000 });
  const txt = await page.evaluate(() => document.body.innerText);
  if (txt.trim().length < 80) throw new Error("empty page");
  if (!/BreadthLab|今日|盘面|Today/i.test(txt)) throw new Error("no shell");
});

await step("Market page", () => clickNav("#/market", ".card"));
await step("Sectors page", () => clickNav("#/sectors", ".card"));
await step("Stocks page", () => clickNav("#/stocks", ".card"));

await step("Select a stock row", async () => {
  await page.waitForSelector("table tbody tr", { timeout: 15000 });
  await page.click("table tbody tr");
  await page.waitForFunction(() => document.body.innerText.includes("加入自选"), { timeout: 8000 });
});

await step("Add to watchlist", async () => {
  const btn = await page.$("::-p-xpath(//button[contains(., '加入自选')])");
  if (!btn) throw new Error("button not found");
  await btn.click();
  await new Promise((r) => setTimeout(r, 600));
});

await step("Watchlist shows position", async () => {
  await clickNav("#/watchlist", ".card");
  const txt = await page.evaluate(() => document.body.innerText);
  if (!txt.includes("自选")) throw new Error("watchlist not rendered");
  if (txt.includes("还没有自选股")) throw new Error("watchlist empty after add");
});

await browser.close();
const result = { url, loadMs, paint, steps, errors: errors.slice(0, 10), passed: steps.every((s) => s.ok) && errors.length === 0 };
console.log(JSON.stringify(result, null, 2));
fs.writeFileSync(path.resolve("../data/meta/e2e.json"), JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
