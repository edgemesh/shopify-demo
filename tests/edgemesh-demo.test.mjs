import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../assets/edgemesh-demo.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const tick = () => new Promise(setImmediate);
function fixture(fetchImpl) {
  const listeners = new Map();
  const statuses = new Map();
  const morphs = [];
  const nodes = new Map();
  const window = { location: { href: 'https://demo.example/fr/products/signal?preview_theme_id=123' }, Shopify: { routes: { root: '/fr/' } }, addEventListener() {} };
  const context = vm.createContext({
    window, URL, AbortController, queueMicrotask, console,
    StandardEvents: { cartLinesUpdate: 'cart-change' },
    morphSection: (...args) => morphs.push(args),
    fetch: fetchImpl,
    document: {
      readyState: 'loading',
      getElementById: () => ({}),
      querySelector: (selector) => nodes.get(selector) || null,
      querySelectorAll: (selector) => {
        if (!statuses.has(selector)) statuses.set(selector, { textContent: '', dataset: {} });
        return [statuses.get(selector)];
      },
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
  });
  vm.runInContext(source, context);
  return { window, context, listeners, statuses, morphs, nodes, run: (s) => vm.runInContext(s, context) };
}
const sectionResponse = () => ({ ok: true, text: async () => '<div><cart-items-component>Current cart</cart-items-component></div>' });

test('cart section requests preserve locale and preview context and bypass browser cache', async () => {
  let request;
  const f = fixture(async (url, init) => { request = { url, init }; return sectionResponse(); });
  await f.run('refreshDrawer()');
  assert.equal(request.url.pathname, '/fr/products/signal');
  assert.equal(request.url.searchParams.get('preview_theme_id'), '123');
  assert.equal(request.url.searchParams.get('section_id'), 'cart-drawer-section');
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.credentials, 'same-origin');
  assert.equal(f.morphs.length, 1);
});

test('a mutation cancels an older drawer render so stale cart HTML cannot win', async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const pending = f.run('refreshDrawer()');
  f.listeners.get('cart-change')({ promise: Promise.resolve({ detail: { sections: { cart: '<cart-items-component>new</cart-items-component>' } } }) });
  finish(sectionResponse());
  await pending;
  await tick();
  assert.equal(f.morphs.length, 0);
});

test('a null bundled section retries rendering without repeating the cart mutation', async () => {
  let requests = 0;
  const f = fixture(async () => { requests += 1; return sectionResponse(); });
  f.listeners.get('cart-change')({ promise: Promise.resolve({ detail: { sections: { cart: null } } }) });
  await tick();
  assert.equal(requests, 1);
  assert.equal(f.morphs.length, 1);
});

test('failed section requests do not replace the cart or claim success', async () => {
  const f = fixture(async () => ({ ok: false, status: 500 }));
  await f.run('refreshDrawer()');
  assert.equal(f.morphs.length, 0);
  assert.equal(f.statuses.get('[data-em-section-status]').dataset.state, 'error');
});

test('Shopify previews report that no Edgemesh runtime was detected', async () => {
  const f = fixture(async () => sectionResponse());
  await f.run('refreshFragments()');
  assert.match(f.statuses.get('[data-em-fragment-status]').textContent, /not detected/);
});

test('Shopify preview history refresh reconciles the header count from the fresh section', async () => {
  const f = fixture(async () => sectionResponse());
  let count;
  f.nodes.set('#shopify-section-cart-drawer-section [ref="cartItemCount"]', { textContent: '3' });
  f.nodes.set('[data-em-cart-fragment] cart-icon', { renderCartBubble: (value) => { count = value; } });
  await f.run('refreshDrawer()');
  assert.equal(count, 3);
});

test('fragment requests are serialized and a second cart change schedules fresh markup', async () => {
  let active = 0; let maxActive = 0; let calls = 0; const finish = [];
  const f = fixture(async () => sectionResponse());
  f.window.edgemesh = { dynamic: { expand: () => { active += 1; maxActive = Math.max(active, maxActive); calls += 1; return new Promise((resolve) => finish.push(() => { active -= 1; resolve(); })); } } };
  const first = f.run('refreshFragments()');
  await f.run('refreshFragments()');
  assert.equal(calls, 1);
  finish.shift()();
  await tick();
  assert.equal(calls, 2);
  finish.shift()();
  await first;
  assert.equal(maxActive, 1);
});
