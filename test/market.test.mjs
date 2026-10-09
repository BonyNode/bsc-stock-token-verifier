// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { BinanceApiError } from '../src/binance-web3.js';
import { effectivePriceUsd, pickSample, sampleMarket, WALLET_PLACEHOLDER } from '../src/market.js';

const target = { address: `0x${'ab'.repeat(20)}`, family: 'bstocks', role: 'token', symbol: 'NVDAB', underlyingTicker: 'NVDA', decimals: 18 };

/** A stand-in for the keyed client: answers per endpoint from a script. */
const fakeW3 = (script) => {
  const seen = [];
  return { seen, request: async (name, opts) => { seen.push({ name, ...opts }); return script(name, opts); } };
};

test('a quote is USDT -> token per size, with the placeholder wallet; the effective price is size / tokens', async () => {
  const w3 = fakeW3((name) => (name === 'topLiquidity'
    ? [{ protocolName: 'PancakeSwap V3', poolAddress: `0x${'cd'.repeat(20)}`, liquidityUsd: '6100745.97' }, { protocolName: 'Bebop', liquidityUsd: null }]
    : [{ vendorName: 'LiquidMesh', executionMode: 'SWAP', toTokenAmount: '86948320096335237', priceImpactPercent: '0.0000000000', toToken: { decimal: '18', isHoneyPot: false, taxRate: '0' }, dexRouterList: [{ dexProtocol: { dexName: 'Kipseli' } }] }]));
  const r = await sampleMarket({ w3, targets: [target], sizesUsd: [20] });
  assert.equal(r.fatal, null);
  const [item] = r.items;
  assert.equal(item.pools.count, 2);
  assert.equal(item.pools.liquidityUsdTotal, 6100745.97);
  const [q] = item.quotes;
  assert.equal(q.status, 'ok');
  assert.ok(Math.abs(q.effectivePriceUsd - 230.022) < 0.01, `${q.effectivePriceUsd}`);
  const quoteCall = w3.seen.find((c) => c.name === 'quote');
  assert.equal(quoteCall.query.amount, '20000000000000000000', 'USDT has 18 decimals on chain 56');
  assert.equal(quoteCall.query.userWalletAddress, WALLET_PLACEHOLDER);
});

test('RFQ refusals and "no quote from any vendor" are data; a network failure is a failure; a key error stops everything', async () => {
  const codes = { 20: 40374, 100: 40441 };
  const w3 = fakeW3((name, opts) => {
    if (name === 'topLiquidity') return [];
    const size = Number(BigInt(opts.query.amount) / 10n ** 18n);
    if (codes[size]) throw new BinanceApiError(`HTTP 200, code ${codes[size]}: refused`, { kind: codes[size] === 40374 ? 'rfq' : 'api', http: 200, code: codes[size] });
    throw new BinanceApiError('network error: socket hang up', { kind: 'network' });
  });
  const r = await sampleMarket({ w3, targets: [target], sizesUsd: [20, 100, 1000] });
  assert.deepEqual(r.items[0].quotes.map((q) => [q.status, q.code]), [['error', 40374], ['error', 40441], ['error', null]]);
  assert.match(r.items[0].quotes[0].message, /RWA_INSUFFICIENT_LIQUIDITY/);
  assert.equal(r.errors.length, 1, 'only the network failure counts against the run');
  const stop = await sampleMarket({ w3: fakeW3(() => { throw new BinanceApiError('bad sig', { kind: 'signature', code: 40102 }); }), targets: [target, { ...target, symbol: 'X' }] });
  assert.equal(stop.fatal.code, 40102);
  assert.equal(stop.items.length, 0);
});

test('the sample takes the same tickers in every family, both xStocks roles, genuine contracts only', () => {
  const t = (family, role, ticker, verdict = 'genuine') => ({ family, role, underlyingTicker: ticker, verdict, address: `0x${'1'.repeat(40)}` });
  const picked = pickSample([t('xstocks', 'wrapper', 'NVDA'), t('ondo', 'token', 'AAPL'), t('bstocks', 'token', 'NVDA'), t('xstocks', 'token', 'NVDA'), t('ondo', 'token', 'NVDA', 'unknown'), t('ondo', 'token', 'ZZZZ')], ['NVDA', 'AAPL']);
  assert.deepEqual(picked.map((p) => `${p.underlyingTicker}:${p.family}:${p.role}`), ['NVDA:bstocks:token', 'NVDA:xstocks:token', 'NVDA:xstocks:wrapper', 'AAPL:ondo:token']);
  assert.equal(effectivePriceUsd(100, null, 18), null);
});

test('the quote cost is measured against the token price of the same run, not taken from priceImpactPercent', async () => {
  const { addQuoteCosts } = await import('../src/scan.js');
  const addr = `0x${'ab'.repeat(20)}`;
  const snap = {
    prices: { items: [{ address: addr, source: 'binance-w3:rwa-price', tokenPrice: '535.0' }] },
    market: { items: [{ address: addr, quotes: [
      { status: 'ok', sizeUsd: 20, effectivePriceUsd: 1582985117.18, priceImpactPercent: '0.9996010001' },
      { status: 'ok', sizeUsd: 100, effectivePriceUsd: 540.35, priceImpactPercent: '0.0100' },
      { status: 'error', sizeUsd: 1000, code: 40374, effectivePriceUsd: null },
    ] }, { address: `0x${'cd'.repeat(20)}`, quotes: [{ status: 'ok', sizeUsd: 20, effectivePriceUsd: 230 }] }] },
  };
  addQuoteCosts(snap);
  const [a, b, c] = snap.market.items[0].quotes.map((q) => q.vsTokenPricePct);
  assert.ok(a > 1e8, 'a 99.96 % impact is a cost of millions of percent, not 0.9996 %');
  assert.ok(Math.abs(b - 1) < 1e-9);
  assert.equal(c, null);
  assert.equal(snap.market.items[1].quotes[0].vsTokenPricePct, null, 'no token price, no figure');
});
