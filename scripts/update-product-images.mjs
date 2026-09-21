#!/usr/bin/env node
// Shopify CLI manages credentials. Only the four tagged demo products are eligible.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const store = 'edgemesh.myshopify.com';
const products = JSON.parse(readFileSync(new URL('../catalog/products.json', import.meta.url), 'utf8'));
const apply = process.argv.includes('--apply');
const temp = mkdtempSync(join(tmpdir(), 'edgemesh-product-images-'));

function graphql(query, variables = {}) {
  writeFileSync(join(temp, 'query.graphql'), query);
  writeFileSync(join(temp, 'variables.json'), JSON.stringify(variables));
  const args = ['store', 'execute', '--store', store, '--version', '2026-07', '--query-file', join(temp, 'query.graphql'), '--variable-file', join(temp, 'variables.json'), '--output-file', join(temp, 'result.json'), '--json'];
  if (/^\s*mutation\b/.test(query)) {
    if (!apply) throw new Error('Use --apply to update images.');
    args.push('--allow-mutations');
  }
  execFileSync('shopify', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const response = JSON.parse(readFileSync(join(temp, 'result.json'), 'utf8'));
  if (response.errors?.length) throw new Error(JSON.stringify(response.errors));
  const data = response.data ?? response;
  for (const payload of Object.values(data)) {
    const errors = [...(payload?.userErrors ?? []), ...(payload?.mediaUserErrors ?? [])];
    if (errors.length) throw new Error(JSON.stringify(errors));
  }
  return data;
}

const fields = `id handle tags featuredMedia { id } variants(first: 2) { nodes { id image { url } } }
  media(first: 30) { nodes { id alt status mediaErrors { code message } ... on MediaImage { image { url } } } }`;

async function waitFor(read, ready, label) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const value = read();
    if (ready(value)) return value;
    await delay(2000);
  }
  throw new Error(`Timed out waiting for ${label}; rerun to resume without duplicating images.`);
}

try {
  for (const image of products) {
    const found = graphql(`query($query: String!) { products(first: 10, query: $query) { nodes { ${fields} } } }`, { query: `handle:${image.handle}` });
    const product = found.products.nodes.find((item) => item.handle === image.handle);
    if (!product?.tags.includes('edgemesh-demo')) throw new Error(`Refusing to modify unrelated or missing product ${image.handle}.`);
    if (product.variants.nodes.length !== 1) throw new Error(`Expected one demo variant for ${image.handle}.`);
    if (!apply) {
      console.log(JSON.stringify({ handle: image.handle, id: product.id, imageUrl: image.imageUrl, alt: image.imageAlt }));
      continue;
    }

    let media = product.media.nodes.find((item) => item.alt === image.imageAlt);
    if (!media) {
      const updated = graphql(`mutation($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) { product { ${fields} } userErrors { field message } }
      }`, { product: { id: product.id }, media: [{ originalSource: image.imageUrl, alt: image.imageAlt, mediaContentType: 'IMAGE' }] });
      media = updated.productUpdate.product.media.nodes.find((item) => item.alt === image.imageAlt);
      if (!media) throw new Error(`Shopify did not return the new image for ${image.handle}.`);
    }
    await waitFor(
      () => graphql('query($id: ID!) { node(id: $id) { ... on MediaImage { status mediaErrors { code message } } } }', { id: media.id }).node,
      (item) => {
        if (item.status === 'FAILED') throw new Error(JSON.stringify(item.mediaErrors));
        return item.status === 'READY';
      },
      `${image.handle} image processing`
    );

    const { productReorderMedia } = graphql(`mutation($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) { job { id done } mediaUserErrors { field message } }
    }`, { id: product.id, moves: [{ id: media.id, newPosition: '0' }] });
    if (productReorderMedia.job) {
      await waitFor(
        () => graphql('query($id: ID!) { job(id: $id) { done } }', { id: productReorderMedia.job.id }).job,
        (job) => job.done,
        `${image.handle} image ordering`
      );
    }
    graphql(`mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $id, variants: $variants) { productVariants { id } userErrors { field message } }
    }`, { id: product.id, variants: [{ id: product.variants.nodes[0].id, mediaId: media.id }] });

    const verified = graphql(`query($id: ID!) { product(id: $id) { ${fields} } }`, { id: product.id }).product;
    const uploaded = verified.media.nodes.find((item) => item.id === media.id);
    if (verified.featuredMedia?.id !== media.id || verified.variants.nodes[0].image?.url !== uploaded.image?.url) {
      throw new Error(`Featured or variant image did not update for ${image.handle}.`);
    }
    console.log(JSON.stringify({ handle: image.handle, mediaId: media.id, status: uploaded.status, imageUrl: uploaded.image.url }));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
