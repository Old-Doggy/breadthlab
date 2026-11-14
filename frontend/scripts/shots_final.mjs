// 最终截图：英文首页 + 色盲模式首页
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
  defaultViewport: { width: 1600, height: 1500 },
});

const errors = [];

// 1) English
{
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "?lang=en#/", { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".card", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: "../data/meta/en-today.png" });
  await page.close();
}

// 2) Colorblind
{
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => localStorage.setItem("bl.cb", "1"));
  await page.goto(base + "#/", { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector(".card", { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: "../data/meta/cb-today.png" });
  await page.close();
}

await browser.close();
console.log(JSON.stringify({ errors }, null, 2));
