// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STOCK_TOKENS, CODE_HASH, DEPLOYER, AUTHENTICITY, SNAPSHOT_DATE,
  stockTokenByAddress, stockTokenBySymbol, isListedStockToken,
} from '../src/registry.js';
import { MULTIPLIERS } from './fixtures/chain.mjs';

test('the snapshot holds 194 genuine Stock Tokens with 194 distinct symbols and addresses', () => {
  assert.equal(STOCK_TOKENS.length, 194);
  assert.equal(new Set(STOCK_TOKENS.map((t) => t.symbol)).size, 194);
  assert.equal(new Set(STOCK_TOKENS.map((t) => t.address)).size, 194);
  assert.equal(AUTHENTICITY.candidates, 286);
  assert.equal(AUTHENTICITY.genuine + AUTHENTICITY.rejected, AUTHENTICITY.candidates);
  assert.equal(SNAPSHOT_DATE, '2026-09-20');
  for (const t of STOCK_TOKENS) {
    assert.match(t.address, /^0x[0-9a-f]{40}$/, `${t.symbol}: address not normalised`);
    assert.equal(t.decimals, 18);
    assert.ok(t.symbol && t.underlying, `${t.symbol}: empty field`);
  }
});

test('lookup is by address, case-insensitive; counterfeits and other contracts are not listed', () => {
  assert.equal(stockTokenBySymbol('NVDA').address, MULTIPLIERS.NVDA.addr);
  assert.equal(stockTokenByAddress(MULTIPLIERS.NVDA.addr).underlying, 'NVIDIA');
  assert.ok(isListedStockToken(MULTIPLIERS.NVDA.addr.toUpperCase().replace('0X', '0x')));
  assert.equal(stockTokenBySymbol('LULU').address, '0x4e62068525ab11fe768e29dfd00ef909b9803016');
  assert.equal(isListedStockToken('0x9b6cc37b76037d3bfb55aebd5f5d210a82e6a85a'), false, 'the LULU twin slipped in');
  assert.equal(isListedStockToken('0x1076f47f9632d726cf0ff93ad1616c45cbb8b94d'), false, 'the NVDA counterfeit slipped in');
  assert.equal(stockTokenByAddress('0x0bd7d308f8e1639fab988df18a8011f41eacad73'), null, 'WETH is not a Stock Token');
  assert.equal(stockTokenByAddress(''), null);
});

test('the rule is written down with the snapshot, and it states how each test can be repeated', () => {
  assert.match(CODE_HASH, /^0x[0-9a-f]{64}$/);
  assert.match(DEPLOYER, /^0x[0-9a-f]{40}$/);
  assert.match(AUTHENTICITY.reproducibility.bytecode, /over any RPC at the latest block, any time after the snapshot/);
  assert.match(AUTHENTICITY.reproducibility.creator, /explorer/);
  assert.doesNotMatch(JSON.stringify(AUTHENTICITY), /cannot be re-derived|explorer only/, 'the issuer derives its own list from an on-chain registry: no claim that chain state cannot give the set');
});
