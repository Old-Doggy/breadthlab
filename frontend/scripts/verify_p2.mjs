// P2 验证：导出按钮、色盲开关、URL 状态、双语。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const file = path.resolve("dist/ashare-radar.html");
const base = "file:///" + file.replace(/\\/g, "/");
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  pipe: true,
  args: ["--disable-gpu", "--no-sandbox", "--no-first-run", "--allow-file-access-from-files"],
  defaultViewport: { width: 1500, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const out = {};

await page.goto(base + "#/sectors", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".card", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));
out.exportButtons = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter((b) => /^(PNG|CSV)$/.test(b.textContent.trim())).length,
);
await page.goto(base + "#/market?range=3Y", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".card", { timeout: 15000 });
out.urlRange = await page.evaluate(() => window.location.hash);
out.rangeButtons = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter((b) => ["1M", "3M", "6M", "1Y", "3Y", "ALL"].includes(b.textContent.trim())).length,
);

await page.goto(base + "#/stocks?lang=en", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("table tbody tr", { timeout: 15000 });
out.csvButton = await page.evaluate(() =>
  [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "CSV"),
);

await page.goto(base + "#/", { waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".card", { timeout: 15000 });
out.cbBefore = await page.evaluate(() => document.documentElement.dataset.cb);
const toggled = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") !== null);
  if (!btn) return false;
  btn.click();
  return true;
});
await new Promise((r) => setTimeout(r, 300));
out.cbToggleFound = toggled;
out.cbAfter = await page.evaluate(() => document.documentElement.dataset.cb);
out.upColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--up").trim());

await browser.close();
out.errors = errors.slice(0, 5);
out.passed =
  out.exportButtons >= 1 && out.csvButton && out.cbToggleFound && out.cbAfter === "1" && out.errors.length === 0;
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync("../data/meta/verify_p2.json", JSON.stringify(out, null, 2));
process.exit(out.passed ? 0 : 1);
