import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Five ordinary, serial page requests. No parallel load or cache-busting keys.
// Preview mode is for origin comparisons, not proof of EdgeMesh cache behavior.
const url = 'https://demo.edgemesh.com/?preview_theme_id=153508675674&em-bypass=all';
const directory = mkdtempSync(join(tmpdir(), 'edgemesh-liquid-'));
const samples = [];
try {
  for (let index = 0; index < 5; index++) {
    const timing = JSON.parse(execFileSync('curl', [
      '--silent', '--show-error', '--compressed', '--location', '--max-time', '40',
      '--cookie', join(directory, 'cookies'), '--cookie-jar', join(directory, 'cookies'),
      '--dump-header', join(directory, 'headers'), '--output', join(directory, 'page'),
      '--write-out', '%{json}', url,
    ], { encoding: 'utf8' }));
    const headers = readFileSync(join(directory, 'headers'), 'utf8');
    const page = readFileSync(join(directory, 'page'), 'utf8');
    if (timing.http_code !== 200 || !headers.includes('theme;desc="153508675674"')) {
      throw new Error(`Expected the unpublished demo theme with HTTP 200; received ${timing.http_code}.`);
    }
    if (/Liquid (?:error|syntax error)/i.test(page)) throw new Error('Shopify returned a Liquid error.');
    const cardCount = Number(page.match(/data-em-liquid-cards="(\d+)"/)?.[1] ?? 0);
    const variantCount = Number(page.match(/data-em-liquid-variants="(\d+)"/)?.[1] ?? 0);
    if (cardCount > 0 && variantCount === 0) throw new Error('Workload did not resolve real product variants.');
    const duration = (name) => {
      const matches = [...headers.matchAll(new RegExp(`(?:^|[, ])${name};dur=([\\d.]+)`, 'gm'))];
      return matches.length ? Number(matches.at(-1)[1]) : null;
    };
    samples.push({
      renderMs: duration('render'),
      processingMs: duration('processing'),
      ttfbMs: Math.round(timing.time_starttransfer * 1000),
      htmlBytes: Buffer.byteLength(page),
      workload: page.match(/data-em-liquid-cards="(\d+)"/)?.[1] ?? 'disabled',
      variantChecks: variantCount,
    });
  }
  const median = (key) => {
    const values = samples.map(sample => sample[key]).filter(value => value !== null).sort((a, b) => a - b);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), url, samples,
    renderTimingSamples: samples.filter(sample => sample.renderMs !== null).length,
    median: { renderMs: median('renderMs'), processingMs: median('processingMs'), ttfbMs: median('ttfbMs') },
  }, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
