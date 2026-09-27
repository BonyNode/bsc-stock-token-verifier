// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
// The direction of the price conversion is the trap of this chain. At today's multipliers
// (1.0 to 1.0051) a wrong direction is off by tenths of a percent and passes for slippage; after a
// 1:4 split the multiplier becomes 4.0 and the same mistake is off by a factor of four.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UI_MULTIPLIER_SCALE, uiMultiplierToNumber, underlyingShares, sharePriceFromTokenPrice,
  tokenPriceFromSharePrice, hasCorporateAction,
} from '../src/chain.js';
import { MULTIPLIERS } from './fixtures/chain.mjs';

const { NVDA, SPY, SGOV, TSLA } = MULTIPLIERS;

test('the multiplier scale is 1e18 and a zero or missing multiplier is null, not 0', () => {
  assert.equal(UI_MULTIPLIER_SCALE, 10n ** 18n);
  assert.equal(uiMultiplierToNumber(TSLA.mul), 1);
  assert.ok(Math.abs(uiMultiplierToNumber(NVDA.mul) - 1.000775159164630595) < 1e-15);
  assert.equal(uiMultiplierToNumber('0'), null);
  assert.equal(uiMultiplierToNumber(null), null);
  assert.equal(uiMultiplierToNumber('0xde0b6b3a7640000'), 1, 'hex answers are read as well');
});

test('share price = token price DIVIDED by the multiplier', () => {
  const tokenPrice = 222.00220944760648; // one whole NVDA Stock Token, quoted on chain
  const share = sharePriceFromTokenPrice(tokenPrice, NVDA.mul);
  assert.ok(share < tokenPrice, 'one token represents more than one share, so a share costs less');
  assert.ok(Math.abs(share - 221.83025569191454) < 1e-9, `share price drifted: ${share}`);
  assert.notEqual(share, tokenPrice * uiMultiplierToNumber(NVDA.mul), 'multiplying is the silent mistake');
});

test('a multiplier of exactly 1.0 does not move a price, and conversion is reversible', () => {
  assert.equal(sharePriceFromTokenPrice(419.73, TSLA.mul), 419.73);
  assert.equal(tokenPriceFromSharePrice(419.73, TSLA.mul), 419.73);
  assert.equal(hasCorporateAction(TSLA.mul), false);
  assert.equal(hasCorporateAction(NVDA.mul), true);
  for (const { mul } of [NVDA, SPY, SGOV, TSLA]) {
    const back = sharePriceFromTokenPrice(tokenPriceFromSharePrice(100, mul), mul);
    assert.ok(Math.abs(back - 100) < 1e-9, `not reversible at ${mul}: ${back}`);
  }
});

test('share quantities are integers: no low digits lost on large balances', () => {
  assert.equal(underlyingShares(10n ** 18n, NVDA.mul), 1000775159164630595n);
  assert.equal(underlyingShares(10n ** 18n, TSLA.mul), 10n ** 18n);
  assert.equal(underlyingShares(10n ** 18n, SGOV.mul), 1005101770003214918n);
  assert.equal(underlyingShares('1000000000000000000', NVDA.mul), 1000775159164630595n);
  assert.equal(underlyingShares(10n ** 18n, '0'), null);
});
