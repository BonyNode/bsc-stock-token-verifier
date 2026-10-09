// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { BinanceApiError, createBinanceWeb3, encodeQuery, loadCredentials, readBasicInfo, readQuote, readRwaTokens, requestPathOf, signRequest } from '../src/binance-web3.js';
import { json } from './helpers.mjs';

// A made-up key pair: the tests never see a real one.
const FAKE = { BINANCE_W3_API_KEY: 'fake-key-1', BINANCE_W3_SECRET_KEY: 'fake-secret-1' };
const creds = () => loadCredentials({ env: FAKE });
const clock = () => { let t = Date.parse('2026-10-09T16:00:00.000Z'); return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test('the signature is Base64 HMAC-SHA256 of timestamp + METHOD + /build path with query + body', () => {
  const timestamp = '2026-05-11T10:08:57.715Z';
  const requestPath = '/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0xa,0xb';
  const expected = crypto.createHmac('sha256', 'fake-secret-1').update(`${timestamp}GET${requestPath}`).digest('base64');
  assert.equal(signRequest({ secretKey: 'fake-secret-1', timestamp, method: 'get', requestPath }), expected);
  assert.notEqual(signRequest({ secretKey: 'fake-secret-1', timestamp, method: 'GET', requestPath: requestPath.replace('/build', '') }), expected, 'a path without /build signs something else');
});

test('the signed path carries /build and the exact query that is sent; commas stay commas', () => {
  assert.equal(requestPathOf('/api/v1/dex/market/rwa/price', { binanceChainId: '56', tokenContractAddresses: '0xa,0xb', skip: undefined }), '/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0xa,0xb');
  assert.equal(encodeQuery({ search: 'Ondo Tokenized', x: '' }), 'search=Ondo%20Tokenized');
});

test('a request sends the key, an ISO timestamp with ms and the signature of what it sends', async () => {
  const c = clock();
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return json({ code: 0, msg: '', data: [{ tokenContractAddress: `0x${'ab'.repeat(20)}` }] }); };
  const w3 = createBinanceWeb3({ credentials: creds(), fetchImpl, ...c });
  await w3.request('rwaTokens', { query: { binanceChainId: '56', platformId: 'bstock' } });
  assert.equal(seen.url, 'https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?binanceChainId=56&platformId=bstock');
  const h = seen.init.headers;
  assert.equal(h['X-OC-APIKEY'], 'fake-key-1');
  assert.match(h['X-OC-TIMESTAMP'], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(h['X-OC-SIGN'], signRequest({ secretKey: 'fake-secret-1', timestamp: h['X-OC-TIMESTAMP'], method: 'GET', requestPath: '/build/api/v1/dex/market/rwa/tokens?binanceChainId=56&platformId=bstock' }));
  assert.equal(seen.init.body, undefined, 'a GET has no body');
  assert.doesNotMatch(JSON.stringify(w3.log), /fake-secret|fake-key|X-OC-SIGN/i, 'the request log holds no key, secret or signature');
});

test('the documented failures become explicit errors: 40101, 40102, 40104, RFQ codes, an empty success', async () => {
  const cases = [
    [{ code: 40101, msg: 'API Key is required', data: '' }, 401, 'auth'],
    [{ code: 40102, msg: 'Invalid signature' }, 401, 'signature'],
    [{ code: 40104, msg: 'no permission' }, 403, 'permission'],
    [{ code: 40369, msg: 'BSTOCK_INVALID_TRADING_TIME' }, 200, 'rfq'],
    [{ code: 40001, msg: 'Parameter binanceChainId is required' }, 200, 'api'],
    [{ code: 0, msg: '' }, 200, 'schema'],
  ];
  for (const [body, status, kind] of cases) {
    const w3 = createBinanceWeb3({ credentials: creds(), fetchImpl: async () => json(body, status), ...clock() });
    await assert.rejects(w3.request('quote', { query: {} }), (e) => e instanceof BinanceApiError && e.kind === kind && e.code === (body.code === 0 ? null : body.code), `${kind}`);
  }
  const fatal = new BinanceApiError('x', { kind: 'signature' });
  assert.equal(fatal.fatal, true);
  assert.equal(new BinanceApiError('x', { kind: 'rfq' }).fatal, false);
});

test('HTTP 429 waits for Retry-After, then retries; a third 429 is an error', async () => {
  const c = clock();
  let calls = 0;
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); await c.sleep(ms); };
  const w3 = createBinanceWeb3({ credentials: creds(), now: c.now, sleep, fetchImpl: async () => { calls += 1; return calls < 2 ? json({ code: 429, msg: 'Too many requests' }, 429, { 'retry-after': '3' }) : json({ code: 0, data: [] }); } });
  assert.deepEqual(await w3.request('topLiquidity', { query: {} }), []);
  assert.ok(waits.includes(3000), `waited ${waits.join(',')}`);
  const always = createBinanceWeb3({ credentials: creds(), ...clock(), fetchImpl: async () => json({ code: 429 }, 429, { 'retry-after': '1' }) });
  await assert.rejects(always.request('topLiquidity', { query: {} }), (e) => e.kind === 'rate_limited' && e.http === 429);
});

test('requests to one endpoint are at least 250 ms apart', async () => {
  const c = clock();
  const at = [];
  const w3 = createBinanceWeb3({ credentials: creds(), ...c, fetchImpl: async () => { at.push(c.now()); return json({ code: 0, data: [] }); } });
  for (let i = 0; i < 4; i += 1) await w3.request('topLiquidity', { query: {} });
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] - at[i - 1] >= 250, `gap ${at[i] - at[i - 1]} ms`);
});

test('credentials come from a KEY=VALUE file and never show in JSON or inspect', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stv-cred-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'w3.env');
  fs.writeFileSync(file, 'BINANCE_W3_API_KEY=file-key-0002\nBINANCE_W3_SECRET_KEY="file-secret-0002"\n');
  const c = loadCredentials({ env: {}, file });
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, 'file-key-0002');
  assert.equal(c.secretKey, 'file-secret-0002');
  assert.doesNotMatch(JSON.stringify(c) + inspect(c) + Object.keys(c).join(','), /file-key|file-secret/);
  assert.deepEqual(loadCredentials({ env: {}, file: path.join(dir, 'absent.env') }), { ok: false, reason: 'key_file_missing' });
  assert.deepEqual(loadCredentials({ env: {} }), { ok: false, reason: 'no_api_key' });
  assert.throws(() => createBinanceWeb3({ credentials: { ok: false } }), /no Binance Web3 API key/);
});

test('readers follow the live shapes and refuse an answer without the fields they rely on', () => {
  const rows = readRwaTokens([{ tokenContractAddress: '0x80F3D493EBCE97E343C53D29A137942416B4FFC0', platformId: 'bstock', tokenSymbol: 'CRCLB', decimals: '18', underlyingTicker: 'CRCL', tokenToShareRatio: '1', statusInfo: { openState: true, marketStatus: null, reasonCode: 'TRADING' }, tokenPrice: '86.14', referencePrice: '86.14' }]);
  assert.equal(rows[0].address, '0x80f3d493ebce97e343c53d29a137942416b4ffc0');
  assert.equal(rows[0].decimals, 18);
  assert.equal(rows[0].status.reasonCode, 'TRADING');
  assert.throws(() => readRwaTokens([{ address: '0x1' }]), (e) => e.kind === 'schema' && /tokenContractAddress/.test(e.message));
  // basic-info answers ONE object; a comma list answers data null.
  assert.deepEqual(readBasicInfo({ tokenContractAddress: '0x02fca66c1d1afb4e2a7884261eb00f63598a7436', creatorAddress: '0x64FDAF82D69D5A8AB409331E3042042E8A178D53', createTime: 1780655759500, tagList: null }),
    [{ address: '0x02fca66c1d1afb4e2a7884261eb00f63598a7436', creator: '0x64fdaf82d69d5a8ab409331e3042042e8a178d53', createTime: 1780655759500, isRecognized: null }]);
  assert.deepEqual(readBasicInfo(null), []);
  const q = readQuote([{ vendorName: 'LiquidMesh', executionMode: 'SWAP', toTokenAmount: '86948320096335237', priceImpactPercent: '0.0000000000', tradeFee: '0.01037844', toToken: { decimal: '18', isHoneyPot: false, taxRate: '0' }, dexRouterList: [{ dexProtocol: { dexName: 'Kipseli', percent: '100.00' } }] }]);
  assert.deepEqual([q.vendorName, q.dexes, q.toTokenDecimals, q.isHoneyPot], ['LiquidMesh', ['Kipseli'], 18, false]);
  assert.throws(() => readQuote([{}]), (e) => e.kind === 'schema');
});
