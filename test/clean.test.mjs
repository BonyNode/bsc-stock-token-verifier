// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, loadExtraRules, selfTest, scanTree, scanText } from '../scripts/check-clean.mjs';

const j = (...parts) => parts.join('');
const CHECK = fileURLToPath(new URL('../scripts/check-clean.mjs', import.meta.url));

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stv-clean-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const runCheck = (env) => new Promise((resolve) => {
  execFile(process.execPath, [CHECK], { env, timeout: 20_000 }, (error, stdout, stderr) => {
    resolve({ code: error ? error.code : 0, stdout, stderr });
  });
});

test('every rule of the pre-publication check catches its own fixture, and none of the rules is missing', () => {
  assert.deepEqual(selfTest(), []);
  const ids = new Set(RULES.map((r) => r.id));
  for (const id of ['local-path', 'private-ip', 'credential', 'hex-near-key-word', 'non-english',
    'binance-key-value', 'binance-header-value', 'call-to-buy']) {
    assert.ok(ids.has(id), `rule ${id} is gone`);
  }
});

test('the repository is clean: every file, tests and fixtures included, zero findings', () => {
  const { files, findings } = scanTree();
  for (const expected of ['README.md', 'LICENSE', 'NOTICE', 'DATA.md', 'package.json', 'scripts/check-clean.mjs', 'test/clean.test.mjs', 'src/binance-web3.js', 'docs/snapshot-schema.md']) {
    assert.ok(files.includes(expected), `${expected} is not scanned — the walk narrowed`);
  }
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.excerpt}`), []);
});

test('a planted leak turns the scan red, and a planted secret is reported without its value', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'notes.md'), [j('see /ho', 'me/user/notes'), j('ssh to ', '10.', '0.0.1'), j('Buy ', 'now: NVDAB')].join('\n'));
  fs.writeFileSync(path.join(dir, j('.en', 'v')), 'X=1\n');
  const secret = j('private', '_key = ', '9f'.repeat(16));
  fs.writeFileSync(path.join(dir, 'config.js'), `${secret}\n`);
  const { findings } = scanTree(dir);
  const rules = findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ['call-to-buy', 'credential', 'forbidden-file', 'local-path', 'private-ip']);
  const leaked = findings.find((f) => f.rule === 'credential');
  assert.equal(leaked.excerpt, '[redacted]');
  assert.doesNotMatch(JSON.stringify(findings), /9f9f9f/);
});

test('rules about a private environment come from an optional file outside the repository', (t) => {
  const dir = tempDir(t);
  const extraFile = path.join(dir, 'extra.json');
  fs.writeFileSync(extraFile, JSON.stringify([
    { id: 'ticket-ref', pattern: '\\b(?:card|ticket)\\s*#?\\d{3}\\b', flags: 'i', hit: [j('car', 'd 123')], miss: ['cards'] },
  ]));
  const tree = path.join(dir, 'tree');
  fs.mkdirSync(tree);
  fs.writeFileSync(path.join(tree, 'notes.md'), `${j('car', 'd 123')} is done\n`);

  const extra = loadExtraRules(extraFile);
  assert.equal(extra.rules.length, 1);
  assert.deepEqual(selfTest([...RULES, ...extra.rules]), []);
  assert.deepEqual(scanTree(tree, [...RULES, ...extra.rules]).findings.map((f) => f.rule), ['ticket-ref']);
  assert.deepEqual(scanTree(tree).findings, [], 'the public rules know nothing about it');

  // An extra rule is self-tested like any other: one that misses its own fixture is reported.
  const blind = loadExtraRules((() => { const f = path.join(dir, 'blind.json'); fs.writeFileSync(f, JSON.stringify([{ id: 'blind', pattern: 'x{9}', hit: ['xx'] }])); return f; })());
  assert.deepEqual(selfTest(blind.rules), ['blind does not catch its own fixture']);
});

test('no extra file is not an error; an extra file that cannot be loaded stops the check', async (t) => {
  const dir = tempDir(t);
  assert.deepEqual(loadExtraRules(undefined).rules, []);
  assert.deepEqual(loadExtraRules(path.join(dir, 'absent.json')).rules, []);
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '[{ "id": "x", ');
  assert.throws(() => loadExtraRules(broken), /cannot be read as JSON/);
  const noFixture = path.join(dir, 'no-fixture.json');
  fs.writeFileSync(noFixture, JSON.stringify([{ id: 'x', pattern: 'x' }]));
  assert.throws(() => loadExtraRules(noFixture), /non-empty hit list/);

  const absent = await runCheck({ CHECK_CLEAN_EXTRA: path.join(dir, 'absent.json') });
  assert.equal(absent.code, 0, absent.stderr);
  assert.match(absent.stdout, /no extra rules: the CHECK_CLEAN_EXTRA file does not exist/);
  const loud = await runCheck({ CHECK_CLEAN_EXTRA: broken });
  assert.equal(loud.code, 2);
  assert.match(loud.stderr, /cannot be read as JSON/);

  // A loaded extra rule really scans the tree: this one finds the allowed term in README.md.
  const probe = path.join(dir, 'probe.json');
  fs.writeFileSync(probe, JSON.stringify([{ id: 'probe', pattern: 'Ondo Stocks and xStocks', hit: ['bStocks, Ondo Stocks and xStocks'] }]));
  const found = await runCheck({ CHECK_CLEAN_EXTRA: probe });
  assert.equal(found.code, 1);
  assert.match(found.stdout, /1 extra rules from CHECK_CLEAN_EXTRA/);
  assert.match(found.stderr, /^bin\/stv-verify\.mjs:\d+ probe /m);
});

test('the issuers\' own words and the disclaimers pass', () => {
  assert.deepEqual(scanText('bStocks are certificates; xStocks are tracker certificates; Moderna (Ondo Tokenized) is an Ondo Stock on BNB Smart Chain.'), []);
  assert.deepEqual(scanText('Information only, not investment advice. Nothing here is an offer or a recommendation to buy or sell anything.'), []);
});

test('a Binance Web3 key value or a signing header value is caught and never echoed', () => {
  const leaked = scanText([j('BINANCE_W3_', 'API_KEY=', 'Q2hlY2tDbGVhbg', 'abcdef0123'), j('x-oc-', 'sign: ', 'b'.repeat(43), '=')].join('\n'));
  assert.deepEqual(leaked.map((f) => f.rule), ['binance-key-value', 'binance-header-value']);
  assert.ok(leaked.every((f) => f.excerpt === '[redacted]'));
});
