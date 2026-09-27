// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpc, BATCH_MAX, hideUrlSecrets } from '../src/rpc.js';
import { verifyAddress, decodeAbiString, lookupCreator } from '../src/verify.js';
import { DEPLOYER, stockTokenBySymbol } from '../src/registry.js';
import { NVDA, FAKE_NVDA } from './fixtures/chain.mjs';
import { stubRpc, downFetch, abiString } from './helpers.mjs';

const rpcOf = (contracts, options) => createRpc({ urls: ['https://rpc.test'], fetchImpl: stubRpc(contracts, options), gapMs: 0 });

test('rpc: answers are matched by id, batches are capped, endpoints fail over in order', async () => {
  const calls = [];
  const rpc = rpcOf([NVDA], { calls });
  const [chain, block] = await rpc.batch([{ method: 'eth_chainId' }, { method: 'eth_blockNumber' }]);
  assert.equal(chain.result, '0x1237', 'the stub answers in reverse order — position matching would swap these');
  assert.equal(block.result, '0x462bb56');
  await assert.rejects(rpc.batch(Array.from({ length: BATCH_MAX + 1 }, () => ({ method: 'eth_chainId' }))), /exceeds the 8 cap/);
  const out = await rpc.paced(Array.from({ length: 20 }, () => ({ method: 'eth_chainId' })));
  assert.equal(out.length, 20);
  assert.deepEqual(calls.slice(1).map((c) => c.size), [8, 8, 4], 'paced calls go out in batches of at most 8');

  const seen = [];
  const failover = createRpc({
    urls: ['https://first.test', 'https://second.test'],
    fetchImpl: async (url, init) => { seen.push(url); if (url.includes('first')) throw new Error('down'); return stubRpc([])(url, init); },
  });
  assert.equal((await failover.batch([{ method: 'eth_chainId' }]))[0].result, '0x1237');
  assert.deepEqual(seen, ['https://first.test', 'https://second.test']);
  assert.equal(failover.answeredBy, 'https://second.test');
});

test('verify: genuine NVDA is authentic, read in ONE batch of six calls', async () => {
  const calls = [];
  const r = await verifyAddress(NVDA.addr.toUpperCase().replace('0X', '0x'), { rpc: rpcOf([NVDA], { calls }) });
  assert.equal(r.verdict, 'authentic');
  assert.equal(r.address, NVDA.addr);
  assert.equal(r.symbol, 'NVDA');
  assert.equal(r.name, 'NVIDIA • Robinhood Token');
  assert.equal(r.block, 73579350);
  assert.equal(r.isContract, true);
  assert.equal(r.deployerChecked, false);
  assert.deepEqual(calls.map((c) => c.size), [6]);
});

test('verify: counterfeit NVDA is caught from chain data alone and points to the genuine token', async () => {
  const r = await verifyAddress(FAKE_NVDA.addr, { rpc: rpcOf([FAKE_NVDA]) });
  assert.equal(r.verdict, 'counterfeit');
  assert.equal(r.multiplierAnswered, false);
  assert.equal(r.genuineAddress, NVDA.addr);
});

test('verify: an account without code is "none"; a wrong chain or a dead RPC is "unreadable"', async () => {
  const empty = await verifyAddress(`0x${'1'.repeat(40)}`, { rpc: rpcOf([]) });
  assert.equal(empty.verdict, 'none');
  assert.equal(empty.isContract, false);

  const wrongChain = await verifyAddress(NVDA.addr, { rpc: rpcOf([NVDA], { chainId: '0x1' }) });
  assert.equal(wrongChain.verdict, 'unreadable');
  assert.match(wrongChain.error, /expected 0x1237/);

  const dead = await verifyAddress(FAKE_NVDA.addr, { rpc: createRpc({ urls: ['https://rpc.test'], fetchImpl: downFetch }) });
  assert.equal(dead.verdict, 'unreadable', 'a dead RPC must never hand a counterfeit a clean verdict');
  assert.equal(dead.reason, 'rpc_unavailable');

  await assert.rejects(verifyAddress('0x1234', { rpc: rpcOf([]) }), /not an EVM address/);
});

test('verify with the deployer option: the explorer creator is reported; an explorer failure is named, not hidden', async () => {
  const explorer = async (url) => {
    assert.match(url, /\/api\/v2\/addresses\/0x[0-9a-f]{40}$/);
    return { ok: true, status: 200, json: async () => ({ creator_address_hash: DEPLOYER.toUpperCase().replace('0X', '0x') }) };
  };
  const r = await verifyAddress(NVDA.addr, { rpc: rpcOf([NVDA]), withDeployer: true, fetchImpl: explorer });
  assert.equal(r.deployerChecked, true);
  assert.equal(r.deployer, DEPLOYER);
  assert.equal(r.deployerMatch, true);

  const challenged = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const c = await verifyAddress(NVDA.addr, { rpc: rpcOf([NVDA]), withDeployer: true, fetchImpl: challenged });
  assert.equal(c.verdict, 'authentic');
  assert.equal(c.deployerChecked, false);
  assert.match(c.deployerError, /HTTP 403/);

  // An explorer that answers but names no creator has not measured anything: no mismatch may be claimed.
  const silent = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const s = await verifyAddress(NVDA.addr, { rpc: rpcOf([NVDA]), withDeployer: true, fetchImpl: silent });
  assert.equal(s.deployerChecked, false);
  assert.equal(s.deployerMatch, null);
  assert.match(s.deployerError, /no creator/);

  const html = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(lookupCreator(NVDA.addr, { fetchImpl: html }), /browser challenge/);
});

test('ABI string decoding: dynamic strings, legacy bytes32, and garbage', () => {
  assert.equal(decodeAbiString(abiString('NVIDIA • Robinhood Token')), 'NVIDIA • Robinhood Token');
  assert.equal(decodeAbiString(`0x${Buffer.from('MKR').toString('hex').padEnd(64, '0')}`), 'MKR');
  assert.equal(decodeAbiString('0x'), null);
  assert.equal(decodeAbiString(null), null);
  assert.equal(decodeAbiString(`0x${'f'.repeat(128)}`), null, 'an absurd offset must not throw');
  assert.equal(decodeAbiString(`${abiString('NVIDIA • Robinhood Token')}a`), null, 'an odd digit count is malformed, not a crash');
});

// The longest name in the registry: 75 characters, 77 bytes.
const SPCX_NAME = 'Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token';

test('a long name is read whole: a counterfeit with the genuine SPCX name is counterfeit, not "none"', async () => {
  assert.ok(SPCX_NAME.length > 64, 'premise: longer than any cut the decoder used to make');
  assert.equal(decodeAbiString(abiString(SPCX_NAME)), SPCX_NAME);
  const fake = { addr: `0x${'5'.repeat(40)}`, code: FAKE_NVDA.code, mul: null, symbol: 'SPCX', name: SPCX_NAME };
  const r = await verifyAddress(fake.addr, { rpc: rpcOf([fake]) });
  assert.equal(r.name, SPCX_NAME);
  assert.equal(r.claimsStockToken, true);
  assert.equal(r.verdict, 'counterfeit');
  assert.equal(r.genuineAddress, stockTokenBySymbol('SPCX').address);
});

test('a registry address that answers NO bytecode is "unreadable" (code_empty), never "counterfeit"', async () => {
  const r = await verifyAddress(NVDA.addr, { rpc: rpcOf([{ ...NVDA, code: '0x' }]) });
  assert.equal(r.verdict, 'unreadable', 'a lagging or pruned node must not turn the genuine NVDA into a counterfeit');
  assert.equal(r.reason, 'code_empty');
  assert.equal(r.isContract, false);
  assert.equal(r.listed, true);
});

test('an odd number of hex digits in the bytecode is "unreadable" (code_unread), not a crash', async () => {
  const r = await verifyAddress(NVDA.addr, { rpc: rpcOf([{ ...NVDA, code: `${NVDA.code}a` }]) });
  assert.equal(r.verdict, 'unreadable');
  assert.equal(r.reason, 'code_unread');
  assert.equal(r.isContract, null);
});

test('a login and password in the RPC URL never reach the error, however long they are', async () => {
  const user = 'operator-login-0123456789';
  const password = `${'P'.repeat(180)}-tail`;
  const rpc = createRpc({
    urls: [`https://${user}:${password}@rpc.provider.test/v2/path`],
    fetchImpl: async (url) => { throw new Error(`request to ${url} failed, reason: connect ECONNREFUSED`); },
  });
  const r = await verifyAddress(NVDA.addr, { rpc });
  assert.equal(r.verdict, 'unreadable');
  assert.match(r.error, /https:\/\/rpc\.provider\.test\b/, 'the host may be named');
  assert.doesNotMatch(r.error, /operator-login|P{8}|-tail|\/v2\/path/, 'the user part, the password and the path may not');
  assert.equal(hideUrlSecrets(`at https://${user}:${password}@rpc.provider.test/v2?key=1 now`), 'at https://rpc.provider.test now');
});
