// 用 Edge/Chrome 无头渲染 dashboard，收集 console 错误并截图。
// 用法: node scripts/shot.mjs <url-or-file> <out.png> [width] [height] [waitSelector]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const [, , target, out = "shot.png", w = "1600", h = "1000", waitSel = ".card"] = process.argv;
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => fs.existsSync(p));

const url = target.startsWith("http") ? target : "file:///" + path.resolve(target).replace(/\\/g, "/");

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  args: ["--disable-gpu", "--hide-scrollbars", "--no-sandbox", "--allow-file-access-from-files"],
  defaultViewport: { width: Number(w), height: Number(h), deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.waitForSelector(waitSel, { timeout: 15000 });
} catch {
  errors.push("selector not found: " + waitSel);
}
await new Promise((r) => setTimeout(r, 1800));
const rootLen = await page.evaluate(() => document.getElementById("root")?.innerHTML.length ?? -1);
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
await page.screenshot({ path: out });
await browser.close();
console.log(JSON.stringify({ url, out, rootLen, errors: errors.slice(0, 12), bodyText }, null, 2));
