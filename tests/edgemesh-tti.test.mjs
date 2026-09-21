import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/edgemesh-tti.js', import.meta.url), 'utf8');

function fixture({ readyState = 'interactive', supported = true, tasks = [], pending = [], paint = 400 } = {}) {
  const timers = [];
  const listeners = new Map();
  let disconnected = false;
  const nav = { startTime: 0, domContentLoadedEventEnd: 600 };
  const window = {
    __tti: supported ? {
      e: tasks,
      o: { takeRecords: () => pending, disconnect: () => { disconnected = true; } },
    } : undefined,
    addEventListener: (name, handler) => listeners.set(name, handler),
  };
  vm.runInNewContext(source, {
    window,
    document: { readyState },
    performance: {
      getEntriesByType: () => [nav],
      getEntriesByName: () => [{ startTime: paint }],
    },
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  return { measure: window.edgemeshTti.measure, nav, timers, listeners, disconnected: () => disconnected };
}

test('waits for load handlers but adds no quiet-window delay, including queued long tasks', async () => {
  const f = fixture({ tasks: [{ startTime: 650, duration: 75 }], pending: [{ startTime: 750, duration: 100 }] });
  const result = f.measure();
  assert.equal(f.measure(), result);
  assert.equal(f.timers.length, 0);
  f.listeners.get('load')();
  assert.deepEqual(f.timers.map(timer => timer.delay), [0]);
  f.timers[0].callback();
  assert.equal(await result, 850);
  assert.equal(f.disconnected(), true);
  assert.equal(f.timers.length, 1);
});

test('already loaded pages use DOM readiness and first contentful paint as lower bounds', async () => {
  for (const [paint, expected] of [[400, 600], [800, 800]]) {
    const f = fixture({ readyState: 'complete', paint, tasks: [{ startTime: 100, duration: 60 }] });
    const result = f.measure();
    assert.equal(f.timers[0].delay, 0);
    f.timers[0].callback();
    assert.equal(await result, expected);
  }
});

test('unsupported observers or missing navigation timing produce no invented measurement', async () => {
  assert.equal(await fixture({ supported: false }).measure(), null);
  const f = fixture({ readyState: 'complete' });
  f.nav.domContentLoadedEventEnd = 0;
  const result = f.measure();
  f.timers[0].callback();
  assert.equal(await result, null);
  assert.equal(f.disconnected(), true);
});
