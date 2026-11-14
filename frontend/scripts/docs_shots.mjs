// Regenerate docs/screenshots from the single-file build.
// Usage: node scripts/docs_shots.mjs
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("dist/ashare-radar.html");
const base = "file:///" + file.replace(/\\/g, "/");
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const out = path.resolve("../docs/screenshots");
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  pipe: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--no-sandbox", "--no-first-run", "--allow-file-access-from-files"],
});

const errors = [];

async function shot(name, hash, width = 1600, height = 1000, preload, selector = ".card") {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error}`));
  if (preload) await page.evaluateOnNewDocument(preload);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(base + hash, { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector(selector, { timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
}

const holdings = () => {
  localStorage.setItem("bl.watch", JSON.stringify([
    { ts_code: "600519.SH", shares: 100, cost: 1400 },
    { ts_code: "300750.SZ", shares: 200, cost: 180 },
    { ts_code: "688981.SH", shares: 300, cost: 70 },
    { ts_code: "600036.SH", shares: 500, cost: 34 },
    { ts_code: "002594.SZ", shares: 300, cost: 95 },
    { ts_code: "300059.SZ", shares: 1000, cost: 20 },
  ]));
};

await shot("today", "#/");
await shot("en-today", "?lang=en#/");
await shot("market", "#/market");
await shot("regime", "#/regime");
await shot("sectors", "#/sectors");
await shot("stocks", "#/stocks");
await shot("sentiment", "#/sentiment");
await shot("about", "#/about");
await shot("briefing", "#/briefing", 1600, 1200, null, "#root");
await shot("watchlist", "#/watchlist", 1600, 1100, holdings);
await shot("colorblind-today", "#/", 1600, 1000, () => localStorage.setItem("bl.cb", "1"));
await shot("desktop-1920", "#/", 1920, 1080);
await shot("mobile-today", "#/", 390, 844);
await shot("mobile-sectors", "#/sectors", 390, 844);
await shot("mobile-stocks", "#/stocks", 390, 844);

{
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(`stock-detail: ${error}`));
  await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 });
  await page.goto(base + "#/stocks", { waitUntil: "load", timeout: 120000 });
  await page.waitForSelector("input", { timeout: 30000 });
  await page.click("input");
  await page.type("input", "600519", { delay: 30 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const rows = await page.$$("table tbody tr");
  if (rows.length) await rows[0].click();
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await page.screenshot({ path: path.join(out, "stock-detail.png") });
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ shots: 16, errors }, null, 2));
