import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationMetrics, documentResponseTiming, cacheToggleUrl, cacheOutcome, formatMilliseconds } from '../assets/edgemesh-metrics.js';

test('reports distinct navigation milestones and waits for load to finish', () => {
  const nav = { startTime: 0, requestStart: 35, responseStart: 135, responseEnd: 155, loadEventEnd: 700 };
  assert.deepEqual(navigationMetrics(nav), { ttfb: 135, request: 100, response: 20, load: 700 });
  assert.equal(navigationMetrics({ ...nav, loadEventEnd: 0 }).load, null);
  assert.equal(navigationMetrics({ ...nav, responseEnd: 80 }).response, null);
  assert.deepEqual(navigationMetrics(), { ttfb: null, request: null, response: null, load: null });
});
test('103 Early Hints do not underreport document wait or inflate download time', () => {
  const nav = {
    startTime: 0, requestStart: 12, responseStart: 47, firstInterimResponseStart: 47,
    finalResponseHeadersStart: 761, responseEnd: 786, loadEventEnd: 1100,
  };
  assert.deepEqual(documentResponseTiming(nav), { start: 761, source: 'final' });
  assert.deepEqual(navigationMetrics(nav), { ttfb: 761, request: 749, response: 25, load: 1100 });
});
test('final response without Early Hints preserves the usual navigation intervals', () => {
  const nav = {
    startTime: 0, requestStart: 35, responseStart: 135, firstInterimResponseStart: 0,
    finalResponseHeadersStart: 135, responseEnd: 155, loadEventEnd: 700,
  };
  assert.equal(documentResponseTiming(nav).source, 'final');
  assert.deepEqual(navigationMetrics(nav), { ttfb: 135, request: 100, response: 20, load: 700 });
});
test('known interim responses are never used when the final milestone is unavailable', () => {
  const nav = {
    startTime: 0, requestStart: 12, responseStart: 47, firstInterimResponseStart: 47,
    responseEnd: 786, loadEventEnd: 1100,
  };
  for (const finalResponseHeadersStart of [undefined, 0, -1, NaN, Infinity, 30]) {
    const entry = { ...nav, finalResponseHeadersStart };
    assert.equal(documentResponseTiming(entry).source, 'unavailable');
    assert.deepEqual(navigationMetrics(entry), { ttfb: null, request: null, response: null, load: 1100 });
  }
});
test('older browsers have an explicit first-response fallback, not a claimed final measurement', () => {
  const nav = { startTime: 0, requestStart: 35, responseStart: 135, responseEnd: 155, loadEventEnd: 700 };
  assert.deepEqual(documentResponseTiming(nav), { start: 135, source: 'first-response' });
  assert.deepEqual(navigationMetrics(nav), { ttfb: 135, request: 100, response: 20, load: 700 });
  assert.deepEqual(documentResponseTiming(), { start: null, source: 'unavailable' });
});
test('navigation setup remains distinct from request wait and zero-duration transfer is valid', () => {
  const nav = {
    startTime: 0, requestStart: 500, responseStart: 600, finalResponseHeadersStart: 600,
    responseEnd: 600, loadEventEnd: 800,
  };
  assert.deepEqual(navigationMetrics(nav), { ttfb: 600, request: 100, response: 0, load: 800 });
});
test('cache control preserves path, locale, preview, variants, other parameters and hash', () => {
  const url = 'https://demo.edgemesh.com/fr/products/signal?preview_theme_id=123&variant=456&utm_source=demo#details';
  const off = cacheToggleUrl(url);
  assert.equal(off.searchParams.get('em-bypass'), 'all');
  assert.equal(off.searchParams.get('preview_theme_id'), '123');
  assert.equal(off.searchParams.get('variant'), '456');
  assert.equal(off.pathname, '/fr/products/signal');
  assert.equal(off.hash, '#details');
  assert.equal(cacheToggleUrl(off.href).href, url);
});
test('cache control normalizes partial and duplicate bypass parameters', () => {
  assert.equal(cacheToggleUrl('https://demo.edgemesh.com/?em-bypass=cache').searchParams.get('em-bypass'), 'all');
  assert.equal(cacheToggleUrl('https://demo.edgemesh.com/?em-bypass=all&em-bypass=cache').searchParams.has('em-bypass'), false);
});
test('prefers authoritative navigation cache status to potentially cached HTML configuration', () => {
  const nav = { serverTiming: [{ name: 'edgemesh-cache', description: 'HIT;T0' }] };
  assert.deepEqual(cacheOutcome(nav, { schemaVersion: 1, cache: { status: 'hit', level: 'L1' } }), { status: 'hit', label: 'HIT · L0', source: 'Server-Timing' });
  assert.equal(cacheOutcome({ serverTiming: [{ name: 'edgemesh-cache', description: 'BYPASS' }] }).status, 'bypass');
});
test('uses known EdgeMesh config and never invents a hit from another CDN', () => {
  assert.equal(cacheOutcome(null, { schemaVersion: 1, cache: { status: 'miss' } }).label, 'MISS');
  assert.equal(cacheOutcome({ serverTiming: [{ name: 'cfCacheStatus', description: 'HIT' }] }).label, 'Not reported');
  assert.equal(cacheOutcome({ serverTiming: [{ name: 'edgemesh-cache', description: 'HIT;T9' }] }).status, 'unknown');
  assert.equal(cacheOutcome(null, { schemaVersion: 1, cache: { status: '<b>HIT</b>' } }).status, 'unknown');
});
test('recognizes the deployed worker’s legacy cache timing before HTML configuration', () => {
  const navigation = { serverTiming: [
    { name: 'processing', duration: 73 },
    { name: 'ems-cache-hit', description: '[EM] Cache Hit' },
  ] };
  assert.deepEqual(cacheOutcome(navigation, { schemaVersion: 1, cache: { status: 'miss' } }), {
    status: 'hit', label: 'HIT', source: 'EdgeMesh Server-Timing (ems-cache-hit)',
  });
  const miss = cacheOutcome({ serverTiming: [{ name: 'ems-cache-miss', description: '[EM] Cache Miss' }] });
  assert.equal(miss.label, 'MISS');
  assert.match(miss.source, /bypassed requests/);
});
test('the newer cache outcome takes precedence when both worker formats are present', () => {
  assert.equal(cacheOutcome({ serverTiming: [
    { name: 'edgemesh-cache', description: 'BYPASS' },
    { name: 'ems-cache-miss', description: '[EM] Cache Miss' },
  ] }).status, 'bypass');
  assert.equal(cacheOutcome({ serverTiming: [
    { name: 'ems-cache-miss', description: '[EM] Cache Miss' },
    { name: 'ems-cache-hit', description: '[EM] Cache Hit' },
  ] }).status, 'hit');
});
test('formats valid zeroes and never turns missing or nonfinite values into zero', () => {
  assert.deepEqual(formatMilliseconds(0), { value: '0', unit: 'ms' });
  assert.deepEqual(formatMilliseconds(1350), { value: '1.35', unit: 's' });
  for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(formatMilliseconds(value), null);
});
