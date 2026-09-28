import { discardCard } from './api.js';

export const DELAY_MS = 400;
// The server sometimes answers HTTP 500 for a card that it discards without
// a problem a few seconds later, so a failed card gets these extra tries.
export const RETRY_DELAYS_MS = [2000, 5000, 10000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A 4xx is a real refusal: a retry gets the same answer. A 5xx or a network
// error (no status) can be temporary.
const isTemporary = (err) => !(err.status >= 400 && err.status < 500);

// Discards one card at a time. Retries a temporary failure, then stops at the
// first card that still fails, and reports which id failed and why.
export async function runDiscardQueue(
  userCardIds,
  {
    delayMs = DELAY_MS,
    retryDelaysMs = RETRY_DELAYS_MS,
    onProgress = () => {},
    onRetry = () => {},
    discardFn = discardCard,
    sleepFn = sleep,
  } = {},
) {
  const done = [];
  for (const [i, id] of userCardIds.entries()) {
    if (i > 0) await sleepFn(delayMs);
    const error = await discardWithRetries(id, { retryDelaysMs, onRetry, discardFn, sleepFn });
    if (error !== null) return { done, failedAt: id, error };
    done.push(id);
    onProgress({ id, done: done.length, total: userCardIds.length });
  }
  return { done, failedAt: null, error: null };
}

// Returns null on success, or the error message of the last try.
async function discardWithRetries(id, { retryDelaysMs, onRetry, discardFn, sleepFn }) {
  for (let attempt = 0; ; attempt++) {
    let error;
    let temporary = true;
    try {
      if (await discardFn(id)) return null;
      error = 'the server refused the discard';
      temporary = false;
    } catch (err) {
      error = err.message && typeof err.message === 'string' ? err.message : String(err);
      temporary = isTemporary(err);
    }
    if (!temporary || attempt >= retryDelaysMs.length) return error;
    const waitMs = retryDelaysMs[attempt];
    onRetry({ id, attempt: attempt + 1, waitMs, error });
    await sleepFn(waitMs);
  }
}
