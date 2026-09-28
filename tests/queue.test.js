import { describe, it, expect } from 'vitest';
import { DELAY_MS, runDiscardQueue } from '../extension/src/queue.js';

function recorder(results = {}) {
  const log = [];
  return {
    log,
    discardFn: async (id) => {
      log.push(`discard:${id}`);
      const r = results[id];
      if (r instanceof Error) throw r;
      return r ?? true;
    },
    sleepFn: async (ms) => { log.push(`sleep:${ms}`); },
  };
}

describe('runDiscardQueue', () => {
  it('uses a 400 ms default delay', () => expect(DELAY_MS).toBe(400));

  it('discards in order and sleeps only between calls', async () => {
    const r = recorder();
    const out = await runDiscardQueue(['a', 'b', 'c'], { delayMs: 400, discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(r.log).toEqual(['discard:a', 'sleep:400', 'discard:b', 'sleep:400', 'discard:c']);
    expect(out).toEqual({ done: ['a', 'b', 'c'], failedAt: null, error: null });
  });

  it('stops on the first false result', async () => {
    const r = recorder({ b: false });
    const out = await runDiscardQueue(['a', 'b', 'c'], { delayMs: 1, discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(r.log).toEqual(['discard:a', 'sleep:1', 'discard:b']);
    expect(out).toEqual({ done: ['a'], failedAt: 'b', error: 'the server refused the discard' });
  });

  it('treats a thrown error as a failure', async () => {
    const r = recorder({ a: new Error('network') });
    const out = await runDiscardQueue(['a', 'b'], { delayMs: 1, discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(out).toEqual({ done: [], failedAt: 'a', error: 'network' });
    expect(r.log).toEqual(['discard:a']);
  });

  it('reports progress after each success', async () => {
    const r = recorder();
    const seen = [];
    await runDiscardQueue(['a', 'b'], { delayMs: 1, discardFn: r.discardFn, sleepFn: r.sleepFn, onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([{ id: 'a', done: 1, total: 2 }, { id: 'b', done: 2, total: 2 }]);
  });

  it('does nothing for an empty list', async () => {
    const r = recorder();
    expect(await runDiscardQueue([], { discardFn: r.discardFn, sleepFn: r.sleepFn })).toEqual({ done: [], failedAt: null, error: null });
    expect(r.log).toEqual([]);
  });
});
