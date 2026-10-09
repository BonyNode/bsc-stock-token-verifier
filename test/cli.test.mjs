// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The CLI end to end, offline: a JSON-RPC node on loopback serves the fixtures, and the lists and
// rules come from a small snapshot written by the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { keccak256Hex } from '../src/keccak.js';
import { deriveRule } from '../src/verdict.js';
import { writeSnapshot } from '../src/snapshot.js';
import { renderReport } from '../src/report.js';
import { AEHRX, FAKE_NVDAX, NVDAB, WAEHRX } from './fixtures/bsc.mjs';
import { stubRpc } from './helpers.mjs';
import { minimalSnapshot } from './fixtures/snapshot.mjs';

const CLI = fileURLToPath(new URL('../bin/stv-verify.mjs', import.meta.url));
const run = (args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 30_000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
});

const factsOf = (f) => ({ address: f.addr, codeSize: (f.code.length - 2) / 2, codeHash: keccak256Hex(f.code), beacon: f.beacon, admin: f.admin, implementation: f.implementation });

/** A snapshot with NVDAB (bStocks) and AEHRx + wrapper (xStocks) listed, rules derived from them. */
function fixtureSnapshot() {
  const s = minimalSnapshot();
  const rule = (f) => { const r = deriveRule([factsOf(f)]); return { codeHash: r.codeHash, codeSize: r.codeSize, proxyKind: r.proxyKind, slot: r.slot, slotValue: r.slotValue, members: r.members, implementations: r.implementations, outliers: r.outliers }; };
  s.families.bstocks.fingerprint.roles = { token: rule(NVDAB) };
  s.families.xstocks.fingerprint.roles = { token: rule(AEHRX), wrapper: rule(WAEHRX) };
  const entry = (f, family, role, ticker) => ({
    address: f.addr, family, role, pairAddress: null, symbol: f.symbol, name: f.name, decimals: 18, underlyingTicker: ticker, assetClass: 'stock',
    listedBy: [family === 'xstocks' ? 'xstocks-api' : 'binance-public:stock-list'],
    onchain: { readAt: s.generatedAt, block: 1, codeSize: (f.code.length - 2) / 2, codeHash: keccak256Hex(f.code), beacon: f.beacon, implementation: f.implementation, admin: f.admin },
    creator: { status: 'not_checked', address: null, source: 'binance-w3:basic-info', fetchedAt: null },
    checks: { issuerList: true, hasCode: true, codeHash: true, proxy: true, creator: null },
    verdict: 'genuine', reasons: ['issuer_list', 'code_hash_match', 'proxy_match', 'creator_not_checked'], explanation: 'e',
  });
  s.tokens = [entry(NVDAB, 'bstocks', 'token', 'NVDA'), entry(AEHRX, 'xstocks', 'token', 'AEHR'), entry(WAEHRX, 'xstocks', 'wrapper', 'AEHR')];
  // The look-alike copies the symbol of the genuine NVDAx, which this small snapshot lists as well.
  const nvdax = { ...entry(AEHRX, 'xstocks', 'token', 'NVDA'), address: '0xc845b2894dbddd03858fd2d643b4ef725fe0849d', symbol: 'NVDAx', name: 'NVIDIA xStock' };
  s.tokens.push(nvdax);
  s.summary.families.bstocks = { listed: 1, noCode: 0, genuine: 1, unknown: 0, lookalikes: 0, byRole: null };
  s.summary.families.xstocks = { listed: 3, noCode: 0, genuine: 3, unknown: 0, lookalikes: 0, byRole: null };
  return s;
}

async function withNode(t) {
  const fetchImpl = stubRpc([NVDAB, AEHRX, WAEHRX, FAKE_NVDAX]);
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const answer = await fetchImpl('http://local', { body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await answer.json()));
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function snapshotFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stv-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: writeSnapshot(path.join(dir, 'snapshot.json'), fixtureSnapshot()) };
}

test('help and usage errors: exit 0 for --help, 64 for anything malformed, never 1', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /BNB Smart Chain/);
  for (const args of [[], ['0x1234'], ['--bogus'], ['scan', 'extra'], ['--rpc']]) {
    const r = await run(args);
    assert.equal(r.code, 64, `${args.join(' ')} → ${r.code} ${r.stderr}`);
  }
});

test('a genuine bStocks contract exits 0, a look-alike exits 1 and names the genuine contract', async (t) => {
  const rpc = await withNode(t);
  const { file } = snapshotFile(t);
  const genuine = await run([NVDAB.addr, '--rpc', rpc, '--snapshot', file]);
  assert.equal(genuine.code, 0, genuine.stderr);
  assert.match(genuine.stdout, /GENUINE bStocks/);
  const fake = await run([FAKE_NVDAX.addr, '--rpc', rpc, '--snapshot', file, '--json']);
  assert.equal(fake.code, 1, fake.stderr);
  const r = JSON.parse(fake.stdout);
  assert.equal(r.verdict, 'look-alike');
  assert.equal(r.claim.genuineAddress, '0xc845b2894dbddd03858fd2d643b4ef725fe0849d');
  const wrapper = await run([WAEHRX.addr, '--rpc', rpc, '--snapshot', file, '--json']);
  assert.equal(JSON.parse(wrapper.stdout).role, 'wrapper');
});

test('an address without code on no list is none (3); a dead RPC is unknown (4), never a clean verdict', async (t) => {
  const rpc = await withNode(t);
  const { file } = snapshotFile(t);
  const none = await run([`0x${'4'.repeat(40)}`, '--rpc', rpc, '--snapshot', file]);
  assert.equal(none.code, 3, none.stderr);
  const down = await run([NVDAB.addr, '--rpc', 'http://127.0.0.1:9', '--snapshot', file, '--json']);
  assert.equal(down.code, 4, down.stderr);
  assert.equal(JSON.parse(down.stdout).verdict, 'unknown');
});

test('report renders a snapshot into one self-contained HTML file', async (t) => {
  const { dir, file } = snapshotFile(t);
  const out = path.join(dir, 'report.html');
  const r = await run(['report', '--snapshot', file, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Not affiliated with/);
  assert.match(html, /not investment advice/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet|@import/i, 'no external script or style');
  assert.match(renderReport(fixtureSnapshot()), /prefers-color-scheme:dark/);
});
