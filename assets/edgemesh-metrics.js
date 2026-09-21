// Pure helpers shared by the timing panel and its tests.
export function documentResponseTiming(navigation) {
  if (!navigation) return { start: null, source: 'unavailable' };
  const finalStart = navigation.finalResponseHeadersStart;
  if (Number.isFinite(finalStart) && finalStart > 0 && finalStart >= navigation.requestStart &&
      (!navigation.responseStart || finalStart >= navigation.responseStart)) {
    return { start: finalStart, source: 'final' };
  }
  // Never substitute a known 1xx response for the missing final response.
  if (navigation.firstInterimResponseStart > 0) return { start: null, source: 'unavailable' };
  // Older browsers do not expose the final-header milestone. Identify this
  // fallback in the UI because responseStart can include 103 Early Hints.
  return Number.isFinite(navigation.responseStart) && navigation.responseStart > 0
    ? { start: navigation.responseStart, source: 'first-response' }
    : { start: null, source: 'unavailable' };
}

export function navigationMetrics(navigation) {
  if (!navigation) return { ttfb: null, request: null, response: null, load: null };
  const response = documentResponseTiming(navigation);
  const delta = (end, start) => Number.isFinite(end) && Number.isFinite(start) && start >= 0 && end > 0 && end >= start ? end - start : null;
  return {
    ttfb: delta(response.start, navigation.startTime),
    request: delta(response.start, navigation.requestStart),
    response: delta(navigation.responseEnd, response.start),
    load: delta(navigation.loadEventEnd, navigation.startTime),
  };
}

export function cacheToggleUrl(href) {
  const url = new URL(href);
  if (url.searchParams.getAll('em-bypass').includes('all')) url.searchParams.delete('em-bypass');
  else url.searchParams.set('em-bypass', 'all');
  return url;
}

export function cacheOutcome(navigation, config) {
  // Support both EdgeMesh worker contracts; other CDNs' HIT headers are
  // not evidence of an EdgeMesh cache hit. Prefer navigation timing over HTML
  // configuration because the service worker may have supplied an L0 response.
  const entries = Array.from(navigation?.serverTiming || []).reverse();
  const timing = entries.find((entry) => entry.name.toLowerCase() === 'edgemesh-cache');
  if (timing) {
    const value = timing.description.trim().toUpperCase();
    const hit = /^HIT;\s*T([012])$/.exec(value);
    if (hit) return { status: 'hit', label: `HIT · L${hit[1]}`, source: 'Server-Timing' };
    if (['MISS', 'BYPASS', 'REVALIDATED'].includes(value)) return { status: value.toLowerCase(), label: value, source: 'Server-Timing' };
  }
  const legacyTiming = entries.find((entry) => ['ems-cache-hit', 'ems-cache-miss'].includes(entry.name.toLowerCase()));
  if (legacyTiming) {
    const hit = legacyTiming.name.toLowerCase() === 'ems-cache-hit';
    return {
      status: hit ? 'hit' : 'miss',
      label: hit ? 'HIT' : 'MISS',
      source: hit ? 'EdgeMesh Server-Timing (ems-cache-hit)' : 'EdgeMesh Server-Timing (ems-cache-miss; also reported for bypassed requests)',
    };
  }
  const cache = config?.cache;
  if (config?.schemaVersion === 1 && ['hit', 'miss', 'bypass', 'revalidated'].includes(cache?.status)) {
    const level = cache.status === 'hit' && ['L0', 'L1', 'L2'].includes(cache.level) ? ` · ${cache.level}` : '';
    return { status: cache.status, label: cache.status.toUpperCase() + level, source: 'EdgeMesh runtime configuration' };
  }
  return { status: 'unknown', label: 'Not reported', source: 'No EdgeMesh cache outcome exposed for this navigation' };
}

export function formatMilliseconds(value) {
  if (!Number.isFinite(value) || value < 0) return null;
  return value >= 1000 ? { value: (value / 1000).toFixed(2), unit: 's' } : { value: Math.round(value).toString(), unit: 'ms' };
}
