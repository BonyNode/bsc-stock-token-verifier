// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The Stock Token registry: the authenticity rule (our own measurement) and the snapshot it produced.
//
// Why a registry keyed by ADDRESS. Anyone can deploy an ERC-20 called "NVIDIA • Robinhood Token"
// with the symbol NVDA. On the snapshot date the chain explorer listed 286 contracts whose name
// ends in "Robinhood Token"; 92 of them are not Stock Tokens, among them rival "NVDA" and "GME"
// contracts and a second "LULU". A symbol proves nothing; an address with the reference bytecode does.
//
// How the snapshot was selected (2026-09-20, every value read live, nothing from memory):
//   1. decimals() === 18 and uiMultiplier() answers (ERC-8056 interface). 202 of 286 passed; on
//      WETH and USDG of the same chain the multiplier call reverts, so the test does discriminate.
//   2. keccak256(eth_getCode) === CODE_HASH. 194 of the 202 passed. Stock Tokens are beacon proxies
//      whose runtime code embeds one beacon address, so the hash is the issuer's fingerprint.
//   3. Independent cross-check: the creator of each of the 202, looked up in the chain explorer.
//      All 194 share one creator (DEPLOYER); the 8 rejected have five other creators among them.
// Tests 2 and 3 split the 202 identically, with zero disagreement. The 194 carry 194 distinct symbols.
//
// What is reproducible, and how:
//   • the bytecode test — by anyone, over any RPC, at the latest block, any time after the snapshot
//     (scripts/rebuild-registry.mjs --recheck re-runs it for the whole snapshot);
//   • the creator test — this package reads contract creators from the chain explorer
//     (scripts/rebuild-registry.mjs --rebuild uses the explorer API).
// Robinhood publishes its own official list of contracts (https://docs.robinhood.com/chain/contracts),
// generated live from the on-chain asset registry. This registry is an independent re-check from
// chain state and is not derived from that list.
import fs from 'node:fs';

// CODE_HASH and DEPLOYER are data, not code: measured values of public chain state, published for
// verification and display under the terms in DATA.md. The Apache License of the code in this file
// does not extend to them.
export const CODE_HASH = '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630';
export const DEPLOYER = '0x4783c67b63de2b358ac5951a7d41f47a38f3c046';

const SNAPSHOT_URL = new URL('../data/stock-tokens.snapshot.json', import.meta.url);
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_URL, 'utf8'));

export const SNAPSHOT_DATE = snapshot.snapshotDate;

export const STOCK_TOKENS = Object.freeze(snapshot.tokens.map((t) => Object.freeze({
  symbol: t.symbol, address: t.address.toLowerCase(), underlying: t.underlying, decimals: 18,
})));

const BY_ADDRESS = new Map(STOCK_TOKENS.map((t) => [t.address, t]));
const BY_SYMBOL = new Map(STOCK_TOKENS.map((t) => [t.symbol, t]));

/** The only real key: counterfeits share symbols with genuine tokens, never addresses. */
export function stockTokenByAddress(address) {
  return BY_ADDRESS.get(String(address || '').toLowerCase()) || null;
}

/** Lookup by ticker — for search screens. For authenticity use the address. */
export function stockTokenBySymbol(symbol) {
  return BY_SYMBOL.get(String(symbol || '').toUpperCase()) || null;
}

export const isListedStockToken = (address) => stockTokenByAddress(address) !== null;

export const AUTHENTICITY = Object.freeze({
  candidates: snapshot.candidates,
  genuine: STOCK_TOKENS.length,
  rejected: snapshot.rejected,
  codeHash: CODE_HASH,
  deployer: DEPLOYER,
  method: 'every contract whose name ends in "Robinhood Token" in the chain explorer was tested on chain: '
    + '(1) decimals() is 18 and uiMultiplier() answers — 202 of 286 passed; '
    + '(2) keccak256(eth_getCode) equals one reference bytecode hash — 194 of the 202 passed; '
    + '(3) as an independent cross-check, the creator of each of the 202 was looked up in the explorer: '
    + 'all 194 share one creator address and the 8 rejected do not. Tests 2 and 3 agree on every contract. '
    + 'The 194 carry 194 distinct symbols',
  reproducibility: {
    bytecode: 'anyone can re-run it over any RPC at the latest block, any time after the snapshot: eth_getCode at the address, keccak256 of the answer, compare with codeHash',
    creator: 'taken from the contract-creator field of the chain explorer on the snapshot date; scripts/rebuild-registry.mjs --rebuild re-reads it from the explorer API',
  },
  period: `snapshot taken ${snapshot.snapshotDate}; the issuer adds Stock Tokens over time, so the list is a snapshot while the rule is not`,
  source: 'Robinhood Chain state via eth_getCode / eth_call, plus contract creators from the chain explorer',
  caution: 'a token with a matching symbol but a different contract address is not a Robinhood Stock Token — the registry is keyed by ADDRESS, never by symbol',
});
