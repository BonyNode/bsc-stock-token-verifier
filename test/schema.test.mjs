// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTICES, SCHEMA_ID, validateSnapshot } from '../src/schema.js';

const AT = '2026-10-09T16:00:00.000Z';
const A1 = `0x${'a1'.repeat(20)}`;
const H1 = `0x${'11'.repeat(32)}`;
const S1 = `0x${'b1'.repeat(20)}`;

const family = (id, label) => ({
  id, label, wording: 'w', issuerList: 'src', crossChecks: [], claimMarkers: { symbolPattern: 'x', nameMarker: null }, notes: [],
  fingerprint: { measuredAt: AT, block: 1, method: 'm', roles: { token: { codeHash: H1, codeSize: 10, proxyKind: 'beacon', slot: 'beacon', slotValue: S1, members: 1, implementations: [], outliers: 0 } } },
});
const counts = (listed, genuine) => ({ listed, noCode: 0, genuine, unknown: listed - genuine, lookalikes: 0, byRole: null });
const empty = (extra = {}) => ({ status: 'skipped', reason: 'no_api_key', fetchedAt: null, items: [], ...extra });

/** The smallest snapshot that matches the schema: one genuine bStocks entry, no key used. */
export function minimalSnapshot() {
  return {
    schema: SCHEMA_ID,
    generatedAt: AT,
    generator: { name: 'stock-token-verifier', version: '0.2.0', gitCommit: null },
    chain: { id: 56, idHex: '0x38', name: 'BNB Smart Chain', block: 1, rpcHosts: ['bsc-dataseed.bnbchain.org'] },
    notices: { ...NOTICES },
    sources: [{ id: 'bsc-rpc', surface: 'chain', url: 'https://bsc-dataseed.bnbchain.org', status: 'ok', fetchedAt: AT, requests: 1, note: null, error: null }],
    families: { bstocks: family('bstocks', 'bStocks'), ondo: family('ondo', 'Ondo Stocks'), xstocks: family('xstocks', 'xStocks') },
    tokens: [{
      address: A1, family: 'bstocks', role: 'token', pairAddress: null, symbol: 'NVDAB', name: 'NVIDIA Corp', decimals: 18,
      underlyingTicker: 'NVDA', assetClass: 'stock', listedBy: ['binance-public:stock-list'],
      onchain: { readAt: AT, block: 1, codeSize: 10, codeHash: H1, beacon: S1, implementation: null, admin: null },
      creator: { status: 'not_checked', address: null, source: 'binance-w3:basic-info', fetchedAt: null },
      checks: { issuerList: true, hasCode: true, codeHash: true, proxy: true, creator: null },
      verdict: 'genuine', reasons: ['issuer_list', 'code_hash_match', 'proxy_match', 'creator_not_checked'], explanation: 'e',
    }],
    lookalikes: empty({ queries: 0, pageCap: 50, fullPages: 0, lowerBound: true, counts: { bstocks: 0, ondo: 0, xstocks: 0, total: 0 }, otherIssuerClaims: [] }),
    market: empty({ sizesUsd: [20, 100, 1000], sessions: [], walletPlaceholder: null }),
    prices: empty({ caveat: NOTICES.referencePrice }),
    summary: { measuredAt: AT, keyUsed: false, families: { bstocks: counts(1, 1), ondo: counts(0, 0), xstocks: counts(0, 0) }, lookalikes: { total: 0, lowerBound: true } },
  };
}

test('the minimal snapshot matches the schema', () => {
  assert.deepEqual(validateSnapshot(minimalSnapshot()), []);
});

test('a genuine verdict without a matching proxy slot is rejected', () => {
  const s = minimalSnapshot();
  s.tokens[0].checks.proxy = false;
  assert.ok(validateSnapshot(s).some((p) => /genuine only with list, code hash and proxy/.test(p)));
});

test('counts that do not add up, a changed notice and a skipped section with items are all rejected', () => {
  const s = minimalSnapshot();
  s.summary.families.bstocks.genuine = 0;
  s.notices.advice = 'buy';
  s.market.items.push({ address: A1, family: 'bstocks', quotes: [] });
  const problems = validateSnapshot(s);
  assert.ok(problems.some((p) => /bstocks.genuine equals/.test(p)));
  assert.ok(problems.some((p) => /notices carry the fixed sentences/.test(p)));
  assert.ok(problems.some((p) => /market has no items when skipped/.test(p)));
});

test('a source url with a query string, an unknown reason code and an RPC URL path are rejected', () => {
  const s = minimalSnapshot();
  s.sources[0].url = 'https://web3.binance.com/build/api/v1/dex/market/rwa/price?tokenContractAddresses=0x1';
  s.tokens[0].reasons.push('looks_fine');
  s.chain.rpcHosts = ['https://user:pass@host/path'];
  const problems = validateSnapshot(s);
  assert.ok(problems.some((p) => /no query string/.test(p)));
  assert.ok(problems.some((p) => /reasons are known codes/.test(p)));
  assert.ok(problems.some((p) => /host names only/.test(p)));
});
