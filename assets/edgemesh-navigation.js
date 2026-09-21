// Carry the comparison mode before the destination document is fetched.
function storefrontUrl(href, currentHref) {
  try {
    const current = new URL(currentHref);
    const url = new URL(href, current);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== current.origin) return null;
    // Allow storefront documents, including localized paths, but not cart
    // actions, checkout, accounts, app proxies, or asset/API endpoints.
    const path = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z0-9]{2,8})*(?=\/|$)/i, '');
    if (!/^(?:\/?|\/cart\/?|\/search\/?|\/collections(?:\/[^/]+){0,2}\/?|\/collections\/[^/]+\/products\/[^/]+\/?|\/(?:products|pages|policies)\/[^/]+\/?|\/blogs\/[^/]+(?:\/[^/]+)?\/?)$/.test(path)) return null;
    if (/\.(?:js|json|xml|atom|csv)\/?$/i.test(path) || url.searchParams.has('section_id') || url.searchParams.has('sections')) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * @param {string} href Destination URL or relative link.
 * @param {string} [currentHref] Current document URL.
 * @returns {string} Destination with cache bypass carried forward when enabled.
 */
export function preserveCacheBypass(href, currentHref = window.location.href) {
  if (!href.trim() || href.trimStart().startsWith('#')) return href;
  const url = storefrontUrl(href, currentHref);
  if (!url || !new URL(currentHref).searchParams.getAll('em-bypass').includes('all')) return href;
  const bypass = url.searchParams.getAll('em-bypass');
  if (bypass.length === 1 && bypass[0] === 'all') return href;
  url.searchParams.set('em-bypass', 'all');
  return url.href;
}

export function initCacheNavigation() {
  const links = new WeakMap();
  const inputs = new WeakMap();
  const forms = new WeakSet();
  const submitters = new WeakMap();

  function syncLink(link) {
    let original = link.getAttribute('href');
    if (original === null) { links.delete(link); return; }
    const previous = links.get(link);
    if (previous) {
      if (original === previous.decorated) original = previous.original;
      else {
        // Variant changes can edit a decorated URL. Keep those edits while
        // remembering which bypass values belonged to the underlying link.
        const changed = storefrontUrl(original, window.location.href);
        if (changed?.searchParams.getAll('em-bypass').join() === 'all') {
          changed.searchParams.delete('em-bypass');
          for (const value of new URL(previous.original, window.location.href).searchParams.getAll('em-bypass')) {
            changed.searchParams.append('em-bypass', value);
          }
          original = changed.href;
        }
      }
    }
    const decorated = link.hasAttribute('download') ? original : preserveCacheBypass(original);
    if (decorated !== original) links.set(link, { original, decorated });
    else links.delete(link);
    if (link.getAttribute('href') !== decorated) link.setAttribute('href', decorated);
  }

  function isSearchForm(form, submitter) {
    const method = submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get';
    const action = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? window.location.href;
    const url = storefrontUrl(action, window.location.href);
    return method.toLowerCase() === 'get' && !!url && /\/search\/?$/.test(url.pathname);
  }

  function syncForm(form, submitter) {
    const enabled = new URL(window.location.href).searchParams.getAll('em-bypass').includes('all');
    let input = inputs.get(form);
    if (enabled && isSearchForm(form, submitter)) {
      if (!input || !form.contains(input)) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'em-bypass';
        input.value = 'all';
        form.append(input);
        inputs.set(form, input);
      }
    } else {
      input?.remove();
      inputs.delete(form);
    }
    if (!forms.has(form)) {
      forms.add(form);
      form.addEventListener('formdata', (event) => {
        // Also covers form.submit() and normalizes existing named controls
        // without changing values supplied by the original form markup.
        if (new URL(window.location.href).searchParams.getAll('em-bypass').includes('all') &&
            isSearchForm(form, submitters.get(form))) {
          event.formData.set('em-bypass', 'all');
        } else {
          // form.submit() can run immediately after its action/method changes,
          // before the observer removes our input. Remove only our contribution.
          const managed = inputs.get(form);
          if (managed && form.contains(managed)) {
            const values = event.formData.getAll('em-bypass');
            const index = values.lastIndexOf(managed.value);
            if (index !== -1) {
              values.splice(index, 1);
              event.formData.delete('em-bypass');
              for (const value of values) event.formData.append('em-bypass', value);
            }
          }
        }
      });
    }
  }

  function syncTree(root) {
    if (root.matches?.('a[href]')) syncLink(root);
    if (root.matches?.('form')) syncForm(root);
    root.querySelectorAll?.('a[href]').forEach(syncLink);
    root.querySelectorAll?.('form').forEach((form) => syncForm(form));
  }

  function init() {
    syncTree(document);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          if (record.target.matches('a')) syncLink(record.target);
          else if (record.target.matches('form')) syncForm(record.target);
        } else {
          for (const node of record.addedNodes) syncTree(node);
        }
      }
    }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['href', 'download', 'action', 'method'],
    });
  }

  // Run before theme click handlers read href; retain native new-tab behavior.
  for (const name of ['click', 'auxclick', 'contextmenu', 'focusin']) {
    document.addEventListener(name, (event) => {
      const link = event.target.closest?.('a[href]');
      if (link) syncLink(link);
    }, true);
  }
  document.addEventListener('submit', (event) => {
    submitters.set(event.target, event.submitter);
    syncForm(event.target, event.submitter);
    // Native submission can run microtasks between submit and formdata. Keep
    // submitter overrides through the whole task, including repeated formdata.
    setTimeout(() => submitters.delete(event.target), 0);
  }, true);
  window.addEventListener('pageshow', () => syncTree(document));
  window.addEventListener('popstate', () => syncTree(document));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
