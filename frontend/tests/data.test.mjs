import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

globalThis.window = { location: { search: '' } };
globalThis.localStorage = { getItem: () => null };
const { money } = await import('../src/lib/format.ts');
test('English money uses billion and thousand units', () => {
  assert.equal(money(1e9, 'en'), '¥1.0B');
  assert.equal(money(1000, 'en'), '¥1K');
  assert.equal(money(1e8, 'en'), '¥100.0M');
});
test('nonfinite money is unknown', () => assert.equal(money(Infinity, 'en'), '—'));
test('holdings use starting value and preserve unknown day pnl', async () => {
  const { holdingMetrics, portfolioReturn } = await import('../src/lib/holdings.ts');
  const a = holdingMetrics({ shares: 100, cost: 8, close: 11, pre_close: 10, ret: .1 });
  const b = holdingMetrics({ shares: 100, cost: 8, close: 9, pre_close: 10, ret: -.1 });
  assert.equal(a.today, 100);
  assert.equal(a.startMv, 1000);
  assert.equal(portfolioReturn([a, b]), 0);
  assert.equal(holdingMetrics({ shares: 100, cost: 8, close: 10, ret: 0, is_stale: true }).today, null);
});
test('CSV supports quoted fields and rejects invalid quantities before writing', async () => {
  const { parseWatchCsv } = await import('../src/lib/holdings.ts');
  assert.deepEqual(parseWatchCsv('\ufeffts_code,shares,cost\r\n"000001.SZ","100","10.5"\r\n'), [{ts_code:'000001.SZ',shares:100,cost:10.5}]);
  assert.throws(() => parseWatchCsv('ts_code,shares,cost\n000001.SZ,-1,10'));
  assert.throws(() => parseWatchCsv('ts_code,shares,cost\n000001.SZ,NaN,10'));
});
test('tooltip preserves minus sign and escapes upstream names', async () => {
  const themeSource=await readFile(new URL('../src/lib/theme.ts',import.meta.url),'utf8');
  const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const themeUrl='data:text/javascript;base64,'+Buffer.from(transpile(themeSource)).toString('base64');
  let source = await readFile(new URL('../src/lib/charts5.ts', import.meta.url), 'utf8');
  source=source.replace('"./theme"',JSON.stringify(themeUrl)).replace('"./holdings"',JSON.stringify(new URL('../src/lib/holdings.ts',import.meta.url).href));
  const {contributionChart}=await import('data:text/javascript;base64,'+Buffer.from(transpile(source)).toString('base64'));
  const {paletteFor}=await import(themeUrl);
  const option=contributionChart(paletteFor('dark',false),[{shares:100,today:-123,name:'<img src=x>',ret:-.1}]);
  const html=option.tooltip.formatter({data:{name:'<img src=x>',value:-123,ret:-.1}});
  assert.match(html,/−¥123/);
  assert.match(html,/&lt;img src=x&gt;/);
  assert.ok(!html.includes('<img'));
});
