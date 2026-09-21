# Edgemesh Shopify demo

A Shopify Horizon theme for **edgemesh.myshopify.com**, whose primary storefront is **demo.edgemesh.com**. The slate/violet design, Inter and Geist Mono fonts, service descriptions, and pricing come from the adjacent Edgemesh marketing repository. Product artwork is a coordinated set of custom 3D illustrations, and the hero uses the supplied Edgemesh dashboard screenshot.

The review theme is **Edgemesh Demo — Horizon**, ID **153508675674**. It is unpublished.

- [Preview](https://edgemesh.myshopify.com/?preview_theme_id=153508675674)
- [Direct Shopify preview](https://edgemesh.myshopify.com/?_fd=0&pb=0&preview_theme_id=153508675674) for checking the origin when the custom domain is unavailable. Navigation and cart requests can still redirect to the primary domain.
- [Theme editor](https://edgemesh.myshopify.com/admin/themes/153508675674/editor)

## Shopify CLI

Requires Shopify CLI 4.8+ and Node 24+. No frontend build step or npm dependencies are required.

```sh
npm run check
npm run dev
npm run push
```

The `demo` environment in `shopify.theme.toml` targets only the unpublished theme. These commands do not publish it as the live theme.

## Products

`catalog/products.json` contains the reviewed product copy, current image URLs, original marketing image references, and USD prices:

| Product | Demo price | Marketing terms |
| --- | --- | --- |
| Security | $0 | Qualified Shopify brands with $25M+ annual GMV |
| Signal | $0 | Qualified Shopify brands with $25M+ annual GMV |
| Performance | $3,950 | Per month, per domain; cancel anytime |
| Allocation | $7,500 | Per month, per domain; performance guarantee |

These are non-shipping demo products, with no subscription or service activation. Seeding requires a separate Shopify CLI store API connection; theme authentication alone does not grant product access.

All four products were created through Shopify CLI and published to the Online Store on 2026-09-20. Their marketing images finished processing successfully. The direct Shopify preview resolves all four products; Performance was added at $3,950 and removed afterward to verify the product and price.

The current product artwork uses charcoal backgrounds, violet glass, and brushed metal: Security's shield, Signal's waveform aperture, Performance's edge processor, and Allocation's rising portfolio stacks. The built-in image generation tool produced the 1254 × 1254 PNG masters in `catalog/product-images/`; `prompts.json` records the full prompt set. Optimized `assets/edgemesh-*-v2.webp` files are 81–92 KB each. Square card and product-page layouts preserve the complete artwork. The original marketing assets remain available.

The supplied 3600 × 2000 hero screenshot is preserved in `catalog/hero/edgemesh-dashboard-original.png`. Responsive 900- and 1800-pixel WebP versions in `assets/` replace the image within the original hero framing and floating callout layout.

After uploading the theme assets, `node scripts/update-product-images.mjs --apply` adds the catalog artwork to the four tagged demo products, waits for processing, makes it the featured image, and assigns it to the single product variant so cart thumbnails match. It retains the earlier product media and resumes without duplicating images. Omit `--apply` to inspect the planned updates. The script uses [Shopify product media APIs](https://shopify.dev/docs/apps/build/product-merchandising/products-and-collections/manage-media) through Shopify CLI's stored authentication.

```sh
shopify store auth --store edgemesh.myshopify.com --scopes read_products,write_products,read_publications,write_publications
npm run products:plan
npm run products:apply
```

The seed script checks USD currency, finds the Online Store publication, refuses to overwrite products without the `edgemesh-demo` tag, sets prices before publishing, and can resume after partial completion. It uses Shopify CLI's credential storage without reading or logging tokens. Products are assigned the `edgemesh` template. No existing store products are removed.

## Implementation

- `sections/edgemesh-*`: storefront, product detail, and dynamic-content explanation.
- `snippets/edgemesh-buy-button.liquid`: Horizon's native product form.
- `assets/edgemesh-demo.js`: safe cart shell refresh, fragment refresh, observed demo status.
- `snippets/edgemesh-vitals.liquid` and `assets/edgemesh-vitals.js`: page timings and cache switch.
- `assets/edgemesh-metrics.js`: tested timing/cache/URL logic.
- `snippets/edgemesh-icon.liquid`: selected Lucide SVGs, rendered inline without a client icon library. `edgemesh-loading` supplies accessible, reduced-motion-aware stat spinners.
- [Dynamic-content and measurement details](docs/DYNAMIC-CONTENT.md).
- [Configurable Liquid workload and measured server cost](docs/LIQUID-WORKLOAD.md): repeated catalog/variant/card rendering on home and product pages.
- `tests/*.test.mjs`: mutation/render race, null section, failure, metrics, and URL preservation tests.

Theme Check has six warnings inherited unchanged from Horizon: one excessive-settings warning and five unused snippet documentation parameters. The custom implementation adds no warnings.

## Sources and licenses

Based on [Shopify/Horizon](https://github.com/Shopify/horizon) at commit `8b42ace57642e45a3a59841d2ae06d386c929e72`. Shopify's license remains in `LICENSE.md`; its original README is retained in `UPSTREAM.md`.

Marketing assets and copy were extracted from `/Users/rl/Code/projects/edgemesh/marketing` on 2026-09-20. Font licenses and the notice for the previously used TTI polyfill are in `catalog/`. The TTI script now reports a custom interactivity estimate immediately after page load, without the five-second quiet window.

Lucide icons are vendored from the official `lucide-static` 1.47.0 package. The selected names and source are recorded in `catalog/lucide-icons.json`; the ISC and inherited Feather MIT notices ship with the theme in `assets/edgemesh-lucide-license.txt`. SVG paths are unchanged; the shared wrapper uses the storefront's 1.75px stroke and decorative accessibility attributes.
