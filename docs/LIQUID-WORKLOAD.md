# Liquid rendering workload

The home page and `product.edgemesh` template include **Liquid rendering workload**. The theme editor can enable/disable it, select a source collection, and adjust merchandising passes, slots, and app-style integrations. An empty collection picker uses all products.

The default is **16 passes × 48 slots = 768 product-card renders**, plus **768 app-style integration renders**. The four actual demo products are reused. This is a disclosed scale simulation, not a claim that 768 distinct products or third-party apps are installed. This setting balances meaningful server work with the cost of nested app-style processing; it is not a benchmark for an average Shopify store.

Each card resolves real variants, availability, prices, images, metafields, and tag badges through nested snippets. Each integration independently prepares review metadata, searchable product text, sorted variant prices/options, related-product merchandising, and Shopify structured product data. Missing review data stays unrated; no fabricated ratings or inventory are generated.

Captured output is evaluated by Liquid. Product cards and integration payloads contribute to workload counters and are not sent to the browser. The visible section explains the simulation and the three delivery paths: fresh Liquid rendering, Shopify-managed HTML caching, and Edgemesh edge caching. The `variantChecks` counter counts the primary card variants, excluding the integration's additional related-product/variant work.

## Response buffering

`layout/theme.liquid` captures `content_for_layout` before emitting the document on the home page and the `product.edgemesh` template. Shopify normally can stream the head before its sections finish; buffering models stores that assemble catalog/app output before returning HTML. Without buffering, the heavier workload appeared primarily in response time, with TTFB about 368ms and another 1.04s spent receiving the document. Buffering moves this genuine server work ahead of the final response. Other templates retain their existing rendering order.

There are no sleeps, JavaScript busy loops, timing floors, metric adjustments, or cache-bypass-only workload branches. No third-party apps, tracking, cart attributes, or additional browser requests were added. The workload stays outside dynamic fragments and the cart section and reads no customer/cart data.

## Cache behavior and limits

**Keep Shopify's native caching and actual timings.** This was the user's explicit decision after calibration. Edgemesh bypass (`?em-bypass=all`) does not disable Shopify's own rendered-page cache. A cached Shopify response can still be far below 700ms TTFB or 1s full load. Those thresholds are targets for genuine rendering, not guaranteed floors for every navigation. No worker changes or cache-busting nonce were added.

Bounds apply in both Liquid and the editor: 1–32 passes, 8–48 slots, 0–2 integration layers, the first 48 products for card selection, at most 24 variants per card/integration product, and at most 12 related-product candidates. Total integration renders are capped at 1,536 per page by reducing effective passes. These bounds limit work; Shopify load and catalog complexity still affect its cost. An earlier 6,144-integration calibration exceeded Shopify's capacity and returned HTTP 500; that setting was removed. Do not restore it.

An empty collection produces no product work. Disabling the section skips its workload. Setting integration layers to zero retains only product-card rendering. Settings are per template. Edgemesh can reuse the completed document; existing edge-cached HTML can retain an older workload until normal invalidation/revalidation.

## Liquid render indicator

The expanded “How to read these numbers” explanation shows **Liquid rendered ≈42s ago**, using `{{ 'now' | date: '%s' }}` embedded in the HTML as `data-em-rendered-at`. The short explanation notes that age is approximate and uses the device clock; its tooltip preserves the exact UTC timestamp. The age updates once per second while the tab is visible, with no extra requests. Cached HTML and history restores retain their original timestamp.

The heading shows **Likely fresh render** only with `em-bypass=all`, when either navigation TTFB is at least **700ms**, or the Liquid timestamp is between **0 and 5 seconds** old when the document response finished. The classification uses `performance.timeOrigin + responseEnd`, falling back to the first script observation if unavailable. It stays tied to that original response while the live age increases. Other bypassed loads show **Possibly stale** in amber, including detected browser/Edgemesh cache hits. This means a fresh render was not indicated, not that product data is confirmed outdated. History restores and cache-enabled URLs hide both labels. A retained `render` Server-Timing duration is not used for this inference.

This is explicitly a heuristic, not verification of Shopify's internal cache. High TTFB can have other causes, and a recent timestamp can be cached. Missing/invalid/future timestamps cannot satisfy the recency test; high TTFB can still independently qualify when cache is disabled. Future timestamps report a clock difference in the collapse rather than a fresh-looking zero. Invalid timestamps report unavailable age.

The changing age is not an ARIA live region. The simulation, native Shopify cache behavior, and reported navigation timings are unchanged. There is no established evidence here that a longer Liquid render changes Shopify's cache lifetime; the demo makes no such claim.

Reference: [Shopify Liquid date filter and caching](https://shopify.dev/docs/api/liquid/filters/date#the-current-date).

## Verification — 2026-09-20 Pacific time

Shopify CLI profiles (instrumented, not browser timings):

| Measurement | Before | Final workload |
| --- | ---: | ---: |
| Workload section | 261.97ms | 816.48ms |
| Full profiled page | 425.93ms | 871.00ms |
| Product-card snippet executions | 768 | 768 |
| Integration snippet executions | 0 | 768 |
| Price snippet executions | 768 | 3,840 |
| Badge snippet executions | 768 | 3,072 |

Ordinary browser navigations with the final 16-pass workload to the published home page with `em-bypass=all`, no preview mode or query nonce; values are the rounded readings from the visible vitals panel:

| Sample | TTFB | Full load |
| --- | ---: | ---: |
| 1 | 955ms | 2.12s |
| 2 | 1.11s | 1.32s |
| 3 | 207ms | 320ms |
| 4 | 179ms | 299ms |

All four navigations displayed legacy Edgemesh `MISS` and **No fresh render reported**. Even the slower samples are not confirmed fresh Liquid renders; the browser did not expose a Shopify `render` entry. The CLI profile separately verifies the real server workload. An earlier 24-pass calibration profiled at 1,340.55ms for the workload section and was reduced to the final setting above.

Add-to-cart, section-rendered cart contents, and drawer opening/closing were checked during calibration; the test Signal item was removed afterward. These small diagnostic samples are not an SLA or representative store benchmarks. The indicator was checked on desktop and at 320px; automated tests cover render timings, cached historical timings, missing diagnostics, and browser-history restoration.

```sh
npm run check
npm run measure:liquid
node scripts/measure-liquid.mjs --samples 10
node scripts/measure-liquid.mjs --url 'https://demo.edgemesh.com/products/performance?view=edgemesh&em-bypass=all'
shopify theme profile --environment demo --url / --json > /tmp/edgemesh-liquid-profile.json
```

The measurement script sends serial anonymous HTTPS requests to the published theme, spaced 1.5s apart. It stops on any HTTP/Liquid error, does not create a cart or preview session, and uses final response headers rather than HTTP 103 Early Hints for TTFB. It records Shopify `render`/`processing` timings when supplied. Missing `render` is unknown, not zero. `documentMs` is HTML transfer time, **not browser full load**; use the storefront panel for that. Shopify can rate-limit automated requests; do not count errors as performance samples or evade that protection.

The CLI profiler takes a path such as `/`; it appends its own query string. Its Speedscope timings include instrumentation overhead. The final profile and the browser timings therefore measure different things.

References: [Shopify streamed HTML](https://shopify.dev/docs/storefronts/themes/best-practices/performance/platform), [nested render cost](https://shopify.dev/docs/storefronts/themes/best-practices/performance/avoid-nested-renders), [Liquid loop limits](https://shopify.dev/docs/api/liquid/tags/for), [CLI profiler](https://shopify.dev/docs/api/shopify-cli/theme/theme-profile).

## Storefront explanation

The section presents Horizon as a performant foundation and describes the additional Liquid work that richer storefronts can introduce. It distinguishes a freshly rendered page from an older cached snapshot, qualifies the latency benefit of avoiding a Shopify round trip, and describes cache lifetime/purge controls as unavailable to this Liquid theme rather than claiming Shopify has no invalidation mechanism. No universal speed or freshness guarantee is made.

Background: [Shopify’s full-page caching explanation](https://shopify.engineering/simplify-batch-cache-optimized-server-side-storefront-rendering), [Shopify’s theme performance guidance](https://shopify.dev/docs/storefronts/themes/best-practices/performance).
