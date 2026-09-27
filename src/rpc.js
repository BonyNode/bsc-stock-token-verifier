// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// JSON-RPC client for Robinhood Chain: batches, failover across endpoints, and a pace that stays
// below the public node's limits.
//
// Why the numbers are what they are (measured 2026-09-20): the public node answers HTTP 429 at
// ~4–5 requests per second, and a batch of 8 calls came back in ~270 ms. Batching and pacing keep
// load well below the public node's documented rate limits. There is no eth_getLogs anywhere in
// this package: the public node caps it at 10 000 results per call.
import { CHAIN_ID_HEX, rpcUrlsFromEnv } from './chain.js';

export const BATCH_MAX = 8;
export const BATCH_GAP_MS = 120;
export const RPC_TIMEOUT_MS = 12_000;

/**
 * Every URL in a message cut to its scheme and host: an operator's provider URL can carry a key in
 * its path or query, or a login and password before the host. Apply it BEFORE shortening a message —
 * a URL cut in the middle is no longer recognised as one, and its secret would pass as the host.
 */
export const hideUrlSecrets = (message) => String(message)
  .replace(/\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#]*@)?([^\s/?#)]+)[^\s)]*/gi, '$1://$2');

/**
 * @param {object} [options]
 * @param {string[]} [options.urls]      endpoints in order of preference
 * @param {Function} [options.fetchImpl] fetch-compatible function (tests inject a stub)
 */
export function createRpc({ urls = rpcUrlsFromEnv(), fetchImpl = globalThis.fetch, timeoutMs = RPC_TIMEOUT_MS, gapMs = BATCH_GAP_MS } = {}) {
  if (!urls.length) throw new TypeError('at least one RPC url is required');
  let preferred = 0;
  let answeredBy = null;

  /** One batch of ≤ BATCH_MAX calls. Per-call errors (reverts) come back as { error }. */
  async function batch(calls) {
    if (!calls.length) return [];
    if (calls.length > BATCH_MAX) throw new Error(`rpc batch of ${calls.length} exceeds the ${BATCH_MAX} cap`);
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params || [] }));
    let last = null;
    for (let hop = 0; hop < urls.length; hop += 1) {
      const index = (preferred + hop) % urls.length;
      try {
        const response = await fetchImpl(urls[index], {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!Array.isArray(json)) throw new Error('batch answer is not an array');
        preferred = index;
        answeredBy = urls[index];
        // The specification does not guarantee the order of batch answers: match them by id.
        const byId = new Map(json.map((r) => [r.id, r]));
        return body.map((c) => byId.get(c.id) || { error: { message: 'no answer for this id' } });
      } catch (error) {
        last = error;
      }
    }
    throw new Error(`all ${urls.length} Robinhood Chain RPC endpoints failed: ${hideUrlSecrets(last?.message || last).slice(0, 120)}`);
  }

  /** Any number of calls, in sequential batches with a pause between them. Never a parallel burst. */
  async function paced(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += BATCH_MAX) {
      if (i > 0 && gapMs > 0) await new Promise((resolve) => { setTimeout(resolve, gapMs); });
      out.push(...await batch(calls.slice(i, i + BATCH_MAX)));
    }
    return out;
  }

  return { batch, paced, urls: [...urls], get answeredBy() { return answeredBy; } };
}

/** The chain must introduce itself: an endpoint answering another chain id describes another chain. */
export function assertChainId(answer) {
  const got = String(answer?.result ?? '').toLowerCase();
  if (got !== CHAIN_ID_HEX) throw new Error(`rpc answered chainId ${answer?.result ?? 'nothing'}, expected ${CHAIN_ID_HEX}`);
}

export const hexToBigInt = (value) => (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : null);
export const hexToNumber = (value) => { const big = hexToBigInt(value); return big === null ? null : Number(big); };
