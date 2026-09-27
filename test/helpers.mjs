// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Test helpers: an ABI string encoder and fetch stubs that play a Robinhood Chain JSON-RPC node.
// The chain data they serve lives in test/fixtures/chain.mjs.

export const abiString = (str) => {
  const bytes = Buffer.from(String(str), 'utf8');
  const pad = (x) => x.padStart(64, '0');
  const hex = bytes.toString('hex');
  return `0x${pad('20')}${pad(bytes.length.toString(16))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`;
};

const json = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

/**
 * A fetch stub that plays a Robinhood Chain JSON-RPC node for the given contracts.
 * @param {object[]} contracts  entries shaped like NVDA in test/fixtures/chain.mjs (addr, code, mul, symbol, name)
 * @param {object} [options]    chainId override, multiplier for any other address, call log
 */
export function stubRpc(contracts, { chainId = '0x1237', defaultMul = null, calls = [], block = '0x462bb56' } = {}) {
  const byAddr = new Map(contracts.map((c) => [c.addr.toLowerCase(), c]));
  return async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url, size: Array.isArray(body) ? body.length : 1 });
    const answer = (req) => {
      const reply = (result) => ({ jsonrpc: '2.0', id: req.id, result });
      const revert = () => ({ jsonrpc: '2.0', id: req.id, error: { code: 3, message: 'execution reverted' } });
      if (req.method === 'eth_chainId') return reply(chainId);
      if (req.method === 'eth_blockNumber') return reply(block);
      const target = String(req.method === 'eth_getCode' ? req.params[0] : req.params?.[0]?.to || '').toLowerCase();
      const c = byAddr.get(target);
      if (req.method === 'eth_getCode') return reply(c?.code ?? '0x');
      if (req.method === 'eth_call') {
        const data = req.params[0].data;
        if (data === '0xa60bf13d') { const mul = c ? c.mul : defaultMul; return mul ? reply(mul) : revert(); }
        if (data === '0x95d89b41') return c?.symbol ? reply(abiString(c.symbol)) : revert();
        if (data === '0x06fdde03') return c?.name ? reply(abiString(c.name)) : revert();
        if (data === '0x313ce567') return c ? reply(`0x${(c.decimals ?? 18).toString(16).padStart(64, '0')}`) : revert();
        return revert();
      }
      return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } };
    };
    // Answer in reverse order: the client must match answers by id, not by position.
    return json(Array.isArray(body) ? body.map(answer).reverse() : answer(body));
  };
}

export const downFetch = async () => { throw new Error('connect ECONNREFUSED'); };
