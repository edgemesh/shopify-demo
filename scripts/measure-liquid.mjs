import { setTimeout as pause } from 'node:timers/promises';

// Serial published-storefront requests: no preview cookie or query nonce.
// The pause only spaces diagnostic requests; nothing delays the actual page.
const options = { url: 'https://demo.edgemesh.com/?em-bypass=all', samples: 5 };
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (flag === '--url' && value) options.url = value;
  else if (flag === '--samples' && value) options.samples = Number(value);
  else throw new Error('Usage: node scripts/measure-liquid.mjs [--url URL] [--samples 1..20]');
}
const url = new URL(options.url);
if (url.protocol !== 'https:') throw new Error('Use an HTTPS storefront URL.');
if (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 20) {
  throw new Error('Sample count must be between 1 and 20.');
}
const samples = [];
for (let index = 0; index < options.samples; index++) {
  if (index) await pause(1500);
  const started = performance.now();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(40000) });
  // Fetch resolves on the final response, not an interim HTTP 103 Early Hint.
  const finalHeadersMs = performance.now() - started;
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`Stopped at sample ${index + 1}: HTTP ${response.status}. No further requests sent.`);
  }
  const page = await response.text();
  const documentMs = performance.now() - started;
  const timing = response.headers.get('server-timing') || '';
  if (!timing.includes('theme;desc="153508675674"')) throw new Error('Response is not the Edgemesh demo theme.');
  if (/Liquid (?:error|syntax error)|Memory limits exceeded|Render limit exceeded/i.test(page)) {
    throw new Error('Shopify returned a Liquid error.');
  }
  const count = name => Number(page.match(new RegExp(`data-em-liquid-${name}="(\\d+)"`))?.[1] ?? 0);
  const cardCount = count('cards');
  const variantCount = count('variants');
  if (cardCount > 0 && variantCount === 0) throw new Error('Workload did not resolve real product variants.');
  const duration = name => {
    const match = timing.match(new RegExp(`(?:^|[, ])${name};dur=([\\d.]+)`));
    return match ? Number(match[1]) : null;
  };
  samples.push({
    renderMs: duration('render'), processingMs: duration('processing'),
    ttfbMs: Math.round(finalHeadersMs), documentMs: Math.round(documentMs),
    htmlBytes: Buffer.byteLength(page), cards: cardCount, variantChecks: variantCount,
    integrations: count('integrations'),
    edgeCache: /ems-cache-hit/i.test(timing) ? 'HIT' : /ems-cache-miss/i.test(timing) ? 'MISS or BYPASS' : 'not reported',
  });
  process.stderr.write(`Sample ${index + 1}/${options.samples}: final headers ${Math.round(finalHeadersMs)}ms, Liquid ${duration('render') ?? 'not reported'}ms\n`);
}
const summary = key => {
  const values = samples.map(sample => sample[key]).filter(value => value !== null).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return { min: values[0], median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, max: values.at(-1) };
};
console.log(JSON.stringify({
  measuredAt: new Date().toISOString(), url: url.href, samples,
  session: 'Anonymous HTTP requests; no cart or theme preview cookie.',
  note: 'documentMs measures HTML transfer only, not browser full load. Missing render timing does not mean zero render time.',
  renderTimingSamples: samples.filter(sample => sample.renderMs !== null).length,
  over700ms: samples.filter(sample => sample.ttfbMs > 700).length,
  summary: { renderMs: summary('renderMs'), processingMs: summary('processingMs'), ttfbMs: summary('ttfbMs'), documentMs: summary('documentMs') },
}, null, 2));
