// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// On-chain facts for many addresses on BNB Smart Chain, read in paced JSON-RPC batches:
//   phase 1 — eth_getCode for every address (keccak256 and size of the runtime code);
//   phase 2 — only where there is code: the three EIP-1967 slots (implementation, admin, beacon)
//             and name(), symbol(), decimals().
// Results can be kept in an append-only cache file (JSON lines), so a pass interrupted by a power
// cut resumes where it stopped instead of starting over. Calls are made at the latest block; the
// block number at the start of the pass is recorded with every fact.
import fs from 'node:fs';
import path from 'node:path';
import { EIP1967, slotToAddress } from './chain.js';
import { hexToBytes, keccak256Hex, selector } from './keccak.js';
import { assertChainId, hexToNumber } from './rpc.js';

export const SEL = Object.freeze({
  name: selector('name()'),         // 0x06fdde03
  symbol: selector('symbol()'),     // 0x95d89b41
  decimals: selector('decimals()'), // 0x313ce567
});

export const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

/** Whole bytes of 0x-hex: an odd digit count is malformed, not something to hash or decode. */
export const isHexBytes = (value) => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);

/**
 * ABI-decode a `string` return value (or a legacy bytes32 one). Anything malformed → null.
 * Up to 256 bytes are kept: a family marker sits at the END of some names.
 */
export function decodeAbiString(hex) {
  if (!isHexBytes(hex) || hex.length < 66) return null;
  const bytes = hexToBytes(hex);
  const text = (slice) => new TextDecoder().decode(slice).replace(/\0+$/, '') || null;
  if (bytes.length === 32) return text(bytes);
  const offset = Number(BigInt(`0x${hex.slice(2, 66)}`));
  if (!Number.isSafeInteger(offset) || offset + 32 > bytes.length) return null;
  const length = Number(BigInt(`0x${hex.slice(2 + offset * 2, 2 + offset * 2 + 64)}`));
  const start = offset + 32;
  if (!Number.isSafeInteger(length) || length > 256 || start + length > bytes.length) return null;
  return text(bytes.subarray(start, start + length));
}

const decodeUint8 = (hex) => { const n = hexToNumber(hex); return n !== null && n <= 255 && isHexBytes(hex) && hex.length === 66 ? n : null; };

/** The calls of phase 2 for one address, in a fixed order (see factsFromAnswers). */
export const detailCalls = (address) => [
  { method: 'eth_getStorageAt', params: [address, EIP1967.implementation, 'latest'] },
  { method: 'eth_getStorageAt', params: [address, EIP1967.admin, 'latest'] },
  { method: 'eth_getStorageAt', params: [address, EIP1967.beacon, 'latest'] },
  { method: 'eth_call', params: [{ to: address, data: SEL.name }, 'latest'] },
  { method: 'eth_call', params: [{ to: address, data: SEL.symbol }, 'latest'] },
  { method: 'eth_call', params: [{ to: address, data: SEL.decimals }, 'latest'] },
];

/** Phase 2 answers → slot values and the contract's own name, symbol, decimals. */
export function detailsFromAnswers([impl, admin, beacon, name, symbol, decimals]) {
  return {
    implementation: slotToAddress(impl?.result),
    admin: slotToAddress(admin?.result),
    beacon: slotToAddress(beacon?.result),
    name: decodeAbiString(name?.result),
    symbol: decodeAbiString(symbol?.result),
    decimals: decodeUint8(decimals?.result),
  };
}

/** Code answer → { codeSize, codeHash } or null when unread. */
export function codeFacts(answer) {
  const code = answer?.result;
  if (!isHexBytes(code)) return null;
  return { codeSize: (code.length - 2) / 2, codeHash: keccak256Hex(code) };
}

/** Append-only JSONL cache: last line per address wins; lines older than maxAgeMs are ignored. */
export function openCache(file, { maxAgeMs = 12 * 3600_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  if (file && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (isAddress(e?.address) && now() - Date.parse(e.readAt) < maxAgeMs) entries.set(e.address, e);
      } catch { /* a torn last line after a power cut: skip it */ }
    }
  }
  return {
    get: (address) => entries.get(address) || null,
    put(fact) {
      entries.set(fact.address, fact);
      if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${JSON.stringify(fact)}\n`); }
    },
    get size() { return entries.size; },
  };
}

/**
 * Facts for every address: { address, readAt, block, codeSize, codeHash, implementation, admin,
 * beacon, name, symbol, decimals, unread }. `unread: true` means the RPC gave no usable answer.
 * @returns {Promise<{ facts: Map, block: number, fromCache: number, read: number }>}
 */
export async function readOnchain(addresses, { rpc, cache = openCache(null), onProgress = () => {} } = {}) {
  const head = await rpc.batch([{ method: 'eth_chainId' }, { method: 'eth_blockNumber' }]);
  assertChainId(head[0]);
  const block = hexToNumber(head[1]?.result);
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const facts = new Map();
  const todo = [];
  for (const a of unique) { const hit = cache.get(a); if (hit && !hit.unread) facts.set(a, hit); else todo.push(a); }
  const fromCache = facts.size;

  // Phase 1: code. Saved per batch, so an interruption loses at most one batch.
  const codes = new Map();
  for (let i = 0; i < todo.length; i += rpc.batchMax) {
    const chunk = todo.slice(i, i + rpc.batchMax);
    if (i > 0) await new Promise((r) => { setTimeout(r, 150); });
    let answers;
    try { answers = await rpc.batch(chunk.map((a) => ({ method: 'eth_getCode', params: [a, 'latest'] }))); } catch { answers = chunk.map(() => null); }
    chunk.forEach((a, k) => codes.set(a, codeFacts(answers[k])));
    onProgress('code', Math.min(i + rpc.batchMax, todo.length), todo.length);
  }

  // Phase 2: details where there is code; a contract-less address is done after phase 1.
  const withCode = todo.filter((a) => codes.get(a)?.codeSize > 0);
  const readAt = new Date().toISOString();
  for (const a of todo) {
    const c = codes.get(a);
    if (c === null) { const f = { address: a, readAt, block, unread: true, codeSize: null, codeHash: null, implementation: null, admin: null, beacon: null, name: null, symbol: null, decimals: null }; facts.set(a, f); continue; }
    if (c.codeSize === 0) { const f = { address: a, readAt, block, unread: false, ...c, implementation: null, admin: null, beacon: null, name: null, symbol: null, decimals: null }; facts.set(a, f); cache.put(f); }
  }
  const per = 6;
  const step = Math.max(1, Math.floor(rpc.batchMax / per));
  for (let i = 0; i < withCode.length; i += step) {
    const chunk = withCode.slice(i, i + step);
    if (i > 0) await new Promise((r) => { setTimeout(r, 150); });
    let answers;
    try { answers = await rpc.batch(chunk.flatMap(detailCalls)); } catch { answers = null; }
    chunk.forEach((a, k) => {
      const at = new Date().toISOString();
      if (!answers) { facts.set(a, { address: a, readAt: at, block, unread: true, ...codes.get(a), implementation: null, admin: null, beacon: null, name: null, symbol: null, decimals: null }); return; }
      const f = { address: a, readAt: at, block, unread: false, ...codes.get(a), ...detailsFromAnswers(answers.slice(k * per, k * per + per)) };
      facts.set(a, f);
      cache.put(f);
    });
    onProgress('details', Math.min(i + step, withCode.length), withCode.length);
  }
  return { facts, block, fromCache, read: todo.length };
}
