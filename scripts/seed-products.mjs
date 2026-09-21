#!/usr/bin/env node
// Uses the Shopify CLI credential store; this script never reads or prints tokens.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const store = 'edgemesh.myshopify.com';
const products = JSON.parse(readFileSync(new URL('../catalog/products.json', import.meta.url), 'utf8'));
const apply = process.argv.includes('--apply');
if (!apply) {
  console.log(JSON.stringify({ store, products, next: 'Review the definitions, then run node scripts/seed-products.mjs --apply.' }, null, 2));
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), 'edgemesh-products-'));
function graphql(query, variables = {}) {
  writeFileSync(join(temp, 'query.graphql'), query);
  writeFileSync(join(temp, 'variables.json'), JSON.stringify(variables));
  const args = ['store', 'execute', '--store', store, '--version', '2026-07', '--query-file', join(temp, 'query.graphql'), '--variable-file', join(temp, 'variables.json'), '--output-file', join(temp, 'result.json'), '--json'];
  if (/^\s*mutation\b/.test(query)) args.push('--allow-mutations');
  execFileSync('shopify', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const response = JSON.parse(readFileSync(join(temp, 'result.json'), 'utf8'));
  if (response.errors?.length) throw new Error(JSON.stringify(response.errors));
  const data = response.data ?? response;
  for (const payload of Object.values(data)) {
    if (payload?.userErrors?.length) throw new Error(JSON.stringify(payload.userErrors));
  }
  return data;
}
try {
  const { shop, publications } = graphql('query { shop { name currencyCode primaryDomain { url } } publications(first: 50) { nodes { id name } } }');
  if (shop.currencyCode !== 'USD') throw new Error(`Catalog prices are USD; store currency is ${shop.currencyCode}. Review currency before creating products.`);
  const onlineStore = publications.nodes.find((p) => p.name === 'Online Store');
  if (!onlineStore) throw new Error('Online Store publication not found. No products were changed.');
  console.log(`Creating demo catalog for ${shop.name} (${shop.primaryDomain.url})`);
  for (const product of products) {
    const found = graphql('query($query: String!) { products(first: 10, query: $query) { nodes { id handle tags variants(first: 2) { nodes { id price } } } } }', { query: `handle:${product.handle}` });
    let existing = found.products.nodes.find((p) => p.handle === product.handle);
    if (existing && !existing.tags.includes('edgemesh-demo')) throw new Error(`Refusing to modify unrelated product ${product.handle}.`);
    if (existing && existing.variants.nodes.length !== 1) throw new Error(`Expected one demo variant for ${product.handle}; review the existing product.`);
    const input = { title: product.title, handle: product.handle, descriptionHtml: product.descriptionHtml, vendor: 'Edgemesh', productType: 'Demo service', tags: ['edgemesh-demo', product.handle], templateSuffix: 'edgemesh', status: 'DRAFT' };
    if (!existing) {
      const result = graphql('mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) { productCreate(product: $product, media: $media) { product { id handle variants(first: 1) { nodes { id } } } userErrors { field message } } }', {
        product: input,
        media: [{ originalSource: product.imageUrl, alt: product.imageAlt, mediaContentType: 'IMAGE' }],
      });
      existing = result.productCreate.product;
      console.log(`Created ${product.title}`);
    } else {
      // Keep the existing status and publication state when updating a demo product.
      delete input.status;
      graphql('mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }', { product: { id: existing.id, ...input } });
      console.log(`Updating existing demo product ${product.title}`);
    }
    graphql('mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $id, variants: $variants) { productVariants { id price } userErrors { field message } } }', {
      id: existing.id,
      variants: [{ id: existing.variants.nodes[0].id, price: product.price, taxable: false, inventoryPolicy: 'CONTINUE', inventoryItem: { requiresShipping: false, tracked: false, sku: `EM-DEMO-${product.handle.toUpperCase()}` } }],
    });
    graphql('mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id status } userErrors { field message } } }', { product: { id: existing.id, status: 'ACTIVE' } });
    graphql('mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }', { id: existing.id, input: [{ publicationId: onlineStore.id }] });
    const verified = graphql('query($id: ID!, $publication: ID!) { product(id: $id) { title handle status publishedOnPublication(publicationId: $publication) variants(first: 1) { nodes { price availableForSale inventoryItem { requiresShipping tracked } } } media(first: 4) { nodes { status alt mediaErrors { code message } } } } }', { id: existing.id, publication: onlineStore.id });
    console.log(JSON.stringify(verified.product));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
