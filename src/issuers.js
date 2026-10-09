// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The issuers' own lists.
//   • xStocks (Backed): the public API, every page; per asset the BinanceSmartChain deployment with
//     the token address and its ERC-4626 v2 wrapper (`wrapperAddressV2`). v1 wrappers are kept as a
//     fact but are not part of the family: the issuer says not to integrate them.
//   • Ondo: the token CSV linked from https://docs.ondo.finance/addresses (a Dropbox file).
// The same xStocks addresses are listed for every EVM network, so a listing proves nothing about
// chain 56 by itself: the on-chain pass decides whether a contract exists there.
import { USER_AGENT } from './binance-web3.js';

export const XSTOCKS_API = 'https://api.xstocks.fi/api/v2/public/assets';
export const XSTOCKS_PRICE = 'https://api.xstocks.fi/api/v2/public/assets/{symbol}/price-data';
export const XSTOCKS_NETWORK = 'BinanceSmartChain';
export const ONDO_DOCS = 'https://docs.ondo.finance/addresses';
// The link published on ONDO_DOCS on 2026-10-09; used only when the page cannot be read.
export const ONDO_CSV_FALLBACK = 'https://www.dropbox.com/scl/fi/qjfxyg748mx0dwi6up86d/EXTERNAL-Ondo-GM-Tokens-Ondo-GM-Tokens.csv?rlkey=n3no1w78wrah3umsl0nr9s77i&e=2&st=spdit2q1&dl=1';

const isAddr = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const headers = { accept: 'application/json', 'user-agent': USER_AGENT };

/** A URL as recorded in a snapshot: no query string (share keys and the like stay out). */
export const bareUrl = (url) => String(url).split(/[?#]/)[0];

/** Every xStocks asset with a BSC deployment. Throws when a page fails: a half list is not a list. */
export async function fetchXStocks({ fetchImpl = globalThis.fetch, gapMs = 400, maxPages = 60, pause = sleep } = {}) {
  const assets = [];
  let requests = 0;
  let page = 0;
  for (;;) {
    requests += 1;
    const response = await fetchImpl(`${XSTOCKS_API}?page=${page}&pageSize=100`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`xstocks-api: HTTP ${response.status} on page ${page}`);
    const json = await response.json();
    if (!Array.isArray(json?.nodes) || typeof json?.page?.hasNextPage !== 'boolean') throw new Error(`xstocks-api: page ${page} has no nodes/page fields`);
    for (const node of json.nodes) {
      const dep = (node.deployments || []).find((d) => d?.network === XSTOCKS_NETWORK);
      if (!dep || !isAddr(dep.address)) continue;
      assets.push({
        symbol: String(node.symbol),
        name: node.name == null ? null : String(node.name),
        underlyingTicker: node.underlyingSymbol == null ? null : String(node.underlyingSymbol),
        isin: node.isin ?? null,
        token: dep.address.toLowerCase(),
        wrapper: isAddr(dep.wrapperAddressV2) ? dep.wrapperAddressV2.toLowerCase() : null,
        wrapperV1: isAddr(dep.wrapperAddress) ? dep.wrapperAddress.toLowerCase() : null,
        tradingHoursMode: node?.trading?.tradingHoursMode ?? null,
        isTradingHalted: typeof node?.isTradingHalted === 'boolean' ? node.isTradingHalted : null,
      });
    }
    if (!json.page.hasNextPage) break;
    page += 1;
    if (page >= maxPages) throw new Error(`xstocks-api: more than ${maxPages} pages — refusing to report a cut list`);
    await pause(gapMs);
  }
  return { assets, requests, pages: page + 1, fetchedAt: new Date().toISOString() };
}

/** The issuer's token quote for one xStocks symbol: { quote } with no timestamp. */
export async function fetchXStocksQuote(symbol, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(XSTOCKS_PRICE.replace('{symbol}', encodeURIComponent(symbol)), { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`xstocks-price: HTTP ${response.status} for ${symbol}`);
  const json = await response.json();
  if (typeof json?.quote !== 'number') throw new Error(`xstocks-price: no numeric quote for ${symbol}`);
  return { quote: json.quote, fetchedAt: new Date().toISOString() };
}

/** RFC 4180 CSV → rows of strings (quoted fields may hold commas, quotes and newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const ONDO_CLASS = { stock: 'stock', etf: 'etf', portfolio: 'portfolio', currency: 'currency' };

/** Ondo CSV text → entries with a BSC address. Throws when the expected columns are missing. */
export function readOndoCsv(text) {
  const [head, ...body] = parseCsv(text);
  const col = (name) => head?.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase()) ?? -1;
  const idx = { name: col('Name'), symbol: col('Symbol'), bsc: col('BSC Deployed Address'), ticker: col('Stock Ticker'), type: col('Type') };
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) throw new Error(`ondo-csv: missing columns ${missing.join(', ')}`);
  return body.filter((r) => isAddr(r[idx.bsc])).map((r) => ({
    address: r[idx.bsc].trim().toLowerCase(),
    symbol: r[idx.symbol].trim() || null,
    name: r[idx.name].trim() || null,
    underlyingTicker: r[idx.ticker].trim() || null,
    assetClass: ONDO_CLASS[r[idx.type].trim().toLowerCase()] || 'other',
  }));
}

/** The CSV link published on the Ondo addresses page (dl=1 asks Dropbox for the file itself). */
export function findOndoCsvLink(html) {
  const m = String(html).match(/https:\/\/www\.dropbox\.com\/scl\/fi\/[^"'<>\s\\]+?\.csv\?[^"'<>\s\\]+/);
  if (!m) return null;
  const url = m[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
  return url.replace(/([?&])dl=0\b/, '$1dl=1') + (/[?&]dl=/.test(url) ? '' : '&dl=1');
}

export async function fetchOndo({ fetchImpl = globalThis.fetch } = {}) {
  let link = null;
  let requests = 0;
  let note = null;
  try {
    requests += 1;
    const page = await fetchImpl(ONDO_DOCS, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (page.ok) link = findOndoCsvLink(await page.text());
  } catch { /* fall back below */ }
  if (!link) { link = ONDO_CSV_FALLBACK; note = 'the addresses page did not yield a CSV link; used the link published there on 2026-10-09'; }
  requests += 1;
  const response = await fetchImpl(link, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`ondo-csv: HTTP ${response.status}`);
  const tokens = readOndoCsv(await response.text());
  if (!tokens.length) throw new Error('ondo-csv: no row with a BSC address — refusing an empty list');
  return { tokens, requests, url: bareUrl(link), fetchedAt: new Date().toISOString(), note };
}
