import { discardCard } from './api.js';

export const DELAY_MS = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Discards one card at a time. Stops at the first failure instead of
// continuing blindly, and reports which id failed and why.
export async function runDiscardQueue(
  userCardIds,
  { delayMs = DELAY_MS, onProgress = () => {}, discardFn = discardCard, sleepFn = sleep } = {},
) {
  const done = [];
  for (const [i, id] of userCardIds.entries()) {
    if (i > 0) await sleepFn(delayMs);
    let ok;
    let error = null;
    try {
      ok = await discardFn(id);
    } catch (err) {
      ok = false;
      error = err.message && typeof err.message === 'string' ? err.message : String(err);
    }
    if (!ok) {
      if (error === null) {
        error = 'the server refused the discard';
      }
      return { done, failedAt: id, error };
    }
    done.push(id);
    onProgress({ id, done: done.length, total: userCardIds.length });
  }
  return { done, failedAt: null, error: null };
}
