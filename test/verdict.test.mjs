// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Each claim below must turn red if its rule is removed:
//   1. the BYTECODE decides authenticity — not the ticker, not a working multiplier;
//   2. only the contract's own name makes it a counterfeit: a shared ticker or a working ERC-8056
//      multiplier alone is "none", with the shared ticker reported as a fact;
//   3. an unread bytecode is "unreadable", never a clean "none".
import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_CODE_HASH, stockTokenVerdict, VERDICTS } from '../src/verdict.js';
import { keccak256Hex } from '../src/keccak.js';
import { CODE_HASH, DEPLOYER, stockTokenBySymbol } from '../src/registry.js';
import { NVDA, FAKE_NVDA, FAKE_LULU, FAKE_FOMO, USDG } from './fixtures/chain.mjs';

const of = (snap, extra = {}) => stockTokenVerdict({
  address: snap.addr, codeHash: snap.code ? keccak256Hex(snap.code) : snap.codeHash,
  uiMultiplier: snap.mul, symbol: snap.symbol, name: snap.name, ...extra,
});

test('genuine NVDA: authentic, with its symbol, underlying and live multiplier', () => {
  const v = of(NVDA);
  assert.equal(v.verdict, 'authentic');
  assert.equal(v.codeMatch, true);
  assert.equal(v.listed, true);
  assert.equal(v.symbol, 'NVDA');
  assert.equal(v.underlying, 'NVIDIA');
  assert.equal(v.multiplierRaw, '1000775159164630595');
  assert.equal(v.genuineAddress, null);
});

test('counterfeit NVDA: counterfeit, both hashes stated, and the genuine address named', () => {
  const v = of(FAKE_NVDA);
  assert.equal(v.verdict, 'counterfeit');
  assert.equal(v.claimsStockToken, true, 'its own name ends in "Robinhood Token"');
  assert.equal(v.codeMatch, false);
  assert.equal(v.multiplierAnswered, false, 'this counterfeit has no ERC-8056 — the call reverts');
  assert.notEqual(v.codeHash, v.expectedCodeHash);
  assert.equal(v.genuineAddress, stockTokenBySymbol('NVDA').address);
  // What the contract says about itself, not what the registry says about the genuine token.
  assert.equal(v.symbol, 'NVDA');
  assert.equal(v.name, 'NVIDIA • Robinhood Token');
  assert.equal(v.underlying, null);
  assert.deepEqual(v.sharesTickerWith, [{ symbol: 'NVDA', address: NVDA.addr, underlying: 'NVIDIA' }]);
});

test('counterfeit LULU with a WORKING multiplier is still counterfeit: the bytecode decides', () => {
  const v = of(FAKE_LULU);
  assert.equal(v.multiplierAnswered, true, 'premise: the multiplier of this counterfeit answers 1e18');
  assert.equal(v.multiplier, 1);
  assert.equal(v.verdict, 'counterfeit');
});

test('counterfeit without a registry twin: counterfeit, and no genuine address is promised', () => {
  const v = of(FAKE_FOMO);
  assert.equal(v.verdict, 'counterfeit', 'the claim here is the name suffix alone');
  assert.equal(v.genuineAddress, null);
  assert.deepEqual(v.sharesTickerWith, []);
});

// Not chain data: made-up contracts that implement ERC-8056 or share a ticker without calling
// themselves a Stock Token.
const FOREIGN_HASH = `0x${'1'.repeat(64)}`;
const FORD = stockTokenBySymbol('F');

test('a shared ticker and a working multiplier are not a claim: "Frog" with the symbol F is not a counterfeit Ford', () => {
  const v = stockTokenVerdict({ address: `0x${'7'.repeat(40)}`, codeHash: FOREIGN_HASH, uiMultiplier: '0xde0b6b3a7640000', symbol: 'F', name: 'Frog' });
  assert.equal(v.verdict, 'none');
  assert.equal(v.multiplierAnswered, true, 'premise: ERC-8056 is a public draft ERC and this contract implements it');
  assert.equal(v.claimsStockToken, false);
  assert.deepEqual(v.sharesTickerWith, [{ symbol: 'F', address: FORD.address, underlying: 'Ford Motor' }], 'the shared ticker is reported as a fact');
  assert.equal(v.genuineAddress, null, 'no "the real F lives at …": this contract never claimed to be it');
  assert.equal(v.underlying, null, 'the registry\'s company name must not be pinned on a stranger');
  assert.equal(v.symbol, 'F');
  assert.equal(v.name, 'Frog');
});

test('ERC-8056 alone is not a claim, and neither is a listed ticker alone', () => {
  const erc8056 = stockTokenVerdict({ address: `0x${'8'.repeat(40)}`, codeHash: FOREIGN_HASH, uiMultiplier: '0xde0b6b3a7640000', symbol: 'YLD', name: 'Yield Vault Share' });
  assert.equal(erc8056.verdict, 'none');
  assert.deepEqual(erc8056.sharesTickerWith, []);
  const tickerOnly = stockTokenVerdict({ address: `0x${'9'.repeat(40)}`, codeHash: FOREIGN_HASH, symbol: 'nvda', name: null });
  assert.equal(tickerOnly.verdict, 'none');
  assert.deepEqual(tickerOnly.sharesTickerWith.map((x) => x.address), [NVDA.addr], 'tickers are compared without case');
  // The claim is the name SUFFIX, as in the registry selection: a name that merely mentions it is none.
  assert.equal(stockTokenVerdict({ address: `0x${'9'.repeat(40)}`, codeHash: FOREIGN_HASH, symbol: 'FAN', name: 'Robinhood Token Fan Club' }).verdict, 'none');
});

test('a contract that makes no claim is "none" — USDG of the same chain', () => {
  assert.equal(of(USDG).verdict, 'none');
});

test('no bytecode read → unreadable, even for a known counterfeit address', () => {
  const v = stockTokenVerdict({ address: FAKE_NVDA.addr, codeHash: null });
  assert.equal(v.verdict, 'unreadable');
});

test('NO bytecode at a registry address → unreadable, not counterfeit; at any other address it is still "none"', () => {
  assert.equal(EMPTY_CODE_HASH, '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'keccak256 of no bytes');
  const listed = stockTokenVerdict({ address: NVDA.addr, codeHash: keccak256Hex('0x') });
  assert.equal(listed.verdict, 'unreadable', 'a lagging or pruned node says nothing about the genuine NVDA');
  assert.equal(listed.listed, true);
  const stranger = stockTokenVerdict({ address: `0x${'1'.repeat(40)}`, codeHash: EMPTY_CODE_HASH });
  assert.equal(stranger.verdict, 'none', 'an account without code makes no claim');
});

test('the claim is read from the whole name: the genuine SPCX name is 75 characters long', () => {
  const SPCX_NAME = 'Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token';
  const v = stockTokenVerdict({ address: `0x${'5'.repeat(40)}`, codeHash: FOREIGN_HASH, symbol: 'SPCX', name: SPCX_NAME });
  assert.equal(v.claimsStockToken, true);
  assert.equal(v.verdict, 'counterfeit');
  assert.equal(v.name, SPCX_NAME, 'reported whole');
  assert.equal(v.genuineAddress, stockTokenBySymbol('SPCX').address);
});

test('reference bytecode at an unlisted address is "unlisted": identical bytes can be deployed by anyone', () => {
  const v = stockTokenVerdict({ address: `0x${'a'.repeat(40)}`, codeHash: CODE_HASH, uiMultiplier: NVDA.mul, symbol: 'ZZZZ', name: 'Zzz • Robinhood Token' });
  assert.equal(v.verdict, 'unlisted');
  // Even with unreadable symbol and name, the reference bytecode alone is a claim.
  assert.equal(stockTokenVerdict({ address: `0x${'b'.repeat(40)}`, codeHash: CODE_HASH }).verdict, 'unlisted');
});

test('a listed address whose live bytecode differs is an alarm, not a caveat', () => {
  const v = stockTokenVerdict({ address: NVDA.addr, codeHash: keccak256Hex(FAKE_NVDA.code), uiMultiplier: NVDA.mul, symbol: 'NVDA' });
  assert.equal(v.verdict, 'counterfeit');
});

test('the creator is reported next to the verdict and never changes it', () => {
  const genuine = of(NVDA, { deployer: DEPLOYER.toUpperCase().replace('0X', '0x') });
  assert.equal(genuine.deployerMatch, true);
  assert.equal(genuine.verdict, 'authentic');
  const foreign = of(NVDA, { deployer: `0x${'c'.repeat(40)}` });
  assert.equal(foreign.deployerMatch, false);
  assert.equal(foreign.verdict, 'authentic');
  assert.equal(of(NVDA).deployerMatch, null, 'not looked up → null, not false');
});

test('every verdict the function can return is declared', () => {
  const seen = new Set([of(NVDA), of(FAKE_NVDA), of(USDG), stockTokenVerdict({ address: NVDA.addr, codeHash: null }),
    stockTokenVerdict({ address: `0x${'a'.repeat(40)}`, codeHash: CODE_HASH })].map((v) => v.verdict));
  assert.deepEqual([...seen].sort(), [...VERDICTS].sort());
});
