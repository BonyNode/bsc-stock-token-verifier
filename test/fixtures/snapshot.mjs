// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The smallest snapshot that matches stv-bsc-snapshot/1, for tests that need one.
import { NOTICES, SCHEMA_ID } from '../../src/schema.js';

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

