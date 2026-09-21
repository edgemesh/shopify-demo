# Dynamic content in this demo

## Cart: Shopify sections

Horizon owns product forms, cart line changes, quantity controls, discounts, money formatting, focus, and the drawer dialog. Product form submissions include `sections=cart-drawer-section`; quantity changes bundle the active cart section IDs. Shopify returns authoritative Liquid-rendered HTML with each mutation.

The initial drawer in a full page is an empty shell, with no cart line contents or visitor-specific cart event payload. `assets/edgemesh-demo.js` loads the current drawer through a same-origin, no-store Section Rendering API request. A new cart mutation aborts a pending shell refresh so an older response cannot overwrite the latest cart. A null bundled section retries only rendering, never the add-to-cart mutation.

The full `/cart` page remains Shopify's native dynamic route. Keep cart/checkout/account endpoints and section requests in the standard Shopify dynamic exclusions in Edgemesh.

## Header count: Edgemesh dynamic fragment

`snippets/header-actions.liquid` keeps the bag icon and Cart label outside `<dynamic data-em-cart-fragment>`. The fragment contains a complete Horizon `cart-icon` element with only the count bubble, positioned inline after the label. Its `default` attribute contains an empty circle as literal HTML, without entity-escaping the tags. The icon, label, and circle are centered together inside the button. The fragment reserves the same space before and after loading, so the count does not change the button's dimensions. Native product forms update the count immediately after successful cart mutations. If the Edgemesh runtime is installed, the demo also calls the existing `window.edgemesh.dynamic.expand()` API; the runtime owns the `/em-cgi/dynamic` route and replaces the fragment. Calls are serialized.

The fragment contains the entire custom element so Horizon's reference discovery runs against the new markup. The `cart-icon` session-storage shortcut is disabled inside this fragment so it cannot overwrite an expanded count with an earlier page's snapshot.

On a Shopify preview where the Edgemesh runtime is absent, ordinary Shopify Liquid and Horizon events keep the cart usable. The status panel explicitly reports that the edge runtime was not detected. A successful native cart update is not represented as proof of fragment expansion: the demo observes direct fragment markup replacement separately.

## Timing panel and cache control

All values refer to the current document navigation, without issuing a second request to guess the original cache status.

| Reading | Source |
| --- | --- |
| TTFB | `finalResponseHeadersStart - startTime` |
| Request time | `finalResponseHeadersStart - requestStart` (send + network + server wait) |
| Response time | `responseEnd - finalResponseHeadersStart` (final response, including header transfer) |
| TTI estimate | Latest of DOMContentLoaded end, first contentful paint, and observed long-task end; reported immediately after load |
| Full load | `loadEventEnd - startTime`, after load handlers finish |
| Cache status | Navigation `Server-Timing: edgemesh-cache`, legacy `ems-cache-hit` / `ems-cache-miss`, then `application/edgemesh+json` runtime config |

Shopify sends HTTP 103 Early Hints. Modern Chrome can report that earlier interim response as `responseStart`, so it must not be used as the final document boundary for this demo. Otherwise a 47 ms early hint can hide a roughly 749 ms wait for the document, and that wait is incorrectly counted as response transfer. We use `finalResponseHeadersStart` for all three related intervals. The expandable details show request start, first response (including interim), final headers, and response end from the same navigation.

The panel labels this metric **TTFB** and explains that it uses the final response: standard web-vitals TTFB can include Early Hints. The DevTools Network Timing tab's **Waiting (TTFB)** is closer to our **REQ TIME**, because navigation TTFB also includes redirects, DNS, and connection setup. An exact DevTools match is unavailable from Navigation Timing: DevTools separates the end of request sending and header reception using timestamps not exposed to page scripts. Do not promise identical numbers or replace these readings with a separate fetch. If the browser does not expose final-header timing, an explicit **TTFB ≈** fallback uses the first response; if an interim response is known but final timing is missing, the document intervals show N/A.

The newer Edgemesh codec uses `HIT;T0`, `HIT;T1`, `HIT;T2`, `MISS`, `BYPASS`, and `REVALIDATED`. The UI shows levels as L0/L1/L2. The deployed `stable@2.4.0` worker on the demo domain uses `ems-cache-hit` and `ems-cache-miss` instead; these show HIT and MISS without inventing a tier. Its MISS timing also covers bypasses, including theme previews, so it does not prove a failed lookup. Both timing formats take precedence over embedded runtime configuration. Other CDNs' cache headers are not treated as Edgemesh hits. Missing diagnostics show “Not reported.” A browser-history restoration is labeled separately rather than reusing old timings as a new load.

“Disable cache” adds `em-bypass=all` to the current URL and performs a full navigation. “Enable cache” removes it and navigates again. Both clear the URL fragment (anchor). Locale, product variant, theme preview, and other query parameters are preserved. `all` bypasses all Edgemesh optimization, so this is a comparison of the complete optimized/unoptimized delivery paths, not an isolated edge-cache benchmark. It does not change domain settings or purge shared caches.

TTI is a custom page-load interactivity estimate and can be unavailable in browsers without Long Tasks support. It resolves immediately after load handlers finish, with no five-second quiet window. It does not verify network quiet or sustained main-thread availability, so it is not the legacy consistently-interactive TTI measurement. It is not substituted with `domInteractive` or represented as a current Google Core Web Vital. Full load does not wait for content loaded lazily after the load event.

Pending readings use inline Lucide loading spinners with screen-reader text and `aria-busy`. Resolved values, unsupported measurements, script failures, and browser-history restores clear the busy state. The cache button keeps its refresh icon when its text changes and switches to a spinner while navigating. The spinner is static under `prefers-reduced-motion: reduce`; JavaScript-disabled pages display N/A and the existing explanation.

The live Liquid timestamp age appears only inside the collapsed timing explanation, with concise clock caveats and the exact UTC timestamp in its tooltip. The heading shows **Likely fresh render** only when `em-bypass=all` is present and TTFB is at least 700ms or the timestamp was within five seconds of the document response. That estimate stays tied to the original response while the age continues increasing. Other bypassed loads show **Possibly stale** in amber, including detected Edgemesh/browser cache hits; this is not proof of outdated content. Cache-enabled URLs and history restores hide both labels. Missing or future timestamps cannot satisfy the recency condition. The indicator does not use retained Server-Timing render durations as proof. See [Liquid rendering workload](LIQUID-WORKLOAD.md) for details and calibration results.

Edgemesh bypass does not disable Shopify's own HTML cache. The demo preserves that cache behavior and displays real timings rather than forcing a minimum delay.

## Acceptance checks

1. Open the unpublished theme preview; add a product and check the drawer, count, quantity changes, removal, and empty cart.
2. Navigate between home and a product with items in the cart, then return via browser history.
3. On the actual Edgemesh delivery path, verify `<dynamic>` expansion and the `edgemesh-cache` navigation timing entry. Use a second browser session with a different cart to verify isolation.
4. Toggle `em-bypass=all` both directions, including a URL with a variant and preview parameter. Confirm the URL changes and all other parameters survive.
5. Do not interpret preview-mode “Not reported” as a cache miss. Verify cache and fragment behavior on the enabled Edgemesh path before publishing the theme.

References: [Shopify Section Rendering API](https://shopify.dev/docs/api/ajax/section-rendering), [TTI polyfill](https://github.com/GoogleChromeLabs/tti-polyfill), [Navigation Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceNavigationTiming), [TTFB and Early Hints](https://web.dev/articles/ttfb#ttfb_and_early_hints), [DevTools timing phases](https://developer.chrome.com/docs/devtools/network/reference#timing-explanation). Edgemesh integration was checked against the connected documentation and the adjacent `em` repository's runtime/config/cache codec.
