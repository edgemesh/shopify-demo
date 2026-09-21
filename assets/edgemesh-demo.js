import { morphSection } from '@theme/section-renderer';
import { StandardEvents } from '@shopify/events';

// The commerce flow belongs to Horizon. This module refreshes the cacheable
// drawer shell, asks the installed Edgemesh runtime to expand its fragments,
// and reports observed activity in the demo panel.
const cartSection = 'cart-drawer-section';
let mutationsInFlight = 0;
let fragmentRefreshRequested = false;
let fragmentRefreshRunning = false;
let sectionRevision = 0;
let sectionUpdates = 0;
let fragmentUpdates = 0;
let drawerRequest;

function status(selector, message, state = 'idle') {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = message;
    node.dataset.state = state;
  });
}

function runtime() {
  return typeof window.edgemesh?.dynamic?.expand === 'function' ? window.edgemesh.dynamic : null;
}

function describeEnvironment() {
  if (fragmentUpdates > 0) return;
  status(
    '[data-em-fragment-status]',
    runtime()
      ? 'Edgemesh runtime detected · waiting for fragment markup'
      : 'Shopify preview · native count updates; edge runtime not detected'
  );
}

async function refreshFragments() {
  fragmentRefreshRequested = true;
  if (fragmentRefreshRunning) return;
  fragmentRefreshRunning = true;
  try {
    // Serialize refreshes so an older cart response cannot win a later update.
    while (fragmentRefreshRequested) {
      fragmentRefreshRequested = false;
      if (!runtime()) {
        describeEnvironment();
        continue;
      }
      const before = fragmentUpdates;
      await runtime().expand();
      if (fragmentUpdates === before) {
        status('[data-em-fragment-status]', 'Refresh requested · no new fragment markup observed');
      }
    }
  } catch {
    status('[data-em-fragment-status]', 'Fragment refresh unavailable · native cart count retained', 'error');
  } finally {
    fragmentRefreshRunning = false;
  }
}

async function refreshDrawer() {
  if (!document.getElementById(`shopify-section-${cartSection}`) || mutationsInFlight) return;
  const revision = ++sectionRevision;
  drawerRequest?.abort();
  drawerRequest = new AbortController();
  const signal = drawerRequest.signal;
  status('[data-em-cart-refresh-status]', ' Refreshing your cart…');
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('section_id', cartSection);
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok) throw new Error('Cart section request failed');
    const markup = await response.text();
    if (!markup || !markup.includes('cart-items-component')) throw new Error('Cart section unavailable');
    if (signal.aborted || revision !== sectionRevision || mutationsInFlight) return;
    await morphSection(cartSection, markup, { mode: 'hydration', injectStylesheet: true });
    if (!runtime()) {
      // Direct Shopify previews have no fragment runtime. Reconcile the count
      // from the fresh section on navigation/history restore as well as events.
      const count = Number(document.querySelector(`#shopify-section-${cartSection} [ref="cartItemCount"]`)?.textContent || 0);
      if (Number.isFinite(count)) {
        document.querySelector('[data-em-cart-fragment] cart-icon')?.renderCartBubble?.(count, false);
      }
    }
    status('[data-em-cart-refresh-status]', '');
    status('[data-em-section-status]', 'Cart section loaded from Shopify', 'success');
  } catch {
    if (signal.aborted || revision !== sectionRevision) return;
    status('[data-em-section-status]', 'Section refresh unavailable · open the cart page to retry', 'error');
    const node = document.querySelector('[data-em-cart-refresh-status]');
    if (node) {
      const link = document.createElement('a');
      link.href = window.Theme?.routes?.cart_url || `${window.Shopify.routes.root}cart`;
      link.textContent = ' Open the cart page to see your current items.';
      node.replaceChildren(link);
    }
  }
}

document.addEventListener(StandardEvents.cartLinesUpdate, (event) => {
  if (!event.promise) return;
  mutationsInFlight += 1;
  sectionRevision += 1;
  drawerRequest?.abort();
  let retrySection = false;
  status('[data-em-section-status]', 'Cart change in progress…');
  event.promise.then(({ detail }) => {
    if (detail?.didError) throw new Error('Cart change failed');
    const sections = Object.values(detail?.sections || {});
    if (sections.some((html) => typeof html === 'string' && html.includes('cart-items-component'))) {
      sectionUpdates += 1;
      status('[data-em-section-status]', `Shopify returned fresh cart HTML · ${sectionUpdates} cart update${sectionUpdates === 1 ? '' : 's'}`, 'success');
    } else {
      status('[data-em-section-status]', 'Cart changed · requesting fresh section HTML');
    }
    void refreshFragments();
    if (sections.some((html) => html === null) || sections.length === 0) {
      // Shopify can accept a cart mutation while returning a null section.
      // Retry the render, never the mutation (which would add the item twice).
      retrySection = true;
    }
  }).catch(() => {
    status('[data-em-section-status]', 'Cart change failed · please try again', 'error');
  }).finally(() => {
    mutationsInFlight -= 1;
    if (retrySection) void refreshDrawer();
  });
});

function init() {
  const fragment = document.querySelector('[data-em-cart-fragment]');
  if (fragment) {
    new MutationObserver(() => {
      if (!runtime() || !fragment.querySelector('cart-icon')) return;
      fragmentUpdates += 1;
      status('[data-em-fragment-status]', `Edgemesh inserted fresh fragment markup · ${fragmentUpdates} refresh${fragmentUpdates === 1 ? '' : 'es'}`, 'success');
    }).observe(fragment, { childList: true });
  }
  describeEnvironment();
  void refreshDrawer();
  document.getElementById('cart-drawer')?.addEventListener('theme-drawer:open', () => {
    if (!mutationsInFlight) void refreshDrawer();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
window.addEventListener('load', describeEnvironment, { once: true });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    void refreshDrawer();
    void refreshFragments();
  }
});
