// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Read-only HTTP API on node:http. No key, CORS open, GET/HEAD only.
//
//   GET /api/public/robinhood-chain                    module catalogue
//   GET /api/public/robinhood-chain/stock-tokens       registry + live multipliers (same path as the live showcase)
//   GET /api/public/robinhood-chain/verify/:address    live authenticity verdict (?deployer=1 adds the explorer lookup)
//
// A failing upstream answers HTTP 503 with the reason, never HTTP 200 with an invented empty set.
import http from 'node:http';
import { CHAIN_ID } from './chain.js';
import { loadStockTokens } from './catalogue.js';
import { AUTHENTICITY } from './registry.js';
import { createRpc, hideUrlSecrets } from './rpc.js';
import { isAddress, verifyAddress } from './verify.js';

export const API_BASE = '/api/public/robinhood-chain';
export const SHOWCASE = 'https://xprimeflow.trade/robinhood-chain';
const SOURCE = 'robinhood-chain-rpc';

export const POLICY = Object.freeze({
  stockTokens: { freshMs: 5 * 60_000, staleMs: 2 * 60 * 60_000 },
  verify: { freshMs: 5 * 60_000, staleMs: 0 },
});

export const RATE_LIMIT = Object.freeze({ regular: 60, heavy: 30, windowMs: 60_000 });

export const MODULE_INFO = Object.freeze({
  module: 'X PrimeFlow Stock Token Verifier — Powered by Robinhood Chain',
  disclaimer: 'This project is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.',
  chain: CHAIN_ID,
  access: 'free public read API, no key required',
  publicBase: API_BASE,
  showcase: SHOWCASE,
  rateLimit: { requestsPerMinute: RATE_LIMIT.regular, heavyEndpointsPerMinute: RATE_LIMIT.heavy, scope: 'per IP' },
  endpoints: [
    { path: '/stock-tokens', desc: `the registry of ${AUTHENTICITY.genuine} genuine Stock Tokens with their live corporate-action multiplier, and the rule that separated them from ${AUTHENTICITY.rejected} look-alikes` },
    { path: '/verify/:address', desc: 'a live authenticity verdict for one contract: authentic, counterfeit, unlisted, none or unreadable, with the facts it was derived from; ?deployer=1 adds the contract creator from the chain explorer' },
  ],
  honesty: [
    'A failing upstream returns HTTP 503 with a reason, never HTTP 200 with an invented empty set.',
    'Every figure carries how it was computed, over what period, and which source it came from.',
    'Stock Token data is for verification and display only, not for resale: the stock-tokens answer carries resaleOk: false.',
  ],
  terminology: 'These assets are called Stock Tokens. That is the issuer\'s required term and this module uses no other.',
});

/** Small TTL cache with single-flight and stale-on-error. */
function createCache({ maxEntries = 512, now = () => Date.now() } = {}) {
  const values = new Map();
  const inflight = new Map();
  return async function get(key, { freshMs, staleMs }, producer, shouldStore = () => true) {
    const hit = values.get(key);
    const age = hit ? now() - hit.t : Infinity;
    if (hit && age < freshMs) return hit;
    let pending = inflight.get(key);
    if (!pending) {
      pending = Promise.resolve().then(producer).then((v) => {
        const entry = { t: now(), v };
        if (shouldStore(v)) {
          values.delete(key);
          values.set(key, entry);
          while (values.size > maxEntries) values.delete(values.keys().next().value);
        }
        return entry;
      }).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    try {
      return await pending;
    } catch (error) {
      if (hit && age < staleMs) return { ...hit, stale: true };
      throw error;
    }
  };
}

function createLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 10_000) hits.delete(hits.keys().next().value);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

// Local file paths never leave the process, and a URL is cut to its scheme and host: an operator's
// provider URL can carry a key in its path, query or user part. Cleaned first, shortened after.
const scrub = (message) => hideUrlSecrets(message || 'unknown error')
  .replace(/(^|[\s(])\/[^\s)]+/g, '$1[path]')
  .slice(0, 220);

/** A verify result as the HTTP API serves it: without the upstream endpoint, errors scrubbed. */
function publicVerify({ rpc, ...result }) {
  return {
    ...result,
    ...(result.error ? { error: scrub(result.error) } : {}),
    ...(result.deployerError ? { deployerError: scrub(result.deployerError) } : {}),
  };
}

/** The client address: the socket peer, or behind your own proxy the entry that proxy appended. */
function clientIp(req, trustProxy) {
  // The rightmost X-Forwarded-For entry is written by the proxy next to this server; everything to
  // its left arrives from the client and can be forged to dodge the rate limit.
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  return forwarded.at(-1) || req.socket.remoteAddress || 'unknown';
}

/**
 * @param {object} [options]
 * @param {object} [options.rpc]        client from createRpc()
 * @param {Function} [options.fetchImpl] used for the explorer lookup
 * @param {boolean} [options.trustProxy] take the client IP from the rightmost X-Forwarded-For entry (only behind your own proxy)
 */
export function createApiServer({ rpc = createRpc(), fetchImpl = globalThis.fetch, explorer, trustProxy = false, now } = {}) {
  const cache = createCache({ now });
  const regular = createLimiter({ limit: RATE_LIMIT.regular, windowMs: RATE_LIMIT.windowMs, now });
  const heavy = createLimiter({ limit: RATE_LIMIT.heavy, windowMs: RATE_LIMIT.windowMs, now });

  const send = (res, status, body, cacheControl) => {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': cacheControl || (status === 200 ? 'public, max-age=30, stale-while-revalidate=60' : 'no-store'),
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'x-content-type-options': 'nosniff',
    });
    res.end(res.req.method === 'HEAD' ? undefined : text);
  };
  const envelope = (section, { data, partial = false, failed = [], asOf = null }) => ({
    ok: true, source: SOURCE, chain: CHAIN_ID, section, asOf, partial, failed, data, ts: Date.now(),
  });
  const failure = (section, error, extra = {}) => ({
    ok: false, source: SOURCE, chain: CHAIN_ID, section, error: 'source_unavailable', detail: scrub(error?.message || error), ...extra, ts: Date.now(),
  });

  async function route(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { send(res, 400, { ok: false, error: 'bad_request', detail: 'malformed request target' }); return; }
    const path = url.pathname.replace(/\/+$/, '');
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS' }); res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { ok: false, error: 'method_not_allowed' }); return; }

    const ip = clientIp(req, trustProxy);
    const isHeavy = path === `${API_BASE}/stock-tokens` || path.startsWith(`${API_BASE}/verify/`);
    if (!(isHeavy ? heavy : regular)(ip)) { send(res, 429, { ok: false, error: 'rate_limited', retryAfterMs: RATE_LIMIT.windowMs }); return; }

    if (path === API_BASE) { send(res, 200, envelope('index', { data: MODULE_INFO })); return; }

    if (path === `${API_BASE}/stock-tokens`) {
      try {
        const entry = await cache('stock-tokens', POLICY.stockTokens, () => loadStockTokens(rpc));
        send(res, 200, envelope('stockTokens', { ...entry.v, asOf: entry.t, partial: entry.v.partial || entry.stale === true }));
      } catch (error) {
        send(res, 503, failure('stockTokens', error));
      }
      return;
    }

    const match = path.match(new RegExp(`^${API_BASE}/verify/([^/]+)$`));
    if (match) {
      let address = '';
      try { address = decodeURIComponent(match[1]); } catch { /* malformed escape: rejected below */ }
      if (!isAddress(address)) { send(res, 400, { ok: false, error: 'bad_address', detail: 'expected a 0x-prefixed 20-byte hex address' }); return; }
      const withDeployer = url.searchParams.get('deployer') === '1';
      const key = `${address.toLowerCase()}|${withDeployer ? 'd' : '-'}`;
      const entry = await cache(key, POLICY.verify, () => verifyAddress(address, { rpc, withDeployer, explorer, fetchImpl }),
        (result) => result.verdict !== 'unreadable');
      if (entry.v.verdict === 'unreadable') { send(res, 503, failure('verify', entry.v.error || entry.v.reason, { data: publicVerify(entry.v) })); return; }
      send(res, 200, envelope('verify', { data: publicVerify(entry.v), asOf: entry.t, partial: withDeployer && !entry.v.deployerChecked, failed: entry.v.deployerError ? ['deployer'] : [] }));
      return;
    }

    send(res, 404, { ok: false, error: 'not_found', endpoints: [API_BASE, `${API_BASE}/stock-tokens`, `${API_BASE}/verify/:address`] });
  }

  return http.createServer((req, res) => {
    route(req, res).catch((error) => { if (!res.headersSent) send(res, 500, { ok: false, error: 'internal', detail: scrub(error?.message) }); });
  });
}
