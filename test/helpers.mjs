// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Test helpers: an ABI string encoder, a fetch stub that plays a BNB Smart Chain JSON-RPC node, and
// a fetch stub for the Binance Web3 API. The chain data they serve lives in test/fixtures/bsc.mjs.
import { EIP1967 } from '../src/chain.js';

export const abiString = (str) => {
  const bytes = Buffer.from(String(str), 'utf8');
  const pad = (x) => x.padStart(64, '0');
  const hex = bytes.toString('hex');
  return `0x${pad('20')}${pad(bytes.length.toString(16))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`;
};

const word = (addr) => (addr ? `0x${addr.slice(2).padStart(64, '0')}` : `0x${'0'.repeat(64)}`);
export const json = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => payload, text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
});

/**
 * A fetch stub that plays a BSC JSON-RPC node for the given contracts (fixtures shaped like NVDAB).
 * Answers in reverse order: the client must match answers by id, not by position.
 */
export function stubRpc(contracts, { chainId = '0x38', calls = [], block = '0x78cba4e' } = {}) {
  const byAddr = new Map(contracts.map((c) => [c.addr.toLowerCase(), c]));
  return async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url, size: Array.isArray(body) ? body.length : 1 });
    const answer = (req) => {
      const reply = (result) => ({ jsonrpc: '2.0', id: req.id, result });
      const revert = () => ({ jsonrpc: '2.0', id: req.id, error: { code: 3, message: 'execution reverted' } });
      if (req.method === 'eth_chainId') return reply(chainId);
      if (req.method === 'eth_blockNumber') return reply(block);
      const target = String(req.method === 'eth_call' ? req.params?.[0]?.to : req.params?.[0] || '').toLowerCase();
      const c = byAddr.get(target);
      if (req.method === 'eth_getCode') return reply(c?.code ?? '0x');
      if (req.method === 'eth_getStorageAt') {
        const slot = req.params[1];
        if (slot === EIP1967.implementation) return reply(word(c?.implementation));
        if (slot === EIP1967.admin) return reply(word(c?.admin));
        if (slot === EIP1967.beacon) return reply(word(c?.beacon));
        return reply(word(null));
      }
      if (req.method === 'eth_call') {
        const data = req.params[0].data;
        if (data === '0x95d89b41') return c?.symbol ? reply(abiString(c.symbol)) : revert();
        if (data === '0x06fdde03') return c?.name ? reply(abiString(c.name)) : revert();
        if (data === '0x313ce567') return c ? reply(`0x${(c.decimals ?? 18).toString(16).padStart(64, '0')}`) : revert();
        return revert();
      }
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } };
    };
    return json(Array.isArray(body) ? body.map(answer).reverse() : answer(body));
  };
}

export const downFetch = async () => { throw new Error('connect ECONNREFUSED'); };
