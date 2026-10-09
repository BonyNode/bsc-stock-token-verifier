// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// JSON-RPC client for BNB Smart Chain: batches, failover across endpoints, and a pace that stays
// well below what public nodes allow.
//
// Why the numbers are what they are (measured 2026-10-09): bsc-dataseed.bnbchain.org and
// bsc-rpc.publicnode.com answered a batch of 24 eth_getCode calls in 110–320 ms; a free drpc.org
// endpoint refuses batches of more than 3. Batches of 20 with a pause between them keep a full
// fingerprint pass (≈ 9 000 calls) to a few minutes without bursts. No eth_getLogs anywhere.
import { CHAIN_ID_HEX, hostOf, rpcUrlsFromEnv } from './chain.js';

export const BATCH_MAX = 20;
export const BATCH_GAP_MS = 150;
export const RPC_TIMEOUT_MS = 15_000;

/**
 * Every URL in a message cut to its scheme and host: an operator's provider URL can carry a key in
 * its path or query, or a login and password before the host. Apply it BEFORE shortening a message —
 * a URL cut in the middle is no longer recognised as one, and its secret would pass as the host.
 */
export const hideUrlSecrets = (message) => String(message)
  .replace(/\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#]*@)?([^\s/?#)]+)[^\s)]*/gi, '$1://$2');

/** An execution revert is an answer about the contract; anything else in every slot is the endpoint's refusal. */
const isRevert = (error) => /revert/i.test(String(error?.message || '')) || error?.code === 3;

/**
 * @param {object} [options]
 * @param {string[]} [options.urls]      endpoints in order of preference
 * @param {Function} [options.fetchImpl] fetch-compatible function (tests inject a stub)
 * @param {number} [options.batchMax]    calls per JSON-RPC batch
 */
export function createRpc({ urls = rpcUrlsFromEnv(), fetchImpl = globalThis.fetch, timeoutMs = RPC_TIMEOUT_MS, gapMs = BATCH_GAP_MS, batchMax = BATCH_MAX } = {}) {
  if (!urls.length) throw new TypeError('at least one RPC url is required');
  let preferred = 0;
  let answeredBy = null;
  let requests = 0;

  /** One batch of ≤ batchMax calls. Per-call errors (reverts) come back as { error }. */
  async function batch(calls) {
    if (!calls.length) return [];
    if (calls.length > batchMax) throw new Error(`rpc batch of ${calls.length} exceeds the ${batchMax} cap`);
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params || [] }));
    let last = null;
    for (let hop = 0; hop < urls.length; hop += 1) {
      const index = (preferred + hop) % urls.length;
      try {
        requests += 1;
        const response = await fetchImpl(urls[index], {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        let json = null;
        try { json = await response.json(); } catch { /* handled below */ }
        if (!Array.isArray(json)) throw new Error(`HTTP ${response.status}: batch answer is not an array`);
        // The specification does not guarantee the order of batch answers: match them by id.
        const byId = new Map(json.map((r) => [r.id, r]));
        const answers = body.map((c) => byId.get(c.id) || { error: { message: 'no answer for this id' } });
        // An endpoint that refuses the batch itself (plan limits, rate limits) answers an error in
        // every slot: that is a failure of the endpoint, not an answer about the contracts.
        if (answers.every((a) => a.error && !isRevert(a.error))) throw new Error(`HTTP ${response.status}: ${String(answers[0].error.message).slice(0, 100)}`);
        preferred = index;
        answeredBy = urls[index];
        return answers;
      } catch (error) {
        last = error;
      }
    }
    throw new Error(`all ${urls.length} BSC RPC endpoints failed: ${hideUrlSecrets(last?.message || last).slice(0, 160)}`);
  }

  /** Any number of calls, in sequential batches with a pause between them. Never a parallel burst. */
  async function paced(calls, { onBatch } = {}) {
    const out = [];
    for (let i = 0; i < calls.length; i += batchMax) {
      if (i > 0 && gapMs > 0) await new Promise((resolve) => { setTimeout(resolve, gapMs); });
      out.push(...await batch(calls.slice(i, i + batchMax)));
      if (onBatch) onBatch(Math.min(i + batchMax, calls.length), calls.length);
    }
    return out;
  }

  return {
    batch, paced, urls: [...urls], batchMax,
    get answeredBy() { return answeredBy; },
    get answeredHost() { return answeredBy ? hostOf(answeredBy) : null; },
    get requests() { return requests; },
  };
}

/** The chain must introduce itself: an endpoint answering another chain id describes another chain. */
export function assertChainId(answer) {
  const got = String(answer?.result ?? '').toLowerCase();
  if (got !== CHAIN_ID_HEX) throw new Error(`rpc answered chainId ${answer?.result ?? 'nothing'}, expected ${CHAIN_ID_HEX}`);
}

export const hexToBigInt = (value) => (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : null);
export const hexToNumber = (value) => { const big = hexToBigInt(value); return big === null ? null : Number(big); };
