// Reference-capture script for design research only.
// Usage: node capture-refs.mjs <list.json> <outDir>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const [, , listPath, outDir] = process.argv;
const targets = JSON.parse(fs.readFileSync(listPath, "utf8"));
const edge = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync(outDir, { recursive: true });

const userDataDir = path.join(process.env.TEMP || ".", "refcap-" + Date.now());
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: "new",
  userDataDir,
  args: [
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-sandbox",
    "--lang=zh-CN",
    "--disable-blink-features=AutomationControlled",
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

const results = [];
for (const t of targets) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
  );
  await page.setExtraHTTPHeaders({ "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" });
  const rec = { slug: t.slug, url: t.url, ok: false };
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // let client-side charts settle
    await new Promise((r) => setTimeout(r, t.wait ?? 4500));
    if (t.scroll) {
      await page.evaluate((y) => window.scrollTo(0, y), t.scroll);
      await new Promise((r) => setTimeout(r, 1500));
    }
    rec.title = await page.title();
    rec.finalUrl = page.url();
    const file = path.join(outDir, `${t.slug}.png`);
    await page.screenshot({ path: file });
    rec.file = file;
    rec.ok = true;
    // short text fingerprint to detect login walls / blocks
    rec.text = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").slice(0, 160);
  } catch (e) {
    rec.error = String(e).slice(0, 200);
  }
  results.push(rec);
  console.log(JSON.stringify(rec));
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, "_capture-log.json"), JSON.stringify(results, null, 2));
console.log("DONE " + results.filter((r) => r.ok).length + "/" + results.length);
