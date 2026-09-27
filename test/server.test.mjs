// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createApiServer, API_BASE, MODULE_INFO, RATE_LIMIT } from '../src/server.js';
import { createRpc } from '../src/rpc.js';
import { STOCK_TOKENS } from '../src/registry.js';
import { NVDA, FAKE_NVDA, MULTIPLIERS } from './fixtures/chain.mjs';
import { stubRpc } from './helpers.mjs';

// A switchable upstream: the same server sees a healthy node, then a dead one, then a healthy one.
function upstream() {
  const state = { down: false, calls: [], revertFor: new Set() };
  const tsla = { addr: MULTIPLIERS.TSLA.addr, mul: `0x${BigInt(MULTIPLIERS.TSLA.mul).toString(16)}` };
  const healthy = (reverting) => stubRpc([NVDA, FAKE_NVDA, tsla, ...[...reverting].map((addr) => ({ addr, mul: null }))], { defaultMul: NVDA.mul, calls: state.calls });
  const fetchImpl = async (url, init) => {
    if (state.down) throw new Error('connect ECONNREFUSED /var/run/secret.sock');
    return healthy(state.revertFor)(url, init);
  };
  return { state, rpc: createRpc({ urls: ['https://rpc.test'], fetchImpl, gapMs: 0 }) };
}

async function start(t, options) {
  const server = createApiServer(options);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, init) => {
    const res = await fetch(base + path, init);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
  };
  // Bytes on the wire, for request targets that fetch() refuses to send.
  get.raw = (request) => new Promise((resolve, reject) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => socket.end(request));
    let reply = '';
    socket.on('data', (chunk) => { reply += chunk; });
    socket.on('end', () => resolve(reply));
    socket.on('error', reject);
  });
  return get;
}

test('index: module catalogue in the envelope, CORS open, no license claimed', async (t) => {
  const get = await start(t, upstream());
  const r = await get(API_BASE);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(Object.keys(r.body), ['ok', 'source', 'chain', 'section', 'asOf', 'partial', 'failed', 'data', 'ts']);
  assert.equal(r.body.chain, 4663);
  assert.deepEqual(r.body.data, JSON.parse(JSON.stringify(MODULE_INFO)));
  assert.equal('license' in r.body.data, false, 'the catalogue describes data, and the Apache licence of the code does not cover data (NOTICE, DATA.md): it must not assert one');
  assert.equal((await get(`${API_BASE}/`)).status, 200, 'a trailing slash is the same route');
});

test('stock-tokens: 194 rows with live multipliers, display-only, cached between requests', async (t) => {
  const up = upstream();
  const get = await start(t, up);
  const r = await get(`${API_BASE}/stock-tokens`);
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.equal(d.count, 194);
  assert.equal(d.multipliersRead, 194);
  assert.equal(d.resaleOk, false);
  assert.equal(d.authenticity.genuine, 194);
  assert.equal(r.body.partial, false);
  const tsla = d.tokens.find((x) => x.symbol === 'TSLA');
  assert.equal(tsla.uiMultiplier, 1);
  assert.equal(tsla.corporateActionApplied, false);
  assert.equal(d.tokens.find((x) => x.symbol === 'NVDA').corporateActionApplied, true);
  assert.equal(typeof r.body.asOf, 'number');

  const before = up.state.calls.length;
  assert.equal((await get(`${API_BASE}/stock-tokens`)).status, 200);
  assert.equal(up.state.calls.length, before, 'the second request must be served from cache');
  // 1 head batch + ceil(194 / 8) = 25 paced batches.
  assert.equal(before, 1 + Math.ceil(STOCK_TOKENS.length / 8));
});

test('stock-tokens: unread multipliers make the answer partial and are named', async (t) => {
  const up = upstream();
  up.state.revertFor = new Set([MULTIPLIERS.SPY.addr, MULTIPLIERS.SGOV.addr]);
  const get = await start(t, up);
  const r = await get(`${API_BASE}/stock-tokens`);
  assert.equal(r.status, 200);
  assert.equal(r.body.partial, true);
  assert.equal(r.body.data.multipliersRead, 192);
  assert.deepEqual(r.body.failed, ['uiMultiplier unread for 2 of 194']);
});

test('a dead upstream answers 503 with the reason — never 200 with an empty set — and local paths are scrubbed', async (t) => {
  const up = upstream();
  up.state.down = true;
  const get = await start(t, up);
  const list = await get(`${API_BASE}/stock-tokens`);
  assert.equal(list.status, 503);
  assert.equal(list.body.error, 'source_unavailable');
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(list.text, /\/var\/run/);

  const one = await get(`${API_BASE}/verify/${FAKE_NVDA.addr}`);
  assert.equal(one.status, 503);
  assert.equal(one.body.data.verdict, 'unreadable');
  assert.doesNotMatch(one.text, /\/var\/run/, 'the verdict body carries the error too');

  up.state.down = false;
  const healed = await get(`${API_BASE}/verify/${FAKE_NVDA.addr}`);
  assert.equal(healed.status, 200, 'an unreadable verdict must not be cached');
  assert.equal(healed.body.data.verdict, 'counterfeit');
});

test('verify: verdicts for genuine and counterfeit, 400 on a bad address, 404 and 405 elsewhere', async (t) => {
  const get = await start(t, upstream());
  const good = await get(`${API_BASE}/verify/${NVDA.addr}`);
  assert.equal(good.status, 200);
  assert.equal(good.body.section, 'verify');
  assert.equal(good.body.data.verdict, 'authentic');
  const bad = await get(`${API_BASE}/verify/${FAKE_NVDA.addr}`);
  assert.equal(bad.body.data.verdict, 'counterfeit');
  assert.equal(bad.body.data.genuineAddress, NVDA.addr);
  assert.equal((await get(`${API_BASE}/verify/0x1234`)).status, 400);
  assert.equal((await get(`${API_BASE}/verify/%E0%A4%A`)).status, 400, 'a malformed escape is a bad address, not a crash');
  assert.equal((await get(`${API_BASE}/perps`)).status, 404);
  assert.equal((await get(`${API_BASE}`, { method: 'POST' })).status, 405);
  const head = await get(`${API_BASE}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
});

test('heavy routes are rate-limited per IP', async (t) => {
  const get = await start(t, upstream());
  const statuses = [];
  for (let i = 0; i < RATE_LIMIT.heavy + 1; i += 1) statuses.push((await get(`${API_BASE}/verify/${NVDA.addr}`)).status);
  assert.deepEqual(statuses.slice(0, RATE_LIMIT.heavy), Array(RATE_LIMIT.heavy).fill(200));
  assert.equal(statuses.at(-1), 429);
  assert.equal((await get(API_BASE)).status, 200, 'the regular bucket is separate');
});

test('the HTTP answer never carries the upstream URL: a provider key in its path or query stays in the process', async (t) => {
  const KEY = 'k3yInThePath0123456789';
  const healthy = stubRpc([NVDA]);
  const state = { down: false };
  const rpc = createRpc({
    urls: [`https://rpc.provider.test/v2/${KEY}?key=${KEY}`],
    fetchImpl: async (url, init) => {
      if (state.down) throw new Error(`request to ${url} failed, reason: connect ECONNREFUSED`);
      return healthy(url, init);
    },
    gapMs: 0,
  });
  const get = await start(t, { rpc });
  const ok = await get(`${API_BASE}/verify/${NVDA.addr}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.verdict, 'authentic');
  assert.equal('rpc' in ok.body.data, false, 'the endpoint that answered is not part of the HTTP answer');
  assert.doesNotMatch(ok.text, new RegExp(KEY));

  state.down = true;
  const one = await get(`${API_BASE}/verify/${FAKE_NVDA.addr}`);
  assert.equal(one.status, 503);
  assert.match(one.body.data.error, /https:\/\/rpc\.provider\.test\b/, 'the host may be named');
  assert.doesNotMatch(one.text, new RegExp(KEY), 'the path and the query may not, in the reason or in the verdict body');
  const list = await get(`${API_BASE}/stock-tokens`);
  assert.equal(list.status, 503);
  assert.doesNotMatch(list.text, new RegExp(KEY));
});

test('a login and password in the upstream URL never reach an HTTP answer, however long they are', async (t) => {
  const user = 'operator-login-0123456789';
  const password = `${'P'.repeat(180)}-tail`;
  const rpc = createRpc({
    urls: [`https://${user}:${password}@rpc.provider.test/v2/path`],
    fetchImpl: async (url) => { throw new Error(`request to ${url} failed, reason: connect ECONNREFUSED`); },
    gapMs: 0,
  });
  const get = await start(t, { rpc });
  const one = await get(`${API_BASE}/verify/${FAKE_NVDA.addr}`);
  assert.equal(one.status, 503);
  assert.match(one.body.detail, /https:\/\/rpc\.provider\.test\b/, 'the host may be named');
  assert.doesNotMatch(one.text, /operator-login|P{8}|-tail/, 'the user part and the password may not, in the reason or in the verdict body');
  const list = await get(`${API_BASE}/stock-tokens`);
  assert.equal(list.status, 503);
  assert.doesNotMatch(list.text, /operator-login|P{8}|-tail/);
});

test('malformed or empty bytecode answers are 503 "unreadable", never a 500 and never a counterfeit', async (t) => {
  const answers = { code: '0x' };
  const rpc = createRpc({ urls: ['https://rpc.test'], fetchImpl: (url, init) => stubRpc([{ ...NVDA, code: answers.code }])(url, init), gapMs: 0 });
  const get = await start(t, { rpc });
  const empty = await get(`${API_BASE}/verify/${NVDA.addr}`);
  assert.equal(empty.status, 503);
  assert.equal(empty.body.data.verdict, 'unreadable');
  assert.equal(empty.body.data.reason, 'code_empty');
  answers.code = `${NVDA.code}a`;
  const odd = await get(`${API_BASE}/verify/${NVDA.addr}`);
  assert.equal(odd.status, 503);
  assert.equal(odd.body.data.reason, 'code_unread');
  answers.code = NVDA.code;
  assert.equal((await get(`${API_BASE}/verify/${NVDA.addr}`)).body.data.verdict, 'authentic', 'neither answer was cached');
});

test('behind a proxy the client is the rightmost X-Forwarded-For entry: a forged left part does not reset the limit', async (t) => {
  const get = await start(t, { ...upstream(), trustProxy: true });
  const statuses = [];
  for (let i = 0; i <= RATE_LIMIT.heavy; i += 1) {
    statuses.push((await get(`${API_BASE}/verify/${NVDA.addr}`, { headers: { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.7` } })).status);
  }
  assert.deepEqual(statuses.slice(0, RATE_LIMIT.heavy), Array(RATE_LIMIT.heavy).fill(200));
  assert.equal(statuses.at(-1), 429);
  const other = await get(`${API_BASE}/verify/${NVDA.addr}`, { headers: { 'x-forwarded-for': '203.0.113.8' } });
  assert.equal(other.status, 200, 'another client behind the same proxy has a bucket of its own');
});

test('a malformed request target is a 400, not a crash', async (t) => {
  const get = await start(t, upstream());
  const reply = await get.raw('GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match(reply, /^HTTP\/1\.1 400 /);
  assert.match(reply, /"error":"bad_request"/);
  assert.equal((await get(API_BASE)).status, 200, 'the server is still serving');
});
