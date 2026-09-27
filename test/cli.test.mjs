// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NVDA, FAKE_NVDA } from './fixtures/chain.mjs';
import { stubRpc } from './helpers.mjs';
import { DEPLOYER, stockTokenBySymbol } from '../src/registry.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(ROOT, 'bin/stv-verify.mjs');
const SERVE = path.join(ROOT, 'bin/stv-serve.mjs');

// Not chain data: made-up contracts for the verdicts the fixtures do not cover.
const UNLISTED = { ...NVDA, addr: `0x${'a'.repeat(40)}`, symbol: 'NEWT', name: 'Newco • Robinhood Token' };
const FROG = { addr: `0x${'7'.repeat(40)}`, code: FAKE_NVDA.code, mul: NVDA.mul, symbol: 'F', name: 'Frog' };
// A broken node: eth_getCode answers an odd number of hex digits, which no byte string has. Nothing
// was read, so nothing may be concluded: the verdict is "unreadable".
const GARBLED = { addr: `0x${'6'.repeat(40)}`, code: '0x363d3' };

// A local JSON-RPC node on an ephemeral port: the CLI talks HTTP to it exactly as it would to a real one.
// It also plays a Blockscout explorer on GET: `creators` maps an address to the creator it reports.
async function localNode(t, creators = {}) {
  const answer = stubRpc([NVDA, FAKE_NVDA, UNLISTED, FROG, GARBLED]);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET') {
      const m = req.url.match(/^\/api\/v2\/addresses\/(0x[0-9a-f]{40})$/);
      res.writeHead(m ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(m && creators[m[1]] ? { creator_address_hash: creators[m[1]] } : {}));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const reply = await answer('local', { body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await reply.json()));
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

// The child gets a minimal environment of its own: no operator RPC list leaks into the test.
const run = (args, cli = CLI) => new Promise((resolve) => {
  execFile(process.execPath, [cli, ...args], { env: { STV_RPC_URLS: '' }, timeout: 20_000 }, (error, stdout, stderr) => {
    resolve({ code: error ? error.code : 0, stdout, stderr });
  });
});

test('CLI: genuine → exit 0 with a readable verdict; counterfeit → exit 1 naming the genuine address', async (t) => {
  const rpc = await localNode(t);
  const good = await run([NVDA.addr, '--rpc', rpc]);
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout, /Verdict: AUTHENTIC Stock Token — NVDA \(NVIDIA\)/);
  assert.match(good.stdout, /matches the reference/);
  assert.match(good.stdout, /uiMultiplier +1\.000775159164630595 \(corporate action applied\)/, 'printed exactly, not through a float');

  const bad = await run([FAKE_NVDA.addr, '--rpc', rpc]);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /Verdict: COUNTERFEIT — claims to be NVDA \(NVIDIA • Robinhood Token\)/, 'the contract\'s own name, not the registry\'s');
  assert.match(bad.stdout, new RegExp(`the real NVDA lives at ${NVDA.addr}`));
});

test('CLI: exit 1 means counterfeit and nothing else — every other verdict has its own code', async (t) => {
  const rpc = await localNode(t);
  const unlisted = await run([UNLISTED.addr, '--rpc', rpc]);
  assert.equal(unlisted.code, 2, unlisted.stderr);
  assert.match(unlisted.stdout, /UNLISTED/);
  // ERC-8056 and a listed ticker, but the contract does not call itself a Stock Token.
  const frog = await run([FROG.addr, '--rpc', rpc]);
  assert.equal(frog.code, 3, frog.stderr);
  assert.match(frog.stdout, /Verdict: NOT A STOCK TOKEN/);
  assert.match(frog.stdout, new RegExp(`shared ticker +F is also the ticker of the Stock Token at ${stockTokenBySymbol('F').address}`));
  assert.doesNotMatch(frog.stdout, /COUNTERFEIT|the real F lives/);
  assert.equal((await run([`0x${'2'.repeat(40)}`, '--rpc', rpc])).code, 3, 'no code at all');
});

test('CLI: a garbled node answer is "unreadable" (4) and an exception exits 70 — never 1', async (t) => {
  const rpc = await localNode(t);
  const garbled = await run([GARBLED.addr, '--rpc', rpc]);
  assert.equal(garbled.code, 4, garbled.stderr);
  assert.match(garbled.stdout, /Verdict: UNREADABLE — nothing was checked \(code_unread\)/);

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'stv-cli-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  for (const dir of ['bin', 'src', 'data']) fs.cpSync(path.join(ROOT, dir), path.join(copy, dir), { recursive: true });
  fs.writeFileSync(path.join(copy, 'data/stock-tokens.snapshot.json'), '{ "tokens": [');
  const broken = await run([FAKE_NVDA.addr, '--rpc', rpc], path.join(copy, 'bin/stv-verify.mjs'));
  assert.equal(broken.code, 70, 'a snapshot that does not load must not read as "counterfeit"');
  assert.match(broken.stderr, /internal error, nothing was concluded/);
});

test('CLI: --help documents the exit codes and STV_RPC_URLS; usage errors exit 64', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /exit codes:/);
  assert.match(help.stdout, /1 +counterfeit/);
  assert.match(help.stdout, /70 +internal error/);
  assert.match(help.stdout, /STV_RPC_URLS/);
  for (const args of [
    [NVDA.addr, '--jsn'],
    [NVDA.addr, '--rpc', ','],
    [NVDA.addr, '--rpc', '--json'],
    [NVDA.addr, NVDA.addr],
    [],
  ]) {
    const r = await run(args);
    assert.equal(r.code, 64, `${JSON.stringify(args)} → ${r.code} ${r.stderr}`);
    assert.match(r.stderr, /usage: stv-verify/);
  }
  assert.match((await run([NVDA.addr, '--jsn'])).stderr, /unknown option --jsn/);
  assert.match((await run([NVDA.addr, '--rpc', ','])).stderr, /--rpc lists no endpoint/);
});

test('stv-serve: a busy port is one clear line, no stack', async (t) => {
  const holder = net.createServer();
  await new Promise((resolve) => { holder.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { holder.close(resolve); }));
  const port = String(holder.address().port);
  const r = await new Promise((resolve) => {
    execFile(process.execPath, [SERVE], { env: { PORT: port, HOST: '127.0.0.1', STV_RPC_URLS: '' }, timeout: 20_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp(`port ${port} on 127\\.0\\.0\\.1 is already in use`));
  assert.doesNotMatch(r.stderr, /\n\s+at |node:internal/, 'no stack trace');
});

test('CLI: --json prints the full result; no contract → exit 3; bad input → exit 64', async (t) => {
  const rpc = await localNode(t);
  const json = await run([NVDA.addr, '--json', '--rpc', rpc]);
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.verdict, 'authentic');
  assert.equal(parsed.rpc, rpc);
  assert.equal((await run([`0x${'2'.repeat(40)}`, '--rpc', rpc])).code, 3);
  assert.equal((await run(['not-an-address'])).code, 64);
  assert.equal((await run([NVDA.addr, '--rpc'])).code, 64);
});

test('CLI: an unreachable node → exit 4, "nothing was checked"', async () => {
  const r = await run([FAKE_NVDA.addr, '--rpc', 'http://127.0.0.1:9']);
  assert.equal(r.code, 4);
  assert.match(r.stdout, /UNREADABLE — nothing was checked/);
});

test('CLI --deployer: a reported creator is compared; an explorer that names none is "not checked", never "NOT the deployer"', async (t) => {
  const node = await localNode(t, { [NVDA.addr]: DEPLOYER });
  const known = await run([NVDA.addr, '--deployer', '--explorer', node, '--rpc', node]);
  assert.equal(known.code, 0);
  assert.match(known.stdout, new RegExp(`creator +${DEPLOYER} is the Stock Token deployer`));
  const silent = await run([FAKE_NVDA.addr, '--deployer', '--explorer', node, '--rpc', node]);
  assert.equal(silent.code, 1);
  assert.match(silent.stdout, /creator +not checked: the explorer reported no creator/);
  assert.doesNotMatch(silent.stdout, /NOT the Stock Token deployer/);
  assert.equal((await run([NVDA.addr, '--explorer'])).code, 64);
});
