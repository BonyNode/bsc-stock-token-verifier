// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot } from '../src/schema.js';
import { minimalSnapshot } from './fixtures/snapshot.mjs';

const A1 = `0x${'a1'.repeat(20)}`;

test('the minimal snapshot matches the schema', () => {
  assert.deepEqual(validateSnapshot(minimalSnapshot()), []);
});

test('a genuine verdict without a matching proxy slot is rejected', () => {
  const s = minimalSnapshot();
  s.tokens[0].checks.proxy = false;
  assert.ok(validateSnapshot(s).some((p) => /genuine only with list, code hash and proxy/.test(p)));
});

test('counts that do not add up, a changed notice and a skipped section with items are all rejected', () => {
  const s = minimalSnapshot();
  s.summary.families.bstocks.genuine = 0;
  s.notices.advice = 'buy';
  s.market.items.push({ address: A1, family: 'bstocks', quotes: [] });
  const problems = validateSnapshot(s);
  assert.ok(problems.some((p) => /bstocks.genuine equals/.test(p)));
  assert.ok(problems.some((p) => /notices carry the fixed sentences/.test(p)));
  assert.ok(problems.some((p) => /market has no items when skipped/.test(p)));
});

test('a source url with a query string, an unknown reason code and an RPC URL path are rejected', () => {
  const s = minimalSnapshot();
  s.sources[0].url = 'https://web3.binance.com/build/api/v1/dex/market/rwa/price?tokenContractAddresses=0x1';
  s.tokens[0].reasons.push('looks_fine');
  s.chain.rpcHosts = ['https://user:pass@host/path'];
  const problems = validateSnapshot(s);
  assert.ok(problems.some((p) => /no query string/.test(p)));
  assert.ok(problems.some((p) => /reasons are known codes/.test(p)));
  assert.ok(problems.some((p) => /host names only/.test(p)));
});
