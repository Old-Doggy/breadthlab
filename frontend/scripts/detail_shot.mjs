// 打开个股详情（搜索 600519）并截图，用于校验 K 线。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("dist/BreadthLab.html");
const url = "file:///" + file.replace(/\\/g, "/") + "#/stocks";
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  pipe: true,
  args: ["--disable-gpu", "--no-sandbox", "--no-first-run", "--allow-file-access-from-files"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("input", { timeout: 15000 });
await page.click("input");
await page.type("input", "600519", { delay: 30 });
await new Promise((r) => setTimeout(r, 800));
const rows = await page.$$("table tbody tr");
if (rows.length) await rows[0].click();
await new Promise((r) => setTimeout(r, 1500));
const dbg = await page.evaluate(() => {
  const d = window.__BL_DATA__;
  return {
    hasSeries: !!d?.stock_series,
    len: d?.stock_series?.["600519.SH"]?.length ?? -1,
    fallback: document.body.innerText.includes("静态模式"),
    canvases: document.querySelectorAll("canvas").length,
  };
});
console.log(JSON.stringify(dbg));
await page.screenshot({ path: "../data/meta/shot_stock_detail.png" });
await browser.close();
console.log(JSON.stringify({ rows: rows.length, errors }, null, 2));
