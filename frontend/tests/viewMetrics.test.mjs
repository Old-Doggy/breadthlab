import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativePath, median, percentile, quoteAgeDays, indexSummary, hasDataWarnings } from '../src/lib/viewMetrics.ts';

test('source warnings prevent an all-clear label even when every gate passes', () => {
  assert.equal(hasDataWarnings({warnings: ['events unavailable']}, [{pass: true}]), true);
  assert.equal(hasDataWarnings({warnings: []}, [{pass: true}]), false);
});
test('monthly path compounds monthly returns and never bridges missing months', () => {
  assert.deepEqual(cumulativePath([.1, -.1]), [.10000000000000009, -.009999999999999898]);
  assert.deepEqual(cumulativePath([.1, null, .2]), [.10000000000000009, null, null]);
});
test('median averages two central observations', () => assert.equal(median([.2,.8]), .5));
test('quote age uses Shanghai close and counts calendar days honestly', () => {
  assert.equal(quoteAgeDays('2026-11-10', Date.parse('2026-11-11T08:00:00Z')), 1);
});
test('missing CSI300 is unavailable and narrative does not assert direction', () => {
  assert.match(indexSummary(null, .01, 'en'), /unavailable/);
  assert.doesNotMatch(indexSummary(-.01, .02, 'en'), /drag|small caps/);
});

test('unknown breadth never becomes zero in percentiles', () => {
  assert.equal(percentile([null, .2, .4], null), null);
  assert.equal(percentile([null, .2, .4], .2), 50);
});
