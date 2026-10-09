// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The three families of stock-linked contracts on BNB Smart Chain this package checks, in the
// issuers' own words, and what makes a contract CLAIM to belong to one of them.
//
// A claim is read from the contract itself — its symbol() and name() — never from a display name
// in a search result (Binance shows "NVIDIA (bStocks)" for a contract whose name() is "NVIDIA Corp").
//   • name: carries the family marker — "xStock" for xStocks, "(Ondo Tokenized)" for Ondo;
//   • symbol: EXACTLY the symbol of a genuine contract of the family, case included (bStocks NVDAB,
//     Ondo NVDAon, xStocks NVDAx and its wrapper wNVDAx), AND the name backs it: the name repeats the
//     symbol, or shares a distinctive word with the genuine contract's name (NVDAB "NVIDIA
//     Corporation" against the genuine "NVIDIA Corp"). bStocks names carry no family marker, so this
//     is the only claim a bStocks look-alike can make.
// Measured 2026-10-09: matching symbols while ignoring case, or without the name test, also counts
// unrelated projects — "AION" (Aion Finance) against Ondo "AIon", "FX" (FENGXIN) against xStocks
// "Fx", "BEB" (A Battered Pepe) against bStocks "BEB". A shared ticker alone ("NVDA") is not a claim.

import { CLAIMANT_KINDS } from './schema.js';

export const FAMILIES = Object.freeze({
  bstocks: Object.freeze({
    id: 'bstocks',
    label: 'bStocks',
    wording: 'bStocks are certificates (listed in Binance Wallet; launch platform tagged BStocks.finance)',
    nameMarker: null,
    claimMarkers: { symbolPattern: 'equals, ignoring case, the symbol of a genuine bStocks contract (ticker + "B", e.g. NVDAB)', nameMarker: null },
  }),
  ondo: Object.freeze({
    id: 'ondo',
    label: 'Ondo Stocks',
    wording: 'Ondo Stocks, issued by Ondo Global Markets',
    nameMarker: /\(\s*Ondo\s+Tokeni[sz]ed\s*\)/i,
    claimMarkers: { symbolPattern: 'equals, ignoring case, the symbol of a genuine Ondo contract (ticker + "on", e.g. NVDAon)', nameMarker: '"(Ondo Tokenized)" in name()' },
  }),
  xstocks: Object.freeze({
    id: 'xstocks',
    label: 'xStocks',
    wording: 'xStocks are tracker certificates issued by Backed',
    nameMarker: /\bxStock\b/i,
    claimMarkers: { symbolPattern: 'equals, ignoring case, the symbol of a genuine xStocks contract (ticker + "x", e.g. NVDAx; wrapper wNVDAx)', nameMarker: '"xStock" in name()' },
  }),
});

export const FAMILY_ORDER = Object.freeze(['bstocks', 'ondo', 'xstocks']);

// Names that claim a stock-linked issuer outside the three families: counted, not judged.
export const OTHER_ISSUER_MARKER = /tokeni[sz]ed\s+stock|robinhood\s+token|\(\s*coinbase\s*\)|\bdshares?\b/i;

/**
 * Index of genuine contracts for claim matching: lowercase symbol → entry, lowercase name → entry,
 * and the set of underlying tickers (for the shared-ticker fact).
 */
export function claimIndex(genuineTokens) {
  const bySymbol = new Map();
  const byName = new Map();
  const tickers = new Map();
  for (const t of genuineTokens) {
    if (t.symbol) { const k = t.symbol.trim(); if (!bySymbol.has(k)) bySymbol.set(k, t); }
    if (t.name) { const k = t.name.trim().toLowerCase(); if (!byName.has(k)) byName.set(k, t); }
    if (t.underlyingTicker) { const k = t.underlyingTicker.toUpperCase(); if (!tickers.has(k)) tickers.set(k, t); }
  }
  return { bySymbol, byName, tickers };
}

// Words that say nothing about which company a name refers to.
const STOP = new Set(['inc', 'corp', 'corporation', 'company', 'co', 'ltd', 'plc', 'group', 'holding', 'holdings', 'the', 'and',
  'class', 'token', 'tokens', 'tokenized', 'tokenised', 'stock', 'stocks', 'xstock', 'ondo', 'etf', 'trust', 'fund', 'shares',
  'share', 'wrapped', 'coin', 'finance', 'international', 'technologies', 'technology', 'systems', 'global', 'new', 'one', 'usd']);
const words = (text) => new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Does the name back a symbol claim: it repeats the symbol, or shares a distinctive word with the genuine name? */
export function nameBacksSymbol(name, genuine) {
  const n = String(name || '').trim();
  if (!n) return false;
  if (n.toLowerCase() === String(genuine.symbol || '').toLowerCase()) return true;
  const mine = words(n);
  for (const w of words(genuine.name)) if (mine.has(w)) return true;
  return false;
}

/**
 * What a contract claims, from its own symbol() and name().
 * @returns {{ family, by: string[], genuineSymbol, genuineAddress } | null}
 */
export function claimOf({ symbol, name }, index) {
  const sym = symbol ? String(symbol).trim() : null;
  const twinBySymbol = sym ? index.bySymbol.get(sym) || null : null;
  const bySymbol = twinBySymbol && nameBacksSymbol(name, twinBySymbol) ? twinBySymbol : null;
  const nameFamilies = FAMILY_ORDER.filter((id) => FAMILIES[id].nameMarker && FAMILIES[id].nameMarker.test(String(name || '')));
  if (!bySymbol && !nameFamilies.length) return null;
  const family = bySymbol ? bySymbol.family : nameFamilies[0];
  const by = [];
  if (bySymbol) by.push('symbol');
  if (nameFamilies.includes(family)) by.push('name');
  const twin = bySymbol || (twinBySymbol && twinBySymbol.family === family ? twinBySymbol : null) || index.byName.get(String(name || '').trim().toLowerCase()) || null;
  return { family, by, genuineSymbol: twin ? twin.symbol : null, genuineAddress: twin && twin.family === family ? twin.address : null };
}

// What can be said about who deployed an unlisted contract that uses a family's ticker or name —
// read only from what its own name() and symbol() say, never guessed:
//   bridged       — the name says it is a bridged copy (Wormhole, LayerZero, Axelar, …);
//   test          — the name starts with "Test"/"Testing", or the symbol with "t-" / "test";
//   other_issuer  — the name names another issuer of stock-linked tokens;
//   unidentified  — nothing in the contract says who it is.
export { CLAIMANT_KINDS };
export const CLAIMANT_LABELS = Object.freeze({ bridged: 'bridged copy', test: 'test contract', other_issuer: 'other issuer', unidentified: 'claimant not identified' });
const BRIDGED = /\b(?:wormhole|bridged?|portal|layer\s*zero|axelar|celer|multichain|anyswap|stargate|allbridge|wanchain)\b/i;
const OTHER_ISSUERS = /\b(?:coinbase|robinhood|kraken|dinari|securitize|swarm|dshares?|gtx)\b/i;

export function claimantKind({ symbol, name }) {
  const n = String(name || '');
  const s = String(symbol || '');
  if (BRIDGED.test(n)) return 'bridged';
  if (/^\s*test(?:ing)?\b/i.test(n) || /^t-|^test/i.test(s)) return 'test';
  if (OTHER_ISSUERS.test(n)) return 'other_issuer';
  return 'unidentified';
}

/** A ticker shared with a family token, which alone is not a claim (reported as a fact). */
export function sharedTicker({ symbol }, index) {
  const t = symbol ? index.tickers.get(String(symbol).trim().toUpperCase()) : null;
  return t ? { ticker: t.underlyingTicker, family: t.family, symbol: t.symbol, address: t.address } : null;
}
