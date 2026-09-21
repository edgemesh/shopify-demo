# Liquid rendering workload

The home page and `product.edgemesh` template include **Liquid rendering workload**. In the theme editor, open that section to enable/disable it, choose a source collection, and adjust the number of passes and product slots. An empty collection picker uses the store's all-products collection.

The default is **16 passes × 48 slots = 768 product-card renders**. The small demo catalog is reused across these slots; the panel explicitly identifies this repetition. This is a synthetic scale multiplier around real storefront Liquid, not a claim that the store has 768 distinct products.

Each render reads a real product, sorts and filters its variants, evaluates availability and sale pricing, resolves product metafields and tag badges, builds image markup, formats money, and renders nested price/badge snippets. A `capture` executes and retains each card in Liquid. Only the first four distinct sample cards are emitted into the response; the rest contribute to the workload counters. With the current single product's five variants, the default evaluates 3,840 variants.

No JavaScript delay, busy loop, extra browser request, or sleeping endpoint is involved. The section does not read cart/customer data. It stays outside the personal fragment and the cart section, keeping the work in the cacheable document. Shopify runs it when rendering that document; an EdgeMesh full-page cache hit can reuse the completed HTML. Shopify can also reuse its own cached rendering, so bypassing EdgeMesh does not guarantee that Liquid executes on every request.

Bounds are enforced in Liquid as well as in the editor: 1–32 passes, 8–48 slots, the first 48 collection products, and up to 24 price-sorted variants per product. An empty collection emits zero counts and an explanatory message. Disabling the section skips all its product work. Workload settings are per template.

## Verification

```sh
npm run check
npm run measure:liquid
shopify theme profile --environment demo --url / --json > /tmp/edgemesh-liquid-profile.json
```

The measurement script makes five serial requests to the unpublished preview with `em-bypass=all`, checks the returned theme ID and real variant counts, and reports Shopify's `render`/`processing` Server-Timing entries separately from network TTFB. Missing `render` entries stay `null`, and the report identifies the number of render samples. No query nonce is added. These preview requests cannot establish EdgeMesh HIT/MISS behavior.

The CLI profiler requires a path such as `/`. CLI 4.8 appends its own query string, so passing `/?em-bypass=all` produces a malformed request and a redirect error. Its JSON output can be opened in Speedscope.

Observed on 2026-09-20 (Pacific time), with the existing one-product catalog:

| Observation | Before | Default workload |
| --- | --- | --- |
| Shopify `render` entries | 36 ms, 39 ms | 365 ms |
| Samples reporting a render entry | 2 of 5 | 1 of 5 |
| Uncompressed document size | 125,752 bytes | 129,025 bytes |

A separate Shopify CLI profile attributed **336.64 ms** to this workload section and recorded **768 card**, **768 price**, and **768 badge** snippet executions. Its full profiled page took 518.50 ms. Profile timings include instrumentation and should not be equated with normal navigation timings. These are small diagnostic samples, not an SLA or a controlled cache-hit comparison. Later ordinary requests were faster and omitted `render`; a missing timing is not zero rendering time or proof of an EdgeMesh hit.

Useful references: [Shopify Liquid render](https://shopify.dev/docs/api/liquid/tags/render), [Liquid loop limits](https://shopify.dev/docs/api/liquid/tags/for), [Shopify CLI theme profiler](https://shopify.dev/docs/api/shopify-cli/theme/theme-profile).
