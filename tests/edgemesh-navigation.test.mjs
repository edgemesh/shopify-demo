import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { preserveCacheBypass } from '../assets/edgemesh-navigation.js';

const current = 'https://demo.example/?em-bypass=all&preview_theme_id=123';

test('bypass follows storefront destinations without copying unrelated source parameters', () => {
  for (const path of ['/', '/fr/', '/products/signal', '/collections/all', '/collections/all/products/signal', '/search', '/pages/about', '/blogs/news/post', '/cart', '/en-ca/cart', '/policies/privacy-policy']) {
    const destination = `${path}?view=edgemesh&variant=456&q=fast+store&page=2&preview_theme_id=789#details`;
    const url = new URL(preserveCacheBypass(destination, current));
    assert.equal(url.pathname, path);
    assert.equal(url.hash, '#details');
    assert.deepEqual([...url.searchParams], [
      ['view', 'edgemesh'], ['variant', '456'], ['q', 'fast store'], ['page', '2'], ['preview_theme_id', '789'], ['em-bypass', 'all'],
    ]);
  }
  assert.equal(preserveCacheBypass('/products/signal', current), 'https://demo.example/products/signal?em-bypass=all');
});

test('clean URLs and partial bypass do not propagate a preference', () => {
  for (const source of ['https://demo.example/', 'https://demo.example/?em-bypass=cache']) {
    for (const destination of ['/products/signal?view=edgemesh#details', '/cart?em-bypass=all', '/?em-bypass=cache']) {
      assert.equal(preserveCacheBypass(destination, source), destination);
    }
  }
});

test('normalizes duplicate bypass values and preserves explicitly bypassed destinations', () => {
  const result = new URL(preserveCacheBypass('/cart?em-bypass=cache&em-bypass=all&em-bypass=all', current));
  assert.deepEqual(result.searchParams.getAll('em-bypass'), ['all']);
  assert.equal(preserveCacheBypass('/cart?em-bypass=all', current), '/cart?em-bypass=all');
  assert.equal(new URL(preserveCacheBypass('/cart', `${current}&em-bypass=cache`)).searchParams.get('em-bypass'), 'all');
});

test('does not decorate fragments, external destinations, commerce actions, or APIs', () => {
  for (const destination of [
    '', '#stack', '  #details', 'https://edgemesh.com/products/signal', '//other.example/cart',
    'http://demo.example/cart', 'mailto:hello@example.com', 'javascript:void(0)', 'https://[invalid',
    '/checkout', '/checkouts/token', '/account', '/fr/account/login', '/admin', '/api', '/cdn',
    '/cart/add', '/cart/change.js', '/cart/123:1', '/cart.js', '/products/signal.json/',
    '/collections/all.atom', '/search/suggest', '/apps/example', '/em-cgi/dynamic',
    '/?section_id=cart-drawer-section', '/products/signal?sections=product',
  ]) assert.equal(preserveCacheBypass(destination, current), destination);
});

async function component(file) {
  const classes = new Map();
  const navigations = [];
  class Element {
    refs = {};
    dataset = {};
    closest() { return null; }
    hasAttribute() { return false; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getAttribute() { return null; }
    dispatchEvent() {}
  }
  class MouseEvent {
    constructor(target, options) { this.target = target; Object.assign(this, options); }
    preventDefault() {}
  }
  const window = { location: { href: current }, Shopify: { designMode: false }, open: (href) => navigations.push(href) };
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, Element, HTMLElement: Element, MouseEvent,
    Component: Element, ProductComponent: Element, VariantPicker: Element, DialogComponent: Element,
    customElements: { get: (name) => classes.get(name), define: (name, value) => classes.set(name, value) },
    debounce: (fn) => fn, window, location: new URL(current),
    startViewTransition: (fn) => fn(),
    CollectionUpdateEvent: class {
      static createPromise() { return { promise: Promise.resolve(), resolve() {}, reject() {} }; }
      static parseProductFilters() { return null; }
      static getSortKey() { return null; }
    },
    Theme: { routes: { cart_url: '/cart', search_url: '/search' } },
    preserveCacheBypass: (href) => preserveCacheBypass(href, window.location.href),
    history: { pushState: (state, title, href) => { window.location.href = new URL(href, window.location.href).href; } },
    sectionRenderer: { renderSection: () => Promise.resolve() },
  });
  const source = (await readFile(new URL(`../assets/${file}`, import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, context);
  return { classes, context, Element, MouseEvent, window, navigations };
}

test('product-card scripted navigation carries bypass for current and new tabs', async () => {
  const f = await component('product-card.js');
  const card = new (f.classes.get('product-card'))();
  card.refs.productCardLink = { href: 'https://demo.example/products/signal?variant=42', getAttribute: () => 'card-42' };
  card.navigateToProduct(new f.MouseEvent(new f.Element(), { ctrlKey: true }));
  assert.equal(f.navigations[0], 'https://demo.example/products/signal?variant=42&em-bypass=all');
  card.navigateToProduct(new f.MouseEvent(new f.Element()));
  assert.equal(f.window.location.href, f.navigations[0]);
});

test('quick-add selling-plan redirect carries bypass before navigation', async () => {
  const f = await component('quick-add.js');
  const quickAdd = new (f.classes.get('quick-add-component'))();
  quickAdd.dataset.usesSellingPlans = 'true';
  Object.defineProperty(quickAdd, 'productPageUrl', { value: '/products/signal?variant=42' });
  await quickAdd.handleClick({ preventDefault() {} });
  assert.equal(f.window.location.href, 'https://demo.example/products/signal?variant=42&em-bypass=all');
});

test('predictive search preserves bypass for a direct result and a full search', async () => {
  const f = await component('predictive-search.js');
  const search = new (f.classes.get('predictive-search-component'))();
  const result = new f.Element();
  const container = new f.Element();
  container.classList = { contains: () => false };
  container.querySelectorAll = () => [result];
  search.querySelectorAll = () => [container];
  const singleResult = new f.Element();
  singleResult.dataset.singleResultUrl = '/products/signal?view=edgemesh';
  search.refs.predictiveSearchResults = { querySelector: () => singleResult };
  search.onSearchKeyDown({ key: 'Enter', preventDefault() {} });
  assert.equal(f.window.location.href, 'https://demo.example/products/signal?view=edgemesh&em-bypass=all');
  search.refs.predictiveSearchResults.querySelector = () => null;
  search.refs.searchInput = { value: 'fast store' };
  search.onSearchKeyDown({ key: 'Enter', preventDefault() {} });
  assert.equal(f.window.location.href, 'https://demo.example/search?q=fast+store&em-bypass=all');
});

test('filter rebuilds and clear-filter URLs retain bypass in browser history', async () => {
  const f = await component('facets.js');
  const form = new (f.classes.get('facets-form-component'))();
  form.createURLParameters = () => new URLSearchParams('sort_by=price-ascending');
  form.getAttribute = () => 'test-section';
  f.window.location.href = 'https://demo.example/collections/all?em-bypass=all&page=2';
  form.updateFilters();
  assert.equal(f.window.location.href, 'https://demo.example/collections/all?sort_by=price-ascending&em-bypass=all');
  form.updateFiltersByURL('/collections/all');
  assert.equal(f.window.location.href, 'https://demo.example/collections/all?em-bypass=all');
});

test('cart action fallback carries bypass without changing the drawer flow', async () => {
  const source = (await readFile(new URL('../assets/standard-actions-override.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  let openCart;
  let drawer;
  const window = { location: { href: current }, Shopify: { actions: {
    updateCart: { configure() {} }, openCart: { configure: (options) => { openCart = options.handler; } },
  } } };
  vm.runInNewContext(source, {
    window, Theme: { routes: { cart_url: '/fr/cart' } }, document: { querySelector: () => drawer },
    preserveCacheBypass: (href) => preserveCacheBypass(href, window.location.href),
  });
  let opened = false;
  drawer = { open: () => { opened = true; } };
  await openCart();
  assert.equal(opened, true);
  assert.equal(window.location.href, current);
  drawer = null;
  await openCart();
  assert.equal(window.location.href, 'https://demo.example/fr/cart?em-bypass=all');
});

async function searchFormFixture() {
  const listeners = new Map();
  const formListeners = new Map();
  const windowListeners = new Map();
  const attributes = new Map([['method', 'get'], ['action', '/search']]);
  const children = [];
  const form = {
    getAttribute: (name) => attributes.get(name) ?? null,
    append: (child) => children.push(child),
    contains: (child) => children.includes(child),
    addEventListener: (name, handler) => formListeners.set(name, handler),
  };
  const window = { location: { href: current }, addEventListener: (name, handler) => windowListeners.set(name, handler) };
  const document = {
    readyState: 'complete', documentElement: {},
    querySelectorAll: (selector) => selector === 'form' ? [form] : [],
    addEventListener: (name, handler) => listeners.set(name, handler),
    createElement: () => {
      const input = { remove: () => { const index = children.indexOf(input); if (index !== -1) children.splice(index, 1); } };
      return input;
    },
  };
  const source = (await readFile(new URL('../assets/edgemesh-navigation.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
  vm.runInNewContext(`${source}\ninitCacheNavigation();`, {
    document, window, URL, setTimeout, queueMicrotask, MutationObserver: class { observe() {} },
  });
  return { form, window, attributes, children, listeners, windowListeners, data: (values = '') => {
    const formData = new URLSearchParams(values);
    formListeners.get('formdata')({ formData });
    return formData;
  } };
}

test('POST submitter overrides survive microtasks and repeated native formdata events', async () => {
  const f = await searchFormFixture();
  assert.equal(f.children[0].value, 'all');
  f.listeners.get('submit')({ target: f.form, submitter: {
    getAttribute: (name) => ({ formmethod: 'post', formaction: '/checkout' }[name] ?? null),
  } });
  await Promise.resolve();
  assert.equal(f.children.length, 0);
  for (let event = 0; event < 2; event++) {
    assert.equal(f.data('q=signal').has('em-bypass'), false);
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.data('q=signal&em-bypass=cache').getAll('em-bypass'), ['all']);
});

test('immediate form action changes and clean history preserve original form values', async () => {
  const f = await searchFormFixture();
  f.attributes.set('action', 'https://other.example/search');
  assert.deepEqual(f.data('em-bypass=cache&em-bypass=all').getAll('em-bypass'), ['cache']);
  f.attributes.set('action', '/search');
  f.window.location.href = 'https://demo.example/';
  f.windowListeners.get('pageshow')({ persisted: true });
  assert.equal(f.children.length, 0);
  assert.deepEqual(f.data('em-bypass=cache').getAll('em-bypass'), ['cache']);
});
