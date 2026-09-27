// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The authenticity verdict for one contract. PURE: the inputs are facts already read from the chain
// (see src/verify.js), the output is the verdict plus exactly the facts it was derived from.
//
// Verdicts, decided in this order:
//   unreadable  — the bytecode could not be read, so nothing was checked; also a registry address
//                 that answers no bytecode at all (a node behind the deployment block, or pruned);
//   authentic   — the address is in the registry and its live bytecode matches the reference hash;
//   counterfeit — (a) a registry address whose live bytecode differs from the reference: the genuine
//                 token does not live there; or (b) the contract calls ITSELF a Stock Token — its own
//                 name() ends in "Robinhood Token" — but it has neither the reference bytecode nor a
//                 place in the registry;
//   unlisted    — reference bytecode, but the address is not in the snapshot. Identical runtime bytes
//                 can be deployed by anyone, so this is not "authentic"; the issuer also adds Stock
//                 Tokens over time, so it is not "counterfeit" either;
//   none        — everything else: the contract does not call itself a Stock Token.
//
// What is NOT a claim: a ticker and a working uiMultiplier(). Tickers are not unique across chains
// and projects, and ERC-8056 is a public draft ERC anyone may implement, so a token "Frog" with the
// symbol F is not a counterfeit Ford. A ticker shared with a listed Stock Token is reported as the
// fact sharesTickerWith, and a working multiplier as multiplierAnswered; neither changes the verdict.
//
// Why a working multiplier does not prove authenticity either: a live counterfeit "LULU" answers
// uiMultiplier() with exactly 1e18 and has 18 decimals, so it passes every interface heuristic.
// Only its bytecode hash differs.
import { toBigInt, uiMultiplierToNumber } from './chain.js';
import { keccak256Hex } from './keccak.js';
import { CODE_HASH, DEPLOYER, stockTokenByAddress, stockTokenBySymbol } from './registry.js';

export const VERDICTS = Object.freeze(['authentic', 'counterfeit', 'unlisted', 'none', 'unreadable']);

/** keccak256 of no bytes: the hash of what eth_getCode answers for an address without code. */
export const EMPTY_CODE_HASH = keccak256Hex('0x');

/** The contract's own claim: its name() ends in "Robinhood Token", as every Stock Token's does. */
export const claimsStockTokenName = (name) => /\brobinhood\s+token\s*$/i.test(String(name || ''));

/**
 * @param {object} facts
 * @param {string} facts.address
 * @param {string|null} facts.codeHash      keccak256 of eth_getCode, or null when unread
 * @param {string|bigint|null} [facts.uiMultiplier]  raw answer of uiMultiplier(), null on revert
 * @param {string|null} [facts.symbol]      the contract's own symbol()
 * @param {string|null} [facts.name]        the contract's own name()
 * @param {string|null} [facts.deployer]    contract creator from the explorer; omit when not looked up
 */
export function stockTokenVerdict({ address, codeHash, uiMultiplier, symbol, name, deployer = null } = {}) {
  const listed = stockTokenByAddress(address);
  const codeMatch = codeHash == null ? null : String(codeHash).toLowerCase() === CODE_HASH;
  const mulRaw = toBigInt(uiMultiplier);
  const multiplierAnswered = mulRaw !== null && mulRaw > 0n;
  const claimsStockToken = claimsStockTokenName(name);
  // A listed Stock Token with the same ticker at another address: a fact, never a claim.
  const twin = listed ? null : stockTokenBySymbol(symbol);
  const sharesTickerWith = twin ? [{ symbol: twin.symbol, address: twin.address, underlying: twin.underlying }] : [];

  const facts = {
    address: String(address || '').toLowerCase(),
    codeHash: codeHash == null ? null : String(codeHash).toLowerCase(),
    expectedCodeHash: CODE_HASH,
    codeMatch,
    multiplierAnswered,
    multiplierRaw: mulRaw === null ? null : mulRaw.toString(),
    multiplier: uiMultiplierToNumber(mulRaw),
    listed: !!listed,
    // Registry values for a listed address; otherwise what the contract says about itself.
    symbol: listed ? listed.symbol : (symbol == null ? null : String(symbol)),
    name: name == null ? null : String(name),
    underlying: listed ? listed.underlying : null,
    claimsStockToken,
    sharesTickerWith,
    genuineAddress: null,
    // Reported next to the verdict, never folded into it: for a listed address the creator is
    // already part of the snapshot, and for an unlisted one it is the second test a registry
    // rebuild would apply (scripts/rebuild-registry.mjs).
    deployer: deployer ? String(deployer).toLowerCase() : null,
    expectedDeployer: DEPLOYER,
    deployerMatch: deployer ? String(deployer).toLowerCase() === DEPLOYER : null,
  };

  // "Unread" comes first: with no bytecode we have no name either, and the "no claim" branch would
  // otherwise hand any counterfeit a clean "none" exactly when the RPC is down.
  if (codeMatch === null) return { ...facts, verdict: 'unreadable' };
  // Runtime code does not vanish from an address, so NO bytecode at a registry address says more
  // about the node (behind the deployment block, or pruned) than about the token: nothing was
  // compared, and the genuine token must not be called a counterfeit.
  if (listed && facts.codeHash === EMPTY_CODE_HASH) return { ...facts, verdict: 'unreadable' };
  // Runtime code at an address is immutable, so a listed address with foreign bytecode means the
  // genuine token does not live there (or the snapshot is wrong) — an alarm, not a caveat.
  if (listed) return { ...facts, verdict: codeMatch ? 'authentic' : 'counterfeit' };
  if (codeMatch) return { ...facts, verdict: 'unlisted' };
  // The genuine holder of this ticker: the one address a person who was misled needs.
  if (claimsStockToken) return { ...facts, genuineAddress: twin ? twin.address : null, verdict: 'counterfeit' };
  return { ...facts, verdict: 'none' };
}
