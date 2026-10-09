// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRpc, assertChainId } from '../src/rpc.js';
import { decodeAbiString, openCache, readOnchain } from '../src/onchain.js';
import { slotToAddress } from '../src/chain.js';
import { AEHRX, FAKE_NVDAX, NVDAB } from './fixtures/bsc.mjs';
import { abiString, downFetch, stubRpc } from './helpers.mjs';

const EMPTY = `0x${'4'.repeat(40)}`;

test('facts: code hash and size, EIP-1967 slots, name/symbol/decimals; a contract-less address stops after phase 1', async () => {
  const calls = [];
  const rpc = createRpc({ urls: ['http://rpc.test'], fetchImpl: stubRpc([NVDAB, AEHRX, FAKE_NVDAX], { calls }), gapMs: 0 });
  const { facts, block } = await readOnchain([NVDAB.addr, AEHRX.addr, FAKE_NVDAX.addr, EMPTY], { rpc });
  assert.equal(block, 0x78cba4e);
  const b = facts.get(NVDAB.addr);
  assert.deepEqual([b.codeSize, b.codeHash, b.beacon, b.admin, b.implementation, b.symbol, b.name, b.decimals], [283, NVDAB.codeHash, NVDAB.beacon, null, null, 'NVDAB', 'NVIDIA Corp', 18]);
  const x = facts.get(AEHRX.addr);
  assert.deepEqual([x.admin, x.implementation, x.beacon], [AEHRX.admin, AEHRX.implementation, null]);
  const e = facts.get(EMPTY);
  assert.equal(e.codeSize, 0);
  assert.equal(e.symbol, null);
  // 1 head batch + 1 code batch + detail batches for the 3 contracts only (6 calls each).
  assert.equal(calls.reduce((n, c) => n + c.size, 0), 2 + 4 + 3 * 6);
});

test('the pass resumes from its cache: a second run reads nothing it already knows', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stv-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'onchain.jsonl');
  const first = [];
  await readOnchain([NVDAB.addr, AEHRX.addr], { rpc: createRpc({ urls: ['http://rpc.test'], fetchImpl: stubRpc([NVDAB, AEHRX], { calls: first }), gapMs: 0 }), cache: openCache(file) });
  fs.appendFileSync(file, '{"address":"0xtorn'); // a power cut in the middle of a line
  const second = [];
  const r = await readOnchain([NVDAB.addr, AEHRX.addr], { rpc: createRpc({ urls: ['http://rpc.test'], fetchImpl: stubRpc([NVDAB, AEHRX], { calls: second }), gapMs: 0 }), cache: openCache(file) });
  assert.equal(r.fromCache, 2);
  assert.equal(second.length, 1, 'only the chain-id check');
  assert.equal(r.facts.get(AEHRX.addr).admin, AEHRX.admin);
  const stale = openCache(file, { now: () => Date.now() + 13 * 3600_000 });
  assert.equal(stale.size, 0, 'entries older than 12 hours are not used');
});

test('an endpoint of another chain is refused, and a dead RPC never yields facts', async () => {
  const rpc = createRpc({ urls: ['http://rpc.test'], fetchImpl: stubRpc([NVDAB], { chainId: '0x1' }), gapMs: 0 });
  await assert.rejects(readOnchain([NVDAB.addr], { rpc }), /expected 0x38/);
  assert.throws(() => assertChainId({ result: '0x1237' }), /expected 0x38/);
  await assert.rejects(readOnchain([NVDAB.addr], { rpc: createRpc({ urls: ['http://a.test', 'http://b.test'], fetchImpl: downFetch, gapMs: 0 }) }), /all 2 BSC RPC endpoints failed/);
});

test('a batch refused in every slot (a plan limit) fails over to the next endpoint', async () => {
  const refuse = async (url, init) => ({ ok: false, status: 500, json: async () => JSON.parse(init.body).map((c) => ({ id: c.id, error: { message: 'Batch of more than 3 requests are not allowed on free plan' } })) });
  const good = stubRpc([NVDAB]);
  const rpc = createRpc({ urls: ['http://free.test', 'http://good.test'], fetchImpl: (url, init) => (url.includes('free') ? refuse(url, init) : good(url, init)), gapMs: 0 });
  const { facts } = await readOnchain([NVDAB.addr], { rpc });
  assert.equal(facts.get(NVDAB.addr).codeHash, NVDAB.codeHash);
  assert.equal(rpc.answeredHost, 'good.test');
});

test('ABI strings and storage words decode strictly', () => {
  assert.equal(decodeAbiString(abiString('Moderna (Ondo Tokenized)')), 'Moderna (Ondo Tokenized)');
  assert.equal(decodeAbiString('0xabc'), null);
  assert.equal(slotToAddress(`0x${'0'.repeat(24)}${NVDAB.beacon.slice(2)}`), NVDAB.beacon);
  assert.equal(slotToAddress(`0x${'0'.repeat(64)}`), null);
  assert.equal(slotToAddress(`0x${'f'.repeat(64)}`), null, 'a word that is not address-shaped');
});
