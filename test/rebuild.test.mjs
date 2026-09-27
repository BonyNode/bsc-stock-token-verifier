// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recheck, rebuild, listCandidates, snapshotText, underlyingOf, parseArgs, UsageError } from '../scripts/rebuild-registry.mjs';
import { createRpc } from '../src/rpc.js';
import { DEPLOYER, STOCK_TOKENS } from '../src/registry.js';
import { NVDA, FAKE_NVDA } from './fixtures/chain.mjs';
import { stubRpc } from './helpers.mjs';

const EXPLORER = 'https://explorer.test';
const NEW_GENUINE = { ...NVDA, addr: `0x${'a'.repeat(40)}`, symbol: 'NEWT', name: 'Newco • Robinhood Token' };
const TWIN = { addr: `0x${'b'.repeat(40)}`, code: FAKE_NVDA.code, mul: NVDA.mul, symbol: 'LULU', name: 'Lululemon • Robinhood Token' };
const COPYCAT = { ...NVDA, addr: `0x${'c'.repeat(40)}`, symbol: 'COPY', name: 'Copy • Robinhood Token' };
const CONTRACTS = [NVDA, NEW_GENUINE, FAKE_NVDA, TWIN, COPYCAT];
const CREATORS = { [NVDA.addr]: DEPLOYER, [NEW_GENUINE.addr]: DEPLOYER, [TWIN.addr]: `0x${'d'.repeat(40)}`, [COPYCAT.addr]: `0x${'e'.repeat(40)}` };

// Blockscout v2 shapes: two pages of search results (older "address" and newer "address_hash"
// field names mixed), plus one unrelated token the name filter must drop.
function explorer({ calls = [] } = {}) {
  const item = (c, field = 'address_hash') => ({ [field]: c.addr, name: c.name, symbol: c.symbol, decimals: '18' });
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });
    if (u.pathname === '/api/v2/tokens') {
      if (!u.searchParams.get('page')) return ok({ items: [item(NVDA), item(NEW_GENUINE, 'address'), { address_hash: `0x${'f'.repeat(40)}`, name: 'Robinhood Token Fan Club', symbol: 'FAN' }], next_page_params: { page: 2 } });
      return ok({ items: [item(FAKE_NVDA), item(TWIN), item(COPYCAT)], next_page_params: null });
    }
    const m = u.pathname.match(/^\/api\/v2\/addresses\/(0x[0-9a-f]{40})$/);
    if (m) return ok({ creator_address_hash: CREATORS[m[1]] ?? null });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const rpc = (contracts, options) => createRpc({ urls: ['https://rpc.test'], fetchImpl: stubRpc(contracts, options), gapMs: 0 });

test('recheck: every shipped address is re-hashed over RPC; a changed bytecode is reported by symbol', async () => {
  const shipped = STOCK_TOKENS.map((t) => ({ addr: t.address, code: NVDA.code }));
  shipped[5] = { ...shipped[5], code: FAKE_NVDA.code };
  const r = await recheck({ rpc: rpc(shipped) });
  assert.equal(r.checked, 194);
  assert.equal(r.matched, 193);
  assert.deepEqual(r.mismatched, [{ symbol: STOCK_TOKENS[5].symbol, address: STOCK_TOKENS[5].address }]);
});

test('rebuild: three tests split the candidates, disagreements are listed, the diff against the snapshot is named', async () => {
  const calls = [];
  const r = await rebuild({ rpc: rpc(CONTRACTS), explorer: EXPLORER, fetchImpl: explorer({ calls }), gapMs: 0 });
  assert.equal(r.candidates, 5, 'the name filter keeps only "… Robinhood Token"');
  assert.equal(r.passedInterface, 4, 'the minimal-proxy counterfeit fails the ERC-8056 interface test');
  assert.equal(r.passedBytecode, 3);
  assert.equal(r.passedCreator, 2);
  assert.equal(r.genuine, 2);
  assert.equal(r.rejected, 3);
  assert.deepEqual(r.disagreements, [{ address: COPYCAT.addr, symbol: 'COPY', bytecode: true, creator: `0x${'e'.repeat(40)}` }],
    'identical bytecode deployed by a stranger is exactly what the creator test exists for');
  assert.deepEqual(r.added, [{ symbol: 'NEWT', address: NEW_GENUINE.addr }]);
  assert.equal(r.removed.length, 193);
  assert.deepEqual(r.tokens.map((t) => t.underlying), ['Newco', 'NVIDIA']);
  assert.equal(calls.filter((u) => u.includes('/addresses/')).length, 4, 'creators are asked only for interface passers');
});

test('rebuild refuses to report an empty registry when the explorer is unreachable or challenged', async () => {
  const challenged = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(listCandidates({ explorer: EXPLORER, fetchImpl: challenged, gapMs: 0 }), /browser challenge/);
  const empty = async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) });
  await assert.rejects(rebuild({ rpc: rpc([]), explorer: EXPLORER, fetchImpl: empty, gapMs: 0 }), /refusing to report an empty registry/);
});

test('the written snapshot has the shipped format', async () => {
  const r = await rebuild({ rpc: rpc(CONTRACTS), explorer: EXPLORER, fetchImpl: explorer(), gapMs: 0 });
  const doc = JSON.parse(snapshotText(r));
  assert.deepEqual(Object.keys(doc), ['snapshotDate', 'chainId', 'candidates', 'genuine', 'rejected', 'tokens']);
  assert.deepEqual(Object.keys(doc.tokens[0]), ['symbol', 'address', 'underlying']);
  assert.equal(underlyingOf('ExxonMobil Holdings Corporation • Robinhood Token'), 'ExxonMobil Holdings Corporation');
});

test('arguments: --help needs no network, --out needs a value, anything unknown is refused', async (t) => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['--recheck']), { mode: 'recheck', out: null });
  assert.deepEqual(parseArgs(['--rebuild', '--out', 'snapshot.json']), { mode: 'rebuild', out: 'snapshot.json' });
  for (const argv of [['--rebuild', '--out'], ['--rebuild', '--out', '--recheck'], ['--rebuld'], [], ['--recheck', '--rebuild'], ['--recheck', '--out', 'x.json']]) {
    assert.throws(() => parseArgs(argv), UsageError, JSON.stringify(argv));
  }

  // The script itself: an RPC node that counts what reaches it must see nothing.
  let hits = 0;
  const node = http.createServer((req, res) => { hits += 1; res.end('[]'); });
  await new Promise((resolve) => { node.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { node.close(resolve); }));
  const script = fileURLToPath(new URL('../scripts/rebuild-registry.mjs', import.meta.url));
  const run = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { env: { STV_RPC_URLS: `http://127.0.0.1:${node.address().port}` }, timeout: 20_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--rebuild/);
  assert.equal((await run(['--rebuild', '--out'])).code, 64);
  assert.equal(hits, 0, 'neither --help nor a usage error may touch the network');
});
