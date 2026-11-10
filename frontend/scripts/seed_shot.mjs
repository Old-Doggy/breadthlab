// 预置自选后截图（演示持仓表）。用法: node scripts/seed_shot.mjs
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("dist/BreadthLab.html");
const url = "file:///" + file.replace(/\\/g, "/") + "#/watchlist";
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  pipe: true,
  args: ["--disable-gpu", "--no-sandbox", "--no-first-run", "--allow-file-access-from-files"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => {
  const seed = {
    ts_code: "",
  };
  const items = [
    { ts_code: "600519.SH", shares: 100, cost: 1400 },
    { ts_code: "300750.SZ", shares: 200, cost: 180 },
    { ts_code: "688981.SH", shares: 300, cost: 70 },
    { ts_code: "600036.SH", shares: 500, cost: 34 },
    { ts_code: "002594.SZ", shares: 300, cost: 95 },
    { ts_code: "300059.SZ", shares: 1000, cost: 20 },
  ];
  localStorage.setItem("bl.watch", JSON.stringify(items));
  void seed;
});
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("table tbody tr", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: "../data/meta/shot_watchlist.png" });
await browser.close();
console.log(JSON.stringify({ errors }, null, 2));
