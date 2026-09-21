import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as metrics from '../assets/edgemesh-metrics.js';

const source = (await readFile(new URL('../assets/edgemesh-vitals.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const tick = () => new Promise(setImmediate);

function element(text = '') {
  let value = text;
  return {
    children: [], attributes: new Map(), listeners: new Map(), dataset: {},
    get textContent() { return value + this.children.map(child => child.textContent).join(''); },
    set textContent(text) { value = text; this.children = []; },
    replaceChildren(...children) { value = ''; this.children = children; },
    append(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    removeAttribute(name) { this.attributes.delete(name); },
    addEventListener(name, handler) { this.listeners.set(name, handler); },
  };
}

function fixture({ tti, readyState = 'interactive' } = {}) {
  const stats = new Map(['ttfb', 'request', 'response', 'load', 'tti', 'request-start', 'first-response', 'final-headers', 'response-end'].map(name => {
    const stat = element('Measuring');
    stat.setAttribute('aria-busy', 'true');
    return [name, stat];
  }));
  const label = element('Disable cache');
  const icon = element('icon');
  const button = element();
  button.append(label); button.append(icon);
  button.querySelector = () => label;
  const cache = element('Checking');
  const aboutToggle = element();
  aboutToggle.setAttribute('aria-expanded', 'false');
  const about = element();
  about.hidden = true;
  const script = element();
  const nodes = new Map([
    ['[data-em-cache-toggle]', button], ['[data-em-cache-status]', cache],
    ['[data-em-ttfb-label]', element()], ['[data-em-response-timing-note]', element()],
    ['[data-em-history-note]', element()],
    ['[data-em-vitals-about-toggle]', aboutToggle], ['[data-em-vitals-about]', about],
  ]);
  const nav = { startTime: 0, requestStart: 10, responseStart: 40, finalResponseHeadersStart: 500, responseEnd: 520, loadEventEnd: 0 };
  const listeners = new Map();
  const locations = [];
  const context = vm.createContext({
    ...metrics, URL, setTimeout,
    performance: { getEntriesByType: () => [nav] },
    window: {
      edgemeshTti: tti,
      location: { href: 'https://demo.example/?preview_theme_id=123', assign: value => locations.push(value) },
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
    document: {
      readyState,
      querySelector: selector => stats.get(selector.match(/^\[data-em-vital="(.+)"\]$/)?.[1]) || nodes.get(selector) || null,
      getElementById: id => id === 'em-tti-script' ? script : { content: { cloneNode: () => element('Measuring') } },
      createTextNode: text => element(text), createElement: () => element(),
    },
  });
  vm.runInContext(source, context);
  return { stats, button, icon, label, cache, aboutToggle, about, nav, listeners, locations, script, run: code => vm.runInContext(code, context) };
}

test('timing explanation expands and collapses with its accessible toggle state', () => {
  const f = fixture();
  assert.equal(f.about.hidden, true);
  assert.equal(f.aboutToggle.getAttribute('aria-expanded'), 'false');
  f.aboutToggle.listeners.get('click')();
  assert.equal(f.about.hidden, false);
  assert.equal(f.aboutToggle.getAttribute('aria-expanded'), 'true');
  f.aboutToggle.listeners.get('click')();
  assert.equal(f.about.hidden, true);
  assert.equal(f.aboutToggle.getAttribute('aria-expanded'), 'false');
});

test('pending load transitions from busy spinner to a measured value, including valid zeroes', () => {
  const f = fixture();
  assert.equal(f.stats.get('load').attributes.get('aria-busy'), 'true');
  assert.equal(f.stats.get('load').textContent, 'Measuring');
  f.nav.loadEventEnd = 700;
  f.run('render()');
  assert.equal(f.stats.get('load').textContent, '700ms');
  assert.equal(f.stats.get('load').attributes.get('aria-busy'), 'false');
  f.run('displayMetric("response", 0)');
  assert.equal(f.stats.get('response').textContent, '0ms');
  assert.equal(f.cache.attributes.get('aria-busy'), 'false');
});

test('TTI keeps loading until its asynchronous result settles', async () => {
  let finish;
  const f = fixture({ tti: { measure: () => new Promise(resolve => { finish = resolve; }) } });
  assert.equal(f.stats.get('tti').attributes.get('aria-busy'), 'true');
  finish(1500);
  await tick();
  assert.equal(f.stats.get('tti').textContent, '1.50s');
  assert.equal(f.stats.get('tti').attributes.get('aria-busy'), 'false');
});

test('unsupported, failed, or missing TTI scripts settle on N/A', async () => {
  for (const measure of [() => Promise.resolve(null), () => Promise.reject(new Error('unsupported'))]) {
    const f = fixture({ tti: { measure } });
    await tick();
    assert.equal(f.stats.get('tti').textContent, 'N/A');
    assert.equal(f.stats.get('tti').attributes.get('aria-busy'), 'false');
  }
  const failed = fixture();
  failed.script.listeners.get('error')();
  assert.equal(failed.stats.get('tti').textContent, 'N/A');
  assert.equal(failed.stats.get('tti').attributes.get('aria-busy'), 'false');
  assert.equal(fixture({ readyState: 'complete' }).stats.get('tti').textContent, 'N/A');
});

test('history restore clears pending state and ignores a later TTI result', async () => {
  let finish;
  const f = fixture({ tti: { measure: () => new Promise(resolve => { finish = resolve; }) } });
  f.listeners.get('pageshow')({ persisted: true });
  finish(1200);
  await tick();
  for (const stat of f.stats.values()) {
    assert.equal(stat.textContent, '—');
    assert.equal(stat.attributes.get('aria-busy'), 'false');
  }
});

test('cache navigation preserves the icon and shows busy state until the page leaves', () => {
  const f = fixture();
  assert.equal(f.button.children.includes(f.icon), true);
  f.button.listeners.get('click')();
  assert.equal(f.label.textContent, 'Reloading');
  assert.equal(f.button.attributes.get('aria-busy'), 'true');
  assert.equal(f.button.disabled, true);
  assert.equal(f.locations[0], 'https://demo.example/?preview_theme_id=123&em-bypass=all');
  f.listeners.get('pageshow')({ persisted: true });
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.attributes.get('aria-busy'), 'false');
});
