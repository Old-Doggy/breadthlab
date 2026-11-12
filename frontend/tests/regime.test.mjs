import test from 'node:test';
import assert from 'node:assert/strict';
import { headline, verdict, regimeOf } from '../src/lib/regime.ts';
const day = {ew_ret: .01, breadth:.4, hs300_ret:-.02, top10_share:.6};
test('headline never calls negative or missing index rising', () => {
 assert.doesNotMatch(headline(day,'zh'), /指数在涨/);
 assert.doesNotMatch(headline({...day,hs300_ret:null},'zh'), /指数几乎没动/);
});
test('verdict describes observed EW instead of inferring index cause', () => {
 assert.doesNotMatch(verdict(day,'zh'), /沪深300 收涨|指数涨跌|权重股/);
});
test('undefined breadth stays unknown rather than broad selloff', () => {
 assert.equal(regimeOf({...day,breadth:null}), 'unknown');
});
