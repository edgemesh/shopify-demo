import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationMetrics, documentResponseTiming, cacheToggleUrl, cacheOutcome, isLikelyFreshLiquidRender, liquidRenderAge, formatMilliseconds } from '../assets/edgemesh-metrics.js';

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
test('uses known Edgemesh config and never invents a hit from another CDN', () => {
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
    status: 'hit', label: 'HIT', source: 'Edgemesh Server-Timing (ems-cache-hit)',
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

test('fresh-render inference accepts either high TTFB or a recent response timestamp', () => {
  const options = { bypassed: true, renderedAt: '1700000000', receivedAtMs: 1700000042000 };
  const nav = { startTime: 0, requestStart: 10, responseStart: 40, finalResponseHeadersStart: 700 };
  assert.equal(isLikelyFreshLiquidRender(nav, options), true);
  assert.equal(isLikelyFreshLiquidRender({ ...nav, finalResponseHeadersStart: 699 }, options), false);
  const fast = { ...nav, finalResponseHeadersStart: 100 };
  assert.equal(isLikelyFreshLiquidRender(fast, { ...options, receivedAtMs: 1700000005000 }), true);
  assert.equal(isLikelyFreshLiquidRender(fast, { ...options, receivedAtMs: 1700000005001 }), false);
  assert.equal(isLikelyFreshLiquidRender(fast, { ...options, receivedAtMs: 1700000000000 }), true);
});

test('fresh-render inference is disabled for enabled cache, cache hits, and history restores', () => {
  const options = { bypassed: true, renderedAt: '1700000000', receivedAtMs: 1700000001000 };
  const nav = { startTime: 0, requestStart: 10, finalResponseHeadersStart: 1000 };
  assert.equal(isLikelyFreshLiquidRender(nav, { ...options, bypassed: false }), false);
  assert.equal(isLikelyFreshLiquidRender(nav, { ...options, restoredFromHistory: true }), false);
  assert.equal(isLikelyFreshLiquidRender({ ...nav, deliveryType: 'cache' }, options), false);
  assert.equal(isLikelyFreshLiquidRender({ ...nav, serverTiming: [{ name: 'ems-cache-hit' }] }, options), false);
  assert.equal(isLikelyFreshLiquidRender(nav, { ...options, cache: { status: 'hit' } }), false);
});

test('missing or future timestamps cannot qualify as recent, but high TTFB still stands alone', () => {
  const options = { bypassed: true, receivedAtMs: 1700000000000 };
  const fast = { startTime: 0, requestStart: 10, finalResponseHeadersStart: 100 };
  for (const renderedAt of [undefined, '', 'invalid', '1700000001']) {
    assert.equal(isLikelyFreshLiquidRender(fast, { ...options, renderedAt }), false);
    assert.equal(isLikelyFreshLiquidRender({ ...fast, finalResponseHeadersStart: 900 }, { ...options, renderedAt }), true);
  }
  assert.equal(isLikelyFreshLiquidRender(undefined, options), false);
  assert.equal(isLikelyFreshLiquidRender(fast, { bypassed: true, renderedAt: '1700000000' }), false);
});

test('Liquid timestamp age is approximate across seconds, minutes, hours, and days', () => {
  const renderedAt = '1700000000';
  for (const [elapsed, label] of [[0, '<1s'], [0.9, '<1s'], [42, '≈42s'], [59.9, '≈59s'], [60, '≈1m'], [3599, '≈59m'], [3600, '≈1h'], [86400, '≈1d']]) {
    const result = liquidRenderAge(renderedAt, (1700000000 + elapsed) * 1000);
    assert.equal(result.label, `Liquid rendered ${label} ago`);
    assert.equal(result.status, 'timestamp');
    assert.equal(result.timestamp, '2023-11-14T22:13:20.000Z');
    assert.equal(result.ageSeconds, elapsed);
    assert.match(result.detail, /approximate/);
  }
});

test('invalid or missing Liquid timestamps cannot look like a recent render', () => {
  for (const value of [null, undefined, '', ' ', 'bad', '0', '-1', '1700000000.5', '1e9', '9999999999999999', '9999999999999']) {
    const result = liquidRenderAge(value, 1700000042000);
    assert.equal(result.status, 'unknown');
    assert.equal(result.label, 'Liquid render age unavailable');
  }
  assert.equal(liquidRenderAge('1700000000', NaN).status, 'unknown');
});

test('a timestamp ahead of the browser clock is flagged instead of clamped to fresh', () => {
  const result = liquidRenderAge('1700000001', 1700000000000);
  assert.equal(result.status, 'unknown');
  assert.equal(result.label, 'Liquid render clock difference');
  assert.match(result.detail, /ahead of your device clock/);
});
