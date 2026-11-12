// Run only against an isolated data copy and its single-file export.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [copyDirectory, base = 'http://127.0.0.1:8018'] = process.argv.slice(2);
if (!copyDirectory || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('copy directory and loopback URL required');
const root = resolve(copyDirectory);
const browser = await puppeteer.launch({executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, pipe:true, args:['--no-first-run','--do-not-de-elevate','--edge-skip-compat-layer-relaunch']});
const report = {routes: [], errors: [], offlineExternalRequests: []};
let apiSamples;
const pause = ms => new Promise(r => setTimeout(r, ms));
try {
  for (const mode of ['api', 'file']) {
    const page = await browser.newPage();
    await page.setViewport({width:1440, height:1050});
    page.on('pageerror', error => report.errors.push({mode, message:error.message}));
    page.on('requestfailed', req => report.errors.push({mode,url:req.url(),message:req.failure()?.errorText}));
    page.on('console', msg => {if(msg.type() === 'error') report.errors.push({mode, message:msg.text()});});
    if (mode === 'file') {
      page.on('request', req => {if (/^https?:/.test(req.url())) report.offlineExternalRequests.push(req.url());});
      const cdp = await page.createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    }
    const url = mode === 'api' ? base : pathToFileURL(join(root, 'web', 'BreadthLab.html')).href;
    await page.goto(url, {waitUntil:'networkidle0'});
    if(mode === 'api') {
      apiSamples = await page.evaluate(async () => {
        const monthly = await fetch('/api/market/series?freq=month').then(r=>r.json());
        const daily = await fetch('/api/market/series?freq=day').then(r=>r.json());
        return {monthly,daily};
      });
    } else {
      const staticSamples = await page.evaluate(() => ({monthly:window.__BL_DATA__.market_monthly,daily:window.__BL_DATA__.market}));
      let differences=0;
      for(const key of ['monthly','daily']) {
        if(apiSamples[key].length !== staticSamples[key].length) differences++;
        apiSamples[key].forEach((row,i) => {
          for(const [field,value] of Object.entries(row)) {
            const actual = staticSamples[key][i]?.[field];
            if(typeof value === 'number' && typeof actual === 'number' ? Math.abs(value-actual)>0.0000011 : value !== actual) differences++;
          }
        });
      }
      report.apiStaticParity={dailyRows:apiSamples.daily.length,monthlyRows:apiSamples.monthly.length,differences};
    }
    for (const route of ['/', '/market', '/regime', '/sectors', '/stocks', '/sentiment', '/watchlist', '/about', '/briefing', '/labs']) {
      await page.evaluate(route => {location.hash='#'+route;}, route);
      await pause(1800);
      report.routes.push(await page.evaluate(({mode,route}) => ({mode,route,charts:document.querySelectorAll('canvas').length,
        alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent),invalid:/NaN|Infinity/.test(document.querySelector('main')?.innerText||'')}), {mode,route}));
    }
    if(mode === 'file') {
      // Test-only browser profile; this never reads personal saved positions.
      await page.evaluate(() => localStorage.setItem('bl.watch', JSON.stringify([{ts_code:'000001.SZ',shares:100,cost:10}])));
      await page.goto(url+'#/watchlist', {waitUntil:'networkidle0'});
      await page.reload({waitUntil:'networkidle0'});
      await pause(800);
      report.offlinePosition = await page.evaluate(() => ({visible:document.querySelector('main')?.innerText.includes('000001'), charts:document.querySelectorAll('canvas').length}));
    }
    await page.goto(url+'?lang=en#/market', {waitUntil:'networkidle0'});
    await pause(700);
    await page.click('button[title="Colorblind palette (blue/orange)"]');
    await page.click('button[aria-label="Theme"]');
    await pause(1200);
    report[mode+'Appearance'] = await page.evaluate(() => ({theme:document.documentElement.dataset.theme,colorblind:document.documentElement.dataset.cb,heading:document.querySelector('h1')?.innerText}));
    await page.screenshot({path:join(root, mode+'-market.png'),fullPage:true});
    await pause(1500);
    await page.screenshot({path:join(root, mode+'-market-viewport.png')});
    if(mode === 'file') {
      await page.reload({waitUntil:'networkidle0'});
      await pause(2000);
      await page.screenshot({path:join(root,'file-market-reload.png'),fullPage:true});
    }
    await page.close();
  }
  report.passed = !report.errors.length && !report.offlineExternalRequests.length && !report.apiStaticParity.differences && report.routes.every(r=>!r.alerts.length&&!r.invalid) && report.offlinePosition.visible;
  writeFileSync(join(root,'meta','browser-acceptance.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(!report.passed) process.exitCode=1;
} finally {await browser.close();}
