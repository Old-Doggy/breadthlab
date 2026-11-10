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

const url = /^(https?|file):/.test(target) ? target : "file:///" + path.resolve(target).replace(/\\/g, "/");

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  pipe: true,
  args: ["--disable-gpu", "--hide-scrollbars", "--no-sandbox", "--no-first-run", "--allow-file-access-from-files"],
  defaultViewport: { width: Number(w), height: Number(h), deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url().slice(0, 120)));

await page.evaluateOnNewDocument(() => {
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push(String(e.message || e)));
  window.addEventListener("unhandledrejection", (e) => window.__errs.push("rej: " + String(e.reason)));
});

await page.goto(url, { waitUntil: "load", timeout: 120000 });
try {
  await page.waitForSelector(waitSel, { timeout: 20000 });
} catch {
  errors.push("selector not found: " + waitSel);
}
await new Promise((r) => setTimeout(r, 2200));

const diag = await page.evaluate(() => ({
  hasData: !!window.__BL_DATA__,
  dataKeys: window.__BL_DATA__ ? Object.keys(window.__BL_DATA__) : [],
  marketRows: window.__BL_DATA__?.market?.length ?? 0,
  rootLen: document.getElementById("root")?.innerHTML.length ?? -1,
  scripts: document.scripts.length,
  errs: window.__errs?.slice(0, 8) ?? [], ran: window.__RAN__ ?? null, ran2: window.__RAN2__ ?? null,
  text: document.body.innerText.slice(0, 200),
}));
await page.screenshot({ path: out });
await browser.close();
console.log(JSON.stringify({ url, out, diag, errors: errors.slice(0, 12) }, null, 2));
