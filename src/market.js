// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Market reality for a SAMPLE of genuine tokens, through the keyed Binance Web3 API:
// the deepest pools (token/top-liquidity) and aggregator quotes USDT → token at fixed USD sizes.
//
// Reading the answers:
//   • an empty pool list does not mean untradable: equity routes are quoted by RFQ market makers,
//     not by on-chain pools;
//   • an RFQ refusal (40367 market state, 40369 outside trading time, 40374 liquidity, 40375
//     minimum order, 40368 pairing) is recorded as data about the market at that moment, with its
//     code and message: it is not a failure of the run;
//   • an auth, signature or permission error stops the sampler at once (every further request
//     would fail the same way).
// The `userWalletAddress` the API requires for RFQ routes is a neutral placeholder that nobody
// owns (the conventional burn address), recorded in the snapshot. No real wallet is ever used.
import { USDT } from './chain.js';
import { RFQ_CODES, W3_ENDPOINTS, readQuote, readTopLiquidity } from './binance-web3.js';

export const SIZES_USD = Object.freeze([20, 100, 1000]);
export const WALLET_PLACEHOLDER = '0x000000000000000000000000000000000000dead';

// The same underlying in each family, so that the three can be read side by side. A ticker a family
// does not list on chain 56 is simply absent for that family.
export const SAMPLE_TICKERS = Object.freeze(['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'COIN']);

const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Tokens per USD spent → USD per token, from raw amounts. null when anything is missing. */
export function effectivePriceUsd(sizeUsd, toTokenAmountRaw, decimals) {
  if (toTokenAmountRaw == null || decimals == null || !/^\d+$/.test(String(toTokenAmountRaw))) return null;
  const tokens = Number(BigInt(toTokenAmountRaw)) / 10 ** decimals;
  return tokens > 0 ? sizeUsd / tokens : null;
}

/**
 * Pick the sample: per family, the genuine contracts whose underlying ticker is in SAMPLE_TICKERS.
 * For xStocks both roles are sampled (token and v2 wrapper): pools hold the wrapper.
 */
export function pickSample(tokens, tickers = SAMPLE_TICKERS) {
  const wanted = new Set(tickers);
  return tokens
    .filter((t) => t.verdict === 'genuine' && wanted.has(t.underlyingTicker))
    .sort((a, b) => tickers.indexOf(a.underlyingTicker) - tickers.indexOf(b.underlyingTicker) || a.family.localeCompare(b.family) || a.role.localeCompare(b.role));
}

/**
 * @param {object} options
 * @param {object} options.w3        client from createBinanceWeb3()
 * @param {object[]} options.targets { address, family, role, symbol, underlyingTicker, decimals, status }
 */
export async function sampleMarket({ w3, targets, sizesUsd = SIZES_USD, wallet = WALLET_PLACEHOLDER, quoteToken = USDT, onProgress = () => {} }) {
  const items = [];
  const errors = [];
  let fatal = null;
  for (const [n, t] of targets.entries()) {
    onProgress(n + 1, targets.length, t);
    const item = { address: t.address, family: t.family, role: t.role, symbol: t.symbol, underlyingTicker: t.underlyingTicker, status: t.status ?? null, pools: null, quotes: [] };
    try {
      const data = await w3.request('topLiquidity', { query: { binanceChainId: '56', tokenContractAddress: t.address } });
      const pools = readTopLiquidity(data);
      const total = pools.reduce((sum, p) => sum + (toNum(p.liquidityUsd) ?? 0), 0);
      item.pools = { source: W3_ENDPOINTS.topLiquidity.source, fetchedAt: new Date().toISOString(), status: 'ok', count: pools.length, liquidityUsdTotal: total, top: pools.slice(0, 5) };
    } catch (error) {
      if (error.fatal) { fatal = error; break; }
      item.pools = { source: W3_ENDPOINTS.topLiquidity.source, fetchedAt: new Date().toISOString(), status: 'failed', error: String(error.message).slice(0, 200), count: null, liquidityUsdTotal: null, top: [] };
      errors.push(`top-liquidity ${t.symbol}: ${String(error.message).slice(0, 120)}`);
    }
    for (const sizeUsd of sizesUsd) {
      const amountInRaw = (BigInt(sizeUsd) * 10n ** BigInt(quoteToken.decimals)).toString();
      const base = { sizeUsd, direction: `${quoteToken.symbol}->token`, amountInRaw };
      try {
        const data = await w3.request('quote', {
          query: { binanceChainId: '56', amount: amountInRaw, fromTokenAddress: quoteToken.address, toTokenAddress: t.address, userWalletAddress: wallet },
        });
        const q = readQuote(data);
        const decimals = q.toTokenDecimals ?? t.decimals ?? null;
        item.quotes.push({
          ...base, fetchedAt: new Date().toISOString(), status: 'ok', code: null, message: null,
          vendorName: q.vendorName, executionMode: q.executionMode, tradeFee: q.tradeFee,
          toTokenAmount: q.toTokenAmount, priceImpactPercent: q.priceImpactPercent, dexes: q.dexes,
          isHoneyPot: q.isHoneyPot, taxRate: q.taxRate, effectivePriceUsd: effectivePriceUsd(sizeUsd, q.toTokenAmount, decimals),
        });
      } catch (error) {
        if (error.fatal) { fatal = error; break; }
        item.quotes.push({
          ...base, fetchedAt: new Date().toISOString(), status: 'error', code: error.code ?? null,
          message: RFQ_CODES[error.code] ? `${RFQ_CODES[error.code]}: ${String(error.message).slice(0, 160)}` : String(error.message).slice(0, 200),
          toTokenAmount: null, priceImpactPercent: null, dexes: [], isHoneyPot: null, taxRate: null, effectivePriceUsd: null,
        });
        if (!RFQ_CODES[error.code]) errors.push(`quote ${t.symbol} $${sizeUsd}: ${String(error.message).slice(0, 120)}`);
      }
    }
    if (fatal) break;
    items.push(item);
  }
  return { items, errors, fatal };
}
