// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The registry with every token's live corporate-action multiplier: 194 eth_calls, paced in
// batches of 8 (≈ 25 batches, ≈ 10 s on the public node). Callers are expected to cache the result.
import { CHAIN_ID, hasCorporateAction, uiMultiplierToNumber } from './chain.js';
import { assertChainId, hexToBigInt, hexToNumber } from './rpc.js';
import { AUTHENTICITY, STOCK_TOKENS } from './registry.js';
import { SEL } from './verify.js';

export const RIGHTS = 'Stock Token data here is chain state read over a third-party public RPC and served for '
  + 'verification and display only, not for resale (resaleOk: false on this answer). Read the terms of service of '
  + 'Robinhood Chain (https://docs.robinhood.com/chain/terms-of-service) before reusing this data';

export const TEXT = Object.freeze({
  multiplier: {
    what: 'the ERC-8056 corporate-action multiplier: Stock Tokens never rebase, so dividends and splits are expressed as this number instead. 1.0 means no corporate action has been applied yet',
    scale: '1e18 = 1.0, a constant of the specification — uiMultiplierDecimals() does not exist on chain (the call reverts on every token)',
    method: 'one eth_call to uiMultiplier() per token, batched 8 per request, read at the latest block',
    period: 'live value at the moment of the read; no history is collected, because a backward log scan would exceed what the public node allows',
    source: 'Robinhood Chain public RPC',
  },
  sharePrice: {
    what: 'the price of ONE underlying share, derived from the price of a whole Stock Token',
    method: 'share price = token price ÷ uiMultiplier. DIVISION, not multiplication: an oracle or a pool prices a WHOLE token and the multiplier is already inside that price, so applying it again would count the dividend twice',
    source: 'this package does not price tokens; bring a token price (for example a Chainlink feed on this chain) and divide it by the multiplier above',
  },
});

export async function loadStockTokens(rpc) {
  const head = await rpc.batch([{ method: 'eth_chainId' }, { method: 'eth_blockNumber' }]);
  assertChainId(head[0]);
  const answers = await rpc.paced(STOCK_TOKENS.map((t) => ({
    method: 'eth_call', params: [{ to: t.address, data: SEL.uiMultiplier }, 'latest'],
  })));
  let read = 0;
  const tokens = STOCK_TOKENS.map((t, i) => {
    const big = hexToBigInt(answers[i]?.result);
    const multiplier = big === null ? null : uiMultiplierToNumber(big);
    if (multiplier !== null) read += 1;
    return {
      symbol: t.symbol,
      address: t.address,
      underlying: t.underlying,
      decimals: t.decimals,
      uiMultiplier: multiplier,
      uiMultiplierRaw: big === null ? null : big.toString(),
      corporateActionApplied: big === null ? null : hasCorporateAction(big),
    };
  });
  return {
    data: {
      chainId: CHAIN_ID,
      block: hexToNumber(head[1]?.result),
      count: tokens.length,
      multipliersRead: read,
      tokens,
      authenticity: AUTHENTICITY,
      multiplier: TEXT.multiplier,
      sharePrice: TEXT.sharePrice,
      resaleOk: false,
      rights: RIGHTS,
    },
    partial: read < tokens.length,
    failed: read < tokens.length ? [`uiMultiplier unread for ${tokens.length - read} of ${tokens.length}`] : [],
  };
}
