import { describe, it, expect } from 'vitest';
import { DELAY_MS, RETRY_DELAYS_MS, runDiscardQueue } from '../extension/src/queue.js';

// results[id] is one outcome, or an array of outcomes for successive tries.
function recorder(results = {}) {
  const log = [];
  const tries = {};
  return {
    log,
    discardFn: async (id) => {
      log.push(`discard:${id}`);
      const n = tries[id] = (tries[id] ?? 0) + 1;
      const r = Array.isArray(results[id]) ? results[id][n - 1] : results[id];
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
    const out = await runDiscardQueue(['a', 'b'], { delayMs: 1, retryDelaysMs: [], discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(out).toEqual({ done: [], failedAt: 'a', error: 'network' });
    expect(r.log).toEqual(['discard:a']);
  });

  it('waits 2, 5, then 10 s between tries by default', () => expect(RETRY_DELAYS_MS).toEqual([2000, 5000, 10000]));

  it('tries a card again after a server error, then continues', async () => {
    const r = recorder({ a: [httpError(500), true] });
    const retries = [];
    const out = await runDiscardQueue(['a', 'b'], {
      delayMs: 1, retryDelaysMs: [20, 50], discardFn: r.discardFn, sleepFn: r.sleepFn, onRetry: (p) => retries.push(p),
    });
    expect(r.log).toEqual(['discard:a', 'sleep:20', 'discard:a', 'sleep:1', 'discard:b']);
    expect(retries).toEqual([{ id: 'a', attempt: 1, waitMs: 20, error: 'HTTP 500' }]);
    expect(out).toEqual({ done: ['a', 'b'], failedAt: null, error: null });
  });

  it('stops after the last retry fails', async () => {
    const r = recorder({ a: [httpError(500), httpError(502), httpError(500)] });
    const out = await runDiscardQueue(['a', 'b'], { delayMs: 1, retryDelaysMs: [20, 50], discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(r.log).toEqual(['discard:a', 'sleep:20', 'discard:a', 'sleep:50', 'discard:a']);
    expect(out).toEqual({ done: [], failedAt: 'a', error: 'HTTP 500' });
  });

  it('retries a network error, which has no status', async () => {
    const r = recorder({ a: [new Error('network'), true] });
    const out = await runDiscardQueue(['a'], { delayMs: 1, retryDelaysMs: [20], discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(out.done).toEqual(['a']);
  });

  it('does not retry a 4xx refusal', async () => {
    const r = recorder({ a: httpError(403) });
    const out = await runDiscardQueue(['a'], { delayMs: 1, retryDelaysMs: [20], discardFn: r.discardFn, sleepFn: r.sleepFn });
    expect(r.log).toEqual(['discard:a']);
    expect(out).toEqual({ done: [], failedAt: 'a', error: 'HTTP 403' });
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

function httpError(status) {
  const err = new Error(`HTTP ${status}`);
  err.status = status;
  return err;
}
