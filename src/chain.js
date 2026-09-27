// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Robinhood Chain (chain id 4663): network constants and the ERC-8056 corporate-action multiplier.
// Pure module: nothing here touches the network.

export const CHAIN_ID = 4663;
export const CHAIN_ID_HEX = '0x1237';

// Third-party public JSON-RPC endpoints that answered eth_chainId → 0x1237 when this list was
// written (2026-09-20). The official Robinhood Chain Public RPC is deliberately NOT a default: the
// Robinhood Chain Terms of Service (§2.4) limit its use to "lawful testing, experimentation,
// evaluation, and development purposes". Operators can still add it, or their own provider, via
// STV_RPC_URLS.
export const OFFICIAL_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const DEFAULT_RPCS = Object.freeze([
  'https://robinhood-rpc.publicnode.com',
  'https://robinhood.rpc.blxrbdn.com',
]);

/** STV_RPC_URLS (comma-separated) first, the built-in public endpoints after it. */
export function rpcUrlsFromEnv(env = process.env) {
  const own = String(env.STV_RPC_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...own, ...DEFAULT_RPCS.filter((url) => !own.includes(url))];
}

export const EXPLORER = 'https://robinhoodchain.blockscout.com';

// ── Corporate-action multiplier (ERC-8056) ────────────────────────────────────────────────────
// A Stock Token never rebases: raw balances and totalSupply never change. Dividends and splits are
// expressed by uiMultiplier(), a fixed-point number with 18 decimals (1e18 = 1.0). The scale is a
// constant of the specification: uiMultiplierDecimals() does not exist on chain (the call reverts
// on every token), so there is nothing to read it from.
//
// Two different prices must not be confused:
//   • token price — what the Chainlink feed and an on-chain swap report. The multiplier is already
//     inside it; applying it again would count the dividend twice.
//   • share price — what ONE underlying share costs. It is the token price DIVIDED by the multiplier.
// Multiplying instead of dividing, or not applying the multiplier at all, both produce plausible
// numbers at today's multipliers (1.0 to 1.0051), which is why the direction is pinned by tests.
export const UI_MULTIPLIER_SCALE = 10n ** 18n;

export function toBigInt(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : null;
  if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) return BigInt(v.trim());
  return null;
}

/** Multiplier as a number (1e18 → 1.0). Zero or unreadable → null, never 0. */
export function uiMultiplierToNumber(uiMultiplier) {
  const raw = toBigInt(uiMultiplier);
  if (raw === null || raw <= 0n) return null;
  return Number(raw) / Number(UI_MULTIPLIER_SCALE);
}

/** Underlying shares represented by a raw token amount: raw × uiMultiplier ÷ 1e18, in integers. */
export function underlyingShares(rawAmount, uiMultiplier) {
  const raw = toBigInt(rawAmount);
  const mul = toBigInt(uiMultiplier);
  if (raw === null || mul === null || mul <= 0n) return null;
  return (raw * mul) / UI_MULTIPLIER_SCALE;
}

/** Price of ONE underlying share from the price of a whole token: division, not multiplication. */
export function sharePriceFromTokenPrice(tokenPriceUsd, uiMultiplier) {
  const price = Number(tokenPriceUsd);
  const mul = uiMultiplierToNumber(uiMultiplier);
  if (!Number.isFinite(price) || mul === null) return null;
  return mul === 1 ? price : price / mul;
}

/** Inverse: price of a whole token from the price of one underlying share. */
export function tokenPriceFromSharePrice(sharePriceUsd, uiMultiplier) {
  const price = Number(sharePriceUsd);
  const mul = uiMultiplierToNumber(uiMultiplier);
  if (!Number.isFinite(price) || mul === null) return null;
  return mul === 1 ? price : price * mul;
}

/** Has any corporate action been applied yet? Exactly 1e18 means none. */
export function hasCorporateAction(uiMultiplier) {
  const raw = toBigInt(uiMultiplier);
  return raw !== null && raw !== UI_MULTIPLIER_SCALE;
}
