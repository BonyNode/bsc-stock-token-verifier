// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Keyless Binance Web3 endpoints, as documented in Binance's own skills repository
// (github.com/binance/binance-skills-hub: binance-tokenized-securities-info, query-token-info).
// They need no key, so they serve two purposes here: a cross-check of the keyed API, and a reduced
// mode that anyone can run without a Binance key. Everything they return is labelled with the
// `binance-public:` source ids and is never merged with keyed results.
//
// Pace: one request at a time, at least 300 ms apart. No retries beyond one after HTTP 429.
import { CHAIN_ID } from './chain.js';
import { USER_AGENT } from './binance-web3.js';

export const PUBLIC_ENDPOINTS = Object.freeze({
  stockList: { url: 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai', source: 'binance-public:stock-list' },
  marketStatus: { url: 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/market/status/ai', source: 'binance-public:market-status' },
  tokenSearch: { url: 'https://web3.binance.com/bapi/defi/v5/public/wallet-direct/buw/wallet/market/token/search/ai', source: 'binance-public:token-search' },
});

/** `type` in the keyless stock list → family. Measured 2026-10-09 on chain 56 (see docs/devex-observations.md). */
export const PUBLIC_TYPE_FAMILY = Object.freeze({ 1: 'ondo', 2: 'xstocks', 3: 'bstocks' });

export class PublicApiError extends Error {
  constructor(message, { http = null, code = null, source = null } = {}) {
    super(message);
    this.name = 'PublicApiError';
    this.http = http;
    this.code = code;
    this.source = source;
  }
}

export function createBinancePublic({ fetchImpl = globalThis.fetch, gapMs = 300, now = () => Date.now(), sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }), timeoutMs = 30_000 } = {}) {
  let last = -Infinity;
  const log = [];
  const counts = {};

  async function get(name, query = {}) {
    const ep = PUBLIC_ENDPOINTS[name];
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString();
    for (let attempt = 0; ; attempt += 1) {
      const wait = last + gapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      counts[ep.source] = (counts[ep.source] || 0) + 1;
      const entry = { at: new Date(now()).toISOString(), source: ep.source, http: null, code: null, rows: null };
      log.push(entry);
      let response;
      try {
        response = await fetchImpl(`${ep.url}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json', 'accept-encoding': 'identity', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        throw new PublicApiError(`${ep.source}: network error: ${String(error?.message || error).slice(0, 160)}`, { source: ep.source });
      }
      entry.http = response.status;
      if (response.status === 429 && attempt === 0) { await sleep(2000); continue; }
      let json = null;
      try { json = await response.json(); } catch { /* handled below */ }
      entry.code = json?.code ?? null;
      if (!response.ok || !json || json.success !== true || json.code !== '000000') {
        throw new PublicApiError(`${ep.source}: HTTP ${response.status}, code ${json?.code ?? 'none'}: ${String(json?.message ?? 'no message').slice(0, 160)}`, { http: response.status, code: json?.code ?? null, source: ep.source });
      }
      if (Array.isArray(json.data)) entry.rows = json.data.length;
      return json.data;
    }
  }

  return {
    log, counts, get requests() { return log.length; },

    /** Every RWA row Binance lists for chain 56, grouped by family; other types are counted, not used. */
    async stockList() {
      const data = await get('stockList');
      if (!Array.isArray(data)) throw new PublicApiError('binance-public:stock-list: data is not a list', { source: PUBLIC_ENDPOINTS.stockList.source });
      const rows = data.filter((r) => String(r?.chainId) === String(CHAIN_ID));
      const byFamily = { bstocks: [], ondo: [], xstocks: [] };
      const otherTypes = {};
      for (const r of rows) {
        const family = PUBLIC_TYPE_FAMILY[r.type];
        if (!family) { otherTypes[r.type] = (otherTypes[r.type] || 0) + 1; continue; }
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(r.contractAddress))) continue;
        byFamily[family].push({
          address: r.contractAddress.toLowerCase(),
          symbol: r.symbol == null ? null : String(r.symbol),
          underlyingTicker: r.ticker == null ? null : String(r.ticker),
          multiplier: r.multiplier == null ? null : String(r.multiplier),
          decimals: r.d == null ? null : Number(r.d),
          assetType: r.assetType ?? null,
        });
      }
      return { totalRows: data.length, chainRows: rows.length, byFamily, otherTypes };
    },

    /** Market-wide session state for the RWA stock market (`offhours` kept when present). */
    async marketStatus() {
      const d = await get('marketStatus');
      if (!d || typeof d !== 'object' || typeof d.openState !== 'boolean') throw new PublicApiError('binance-public:market-status: no openState in the answer', { source: PUBLIC_ENDPOINTS.marketStatus.source });
      return d;
    },

    /** One search on chain 56: up to one page of rows as Binance returns them. */
    async tokenSearch(keyword) {
      const data = await get('tokenSearch', { keyword, chainIds: String(CHAIN_ID) });
      if (!Array.isArray(data)) throw new PublicApiError('binance-public:token-search: data is not a list', { source: PUBLIC_ENDPOINTS.tokenSearch.source });
      return data.filter((r) => String(r?.chainId) === String(CHAIN_ID) && /^0x[0-9a-fA-F]{40}$/.test(String(r?.contractAddress))).map((r) => {
        const platform = r?.tagsInfo?.['Launch Platform']?.[0]?.tagName ?? r?.tagsInfo?.['Tokenized Stocks Launch Platform']?.[0]?.tagName ?? null;
        return {
          address: r.contractAddress.toLowerCase(),
          symbol: r.symbol == null ? null : String(r.symbol),
          name: r.name == null ? null : String(r.name),
          liquidityUsd: r.liquidity == null ? null : String(r.liquidity),
          holders: r.holders == null ? null : String(r.holders),
          launchPlatform: platform == null ? null : String(platform),
        };
      });
    },
  };
}
