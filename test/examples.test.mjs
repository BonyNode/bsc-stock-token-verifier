// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The example responses in examples/ must have the shape the API serves today: a stale example is
// documentation that lies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApiServer, API_BASE, MODULE_INFO } from '../src/server.js';
import { createRpc } from '../src/rpc.js';
import { AUTHENTICITY } from '../src/registry.js';
import { RIGHTS } from '../src/catalogue.js';
import { stockTokenVerdict } from '../src/verdict.js';
import { NVDA } from './fixtures/chain.mjs';
import { stubRpc } from './helpers.mjs';

const example = (name) => JSON.parse(fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'));

test('examples carry the current texts, fields and verdicts', async (t) => {
  assert.deepEqual(example('index.json').data, JSON.parse(JSON.stringify(MODULE_INFO)));
  const list = example('stock-tokens.json').data;
  assert.deepEqual(list.authenticity, JSON.parse(JSON.stringify(AUTHENTICITY)));
  assert.equal(list.rights, RIGHTS);

  const server = createApiServer({ rpc: createRpc({ urls: ['https://rpc.test'], fetchImpl: stubRpc([NVDA]), gapMs: 0 }) });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); }));
  const live = await (await fetch(`http://127.0.0.1:${server.address().port}${API_BASE}/verify/${NVDA.addr}`)).json();
  for (const name of ['verify-authentic.json', 'verify-counterfeit.json', 'verify-counterfeit-with-multiplier.json']) {
    const { data } = example(name);
    assert.deepEqual(Object.keys(data), Object.keys(live.data), `${name}: fields differ from what the API serves`);
    const again = stockTokenVerdict({ address: data.address, codeHash: data.codeHash, uiMultiplier: data.multiplierRaw, symbol: data.symbol, name: data.name });
    assert.equal(again.verdict, data.verdict, `${name}: the captured facts no longer give the shown verdict`);
    assert.deepEqual(again.sharesTickerWith, data.sharesTickerWith);
  }
});
