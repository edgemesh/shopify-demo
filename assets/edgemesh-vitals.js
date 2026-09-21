import { navigationMetrics, documentResponseTiming, cacheToggleUrl, cacheOutcome, isLikelyFreshLiquidRender, liquidRenderAge, formatMilliseconds } from '@edgemesh/metrics';

let restoredFromHistory = false;
const firstObservedAt = Date.now();
function cacheIsDisabled() { return new URL(window.location.href).searchParams.getAll('em-bypass').includes('all'); }
function navigation() { return performance.getEntriesByType('navigation')[0]; }
function config() {
  const text = document.querySelector('script[type="application/edgemesh+json"]')?.textContent;
  if (!text || text.length > 16384) return null;
  try { return JSON.parse(text); } catch { return null; }
}
function displayMetric(name, value, unavailable = 'N/A') {
  const node = document.querySelector(`[data-em-vital="${name}"]`);
  if (!node) return;
  const formatted = restoredFromHistory ? null : formatMilliseconds(value);
  const loading = !restoredFromHistory && !formatted && unavailable === 'loading';
  node.setAttribute('aria-busy', String(loading));
  node.replaceChildren();
  if (loading) {
    const template = document.getElementById('em-stat-loading-template');
    if (template) node.append(template.content.cloneNode(true));
    else node.textContent = 'Loading';
    return;
  }
  if (!formatted) { node.textContent = restoredFromHistory ? '—' : unavailable; return; }
  node.append(document.createTextNode(formatted.value));
  const unit = document.createElement('small');
  unit.textContent = formatted.unit;
  node.append(unit);
}
function renderLiquid(entry = navigation(), outcome = cacheOutcome(entry, config())) {
  const liquidStatus = document.querySelector('[data-em-liquid-render]');
  const liquidNote = document.querySelector('[data-em-liquid-render-note]');
  if (!liquidStatus) return;
  const renderedAt = liquidStatus.getAttribute('data-em-rendered-at');
  const age = liquidRenderAge(renderedAt, Date.now());
  const bypassed = cacheIsDisabled();
  // Classify the original response, not the increasing time spent on this page.
  const receivedAtMs = Number.isFinite(performance.timeOrigin) && entry?.responseEnd > 0
    ? performance.timeOrigin + entry.responseEnd : firstObservedAt;
  const fresh = isLikelyFreshLiquidRender(entry, { bypassed, restoredFromHistory, renderedAt, receivedAtMs, cache: outcome });
  const showStatus = bypassed && !restoredFromHistory;
  const label = fresh ? 'Likely fresh render' : 'Possibly stale';
  const hint = fresh
    ? '“Likely fresh render” means TTFB ≥700 ms or a Liquid timestamp within 5 seconds of the response. This is an estimate.'
    : '“Possibly stale” means a fresh Liquid render was not indicated for this load. This is an estimate, not proof of outdated content.';
  liquidStatus.setAttribute('aria-busy', 'false');
  liquidStatus.hidden = !showStatus;
  liquidStatus.textContent = showStatus ? label : '';
  liquidStatus.dataset.state = showStatus ? fresh ? 'rendered' : 'unconfirmed' : 'unknown';
  liquidStatus.title = showStatus ? hint : '';
  if (liquidNote) {
    liquidNote.textContent = `${age.label}. ${age.detail}` + (restoredFromHistory ? ' Restored from browser history.' : bypassed ? ` ${hint}` : '');
    liquidNote.title = age.timestamp ? `Liquid timestamp: ${age.timestamp}` : '';
  }
}
function render() {
  const entry = navigation();
  const response = documentResponseTiming(entry);
  for (const [name, value] of Object.entries(navigationMetrics(entry))) {
    displayMetric(name, value, name === 'load' && entry ? 'loading' : 'N/A');
  }
  const milestone = (name) => entry?.[name] > 0 ? entry[name] - entry.startTime : null;
  for (const [name, value] of Object.entries({
    'first-response': milestone('responseStart'),
    'final-headers': milestone('finalResponseHeadersStart'),
    'request-start': milestone('requestStart'),
    'response-end': milestone('responseEnd'),
  })) displayMetric(name, value, 'N/A');
  const timingNote = document.querySelector('[data-em-response-timing-note]');
  if (timingNote) {
    timingNote.textContent = restoredFromHistory ? 'Reload to inspect a new navigation.' : response.source === 'final'
      ? 'Using final document headers. Any interim response, such as HTTP 103 Early Hints, is excluded from the document boundary.'
      : response.source === 'first-response'
        ? 'This browser does not expose final document timing. TTFB and request/response times use the first response instead, which may include Early Hints.'
        : 'Final document timing is unavailable. Known interim responses are not used as the document boundary.';
  }
  const ttfbLabel = document.querySelector('[data-em-ttfb-label]');
  if (ttfbLabel) ttfbLabel.textContent = response.source === 'first-response' ? 'TTFB ≈' : 'TTFB';
  const outcome = cacheOutcome(entry, config());
  renderLiquid(entry, outcome);
  const cache = document.querySelector('[data-em-cache-status]');
  if (cache) {
    cache.setAttribute('aria-busy', 'false');
    cache.textContent = restoredFromHistory ? 'History restore' : outcome.label;
    cache.dataset.state = restoredFromHistory ? 'unknown' : outcome.status;
    cache.title = outcome.source;
  }
}
function measureTti() {
  if (!window.edgemeshTti) { displayMetric('tti', null, 'N/A'); return; }
  window.edgemeshTti.measure().then((value) => displayMetric('tti', value, 'N/A')).catch(() => displayMetric('tti', null, 'N/A'));
}
function updateToggle() {
  const button = document.querySelector('[data-em-cache-toggle]');
  if (button) {
    const bypassed = cacheIsDisabled();
    button.querySelector('[data-em-cache-label]').textContent = bypassed ? 'Enable cache' : 'Disable cache';
    button.title = bypassed ? 'Remove em-bypass=all and reload this page' : 'Add em-bypass=all and reload this page';
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
  }
  return button;
}
function init() {
  const aboutToggle = document.querySelector('[data-em-vitals-about-toggle]');
  const about = document.querySelector('[data-em-vitals-about]');
  if (aboutToggle && about) {
    aboutToggle.addEventListener('click', () => {
      const expanded = aboutToggle.getAttribute('aria-expanded') !== 'true';
      aboutToggle.setAttribute('aria-expanded', String(expanded));
      about.hidden = !expanded;
    });
  }
  const button = updateToggle();
  if (button) {
    button.addEventListener('click', () => {
      button.disabled = true;
      button.querySelector('[data-em-cache-label]').textContent = 'Reloading';
      button.setAttribute('aria-busy', 'true');
      window.location.assign(cacheToggleUrl(window.location.href).href);
    });
  }
  render();
  if (document.querySelector('[data-em-liquid-render]')?.getAttribute('data-em-rendered-at') != null) {
    setInterval(() => {
      if (document.visibilityState !== 'hidden') renderLiquid();
    }, 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') renderLiquid();
    });
  }
  if (window.edgemeshTti) measureTti();
  else {
    const script = document.getElementById('em-tti-script');
    if (!script || document.readyState === 'complete') displayMetric('tti', null, 'N/A');
    else {
      script.addEventListener('load', measureTti, { once: true });
      script.addEventListener('error', () => displayMetric('tti', null, 'N/A'), { once: true });
    }
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
// loadEventEnd is populated only after all load handlers have returned.
window.addEventListener('load', () => setTimeout(() => {
  render();
  // A failed/deferred TTI script must not leave its statistic spinning forever.
  if (!window.edgemeshTti) displayMetric('tti', null, 'N/A');
}, 0), { once: true });
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  restoredFromHistory = true;
  updateToggle();
  document.querySelector('[data-em-history-note]')?.removeAttribute('hidden');
  displayMetric('tti', null);
  render();
});
