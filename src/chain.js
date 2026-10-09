// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// BNB Smart Chain (chain id 56): network constants. Pure module: nothing here touches the network.

export const CHAIN_ID = 56;
export const CHAIN_ID_HEX = '0x38';
export const CHAIN_NAME = 'BNB Smart Chain';

// Public JSON-RPC endpoints that answered a batch of 24 eth_getCode calls on chain 0x38 when this
// list was written (2026-10-09). The first is the public endpoint published by BNB Chain. (A free
// drpc.org endpoint refuses batches of more than 3 calls, so it is not a default.) Operators add
// their own provider through STV_RPC_URLS.
export const DEFAULT_RPCS = Object.freeze([
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.binance.org',
]);

/** STV_RPC_URLS (comma-separated) first, the built-in public endpoints after it. */
export function rpcUrlsFromEnv(env = process.env) {
  const own = String(env.STV_RPC_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...own, ...DEFAULT_RPCS.filter((url) => !own.includes(url))];
}

/** Host name of an endpoint, never its path, query or credentials (a provider URL can carry a key). */
export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return 'invalid-url'; }
}

// EIP-1967 storage slots: keccak256('eip1967.proxy.<name>') - 1.
export const EIP1967 = Object.freeze({
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
});

// Binance-Peg BSC-USD (USDT) on chain 56. 18 decimals on this chain, unlike 6 on Ethereum.
export const USDT = Object.freeze({ symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 });

/** A storage word holding an address → the address, lowercase; an empty slot → null. */
export function slotToAddress(word) {
  if (typeof word !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(word)) return null;
  const hex = word.slice(2).padStart(64, '0').toLowerCase();
  if (/^0+$/.test(hex)) return null;
  if (!/^0{24}/.test(hex)) return null; // not an address-shaped word
  return `0x${hex.slice(24)}`;
}
