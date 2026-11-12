import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
let seq=0;
async function staticApi(payload) {
  globalThis.window={__BL_DATA__:payload};
  const cache = new Map();
  globalThis.localStorage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v)};
  let source=await readFile(new URL('../src/lib/api.ts',import.meta.url),'utf8');
  source=source.replace('"./holdings"',JSON.stringify(new URL('../src/lib/holdings.ts',import.meta.url).href));
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return (await import('data:text/javascript;base64,'+Buffer.from(js+'\n//'+seq++).toString('base64'))).api;
}
const day={trade_date:'2026-06-12',ew_ret:.01};
const payload=()=>({meta:{last_trade_date:day.trade_date},market:[day],market_monthly:[{trade_date:'2026-06-01',ew_ret:.005,ew_ret_cum:.1}],stocks:[{ts_code:'000001.SZ',trade_date:day.trade_date}],watch_pool:[],contrib:{},sectors:{},distribution:{},sector_monthly:[],stock_series:{'000001.SZ':[['2026-06-10',1,2,1,2,100],['2026-06-12',1,3,1,3,100]]}});
test('missing static dates cannot fall back to latest or invented zero stats',async()=>{
  const api=await staticApi(payload());
  assert.throws(()=>api.marketDay('2020-01-01'));
  assert.throws(()=>api.distribution('2020-01-01'));
  assert.throws(()=>api.stocks('2020-01-01'));
});
test('monthly uses exported contract and stock series honors range',async()=>{
  const api=await staticApi(payload());
  assert.equal((await api.marketSeries(undefined,undefined,'month'))[0].ew_ret_cum,.1);
  assert.deepEqual((await api.stockSeries('000001.SZ','2026-06-11')).map(x=>x.trade_date),['2026-06-12']);
});
test('static positions upsert zero and retain codes missing from quote pool',async()=>{
  const api=await staticApi(payload());
  await api.addWatch('000001.SZ',100,10); await api.addWatch('000001.SZ',0,0);
  const rows=await api.watchlist();
  assert.equal(rows.length,1); assert.equal(rows[0].shares,0); assert.equal(rows[0].cost,0);
  assert.equal(rows[0].quote_missing,true);
  assert.throws(()=>api.addWatch('000001.SZ',-1,10));
  assert.throws(()=>api.updateWatch('600000.SH',{shares:1}));
});
test('corrupt stored positions surface an error rather than vanishing',async()=>{
  const api=await staticApi(payload());
  globalThis.localStorage.setItem('bl.watch','[{"ts_code":"000001.SZ","shares":-1,"cost":1}]');
  assert.throws(()=>api.watchlist());
});
test('offline detail and sector history cannot silently return unprovided samples',async()=>{
  const api=await staticApi(payload());
  assert.throws(()=>api.marketDay(day.trade_date));
  assert.throws(()=>api.sectors('2020-01-01'));
});
