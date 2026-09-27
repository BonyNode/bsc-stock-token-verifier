// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
// Live checks against the real chain. Skipped unless STV_LIVE=1, so `npm test` never needs a network.
//   npm run test:live        (sets STV_LIVE=1)
// About 30 JSON-RPC requests in total; STV_RPC_URLS is honoured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpc } from '../src/rpc.js';
import { verifyAddress } from '../src/verify.js';
import { loadStockTokens } from '../src/catalogue.js';
import { NVDA, FAKE_NVDA, FAKE_LULU } from './fixtures/chain.mjs';

const live = process.env.STV_LIVE === '1';
const skip = live ? false : 'set STV_LIVE=1 to run against the real chain';

test('live: genuine NVDA is authentic, and its bytecode still hashes to the reference', { skip }, async () => {
  const r = await verifyAddress(NVDA.addr, { rpc: createRpc() });
  assert.equal(r.verdict, 'authentic', r.error);
  assert.equal(r.codeMatch, true);
  assert.ok(r.multiplier >= 1, `multiplier ${r.multiplier}`);
  assert.ok(r.block > 67_000_000);
});

test('live: counterfeit NVDA and the LULU twin with a working multiplier are both counterfeit', { skip }, async () => {
  const rpc = createRpc();
  const nvda = await verifyAddress(FAKE_NVDA.addr, { rpc });
  assert.equal(nvda.verdict, 'counterfeit', nvda.error);
  assert.equal(nvda.genuineAddress, NVDA.addr);
  const lulu = await verifyAddress(FAKE_LULU.addr, { rpc });
  assert.equal(lulu.verdict, 'counterfeit', lulu.error);
  assert.equal(lulu.multiplierAnswered, true);
  assert.equal(lulu.codeHash, FAKE_LULU.codeHash);
});

test('live: all 194 multipliers are readable', { skip }, async () => {
  const { data } = await loadStockTokens(createRpc());
  assert.equal(data.count, 194);
  assert.equal(data.multipliersRead, 194);
});
