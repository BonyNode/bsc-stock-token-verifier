#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// One call to each keyed Binance Web3 endpoint this package uses, to see the live answer shapes.
//
//   BINANCE_W3_ENV_FILE=/path/to/file node scripts/probe-binance-w3.mjs [--save <dir>]
//
// Prints per endpoint: UTC time, HTTP status, API code and message, the number of rows and the field
// names of the first row — never a value of a header, the key or the signature. --save writes each
// answer BODY (market data only) to <dir>/<endpoint>.json for use as a test fixture.
import fs from 'node:fs';
import path from 'node:path';
import { USDT } from '../src/chain.js';
import { BinanceApiError, createBinanceWeb3, loadCredentials } from '../src/binance-web3.js';
import { WALLET_PLACEHOLDER } from '../src/market.js';

const NVDAB = '0x02fca66c1d1afb4e2a7884261eb00f63598a7436';
const NVDAON = '0xa9ee28c80f960b889dfbd1902055218cba016f75';

const PROBES = [
  ['rwaPlatforms', { query: { binanceChainId: '56' } }],
  ['rwaTokens', { query: { binanceChainId: '56', platformId: 'bstock' } }],
  ['rwaTokens', { query: { binanceChainId: '56', platformId: 'ondo' } }],
  ['rwaPrice', { query: { binanceChainId: '56', tokenContractAddresses: `${NVDAB},${NVDAON}` } }],
  ['basicInfo', { body: [{ binanceChainId: '56', tokenContractAddress: NVDAB }] }],
  ['tokenSearch', { query: { chains: '56', search: 'NVDA' } }],
  ['topLiquidity', { query: { binanceChainId: '56', tokenContractAddress: NVDAB } }],
  ['quote', { query: { binanceChainId: '56', amount: (20n * 10n ** 18n).toString(), fromTokenAddress: USDT.address, toTokenAddress: NVDAB, userWalletAddress: WALLET_PLACEHOLDER } }],
];

const shape = (data) => {
  if (Array.isArray(data)) return `array(${data.length}) first keys: ${Object.keys(data[0] || {}).join(',')}`;
  if (data && typeof data === 'object') {
    const inner = Object.entries(data).find(([, v]) => Array.isArray(v));
    return `object keys: ${Object.keys(data).join(',')}${inner ? ` | ${inner[0]}: array(${inner[1].length}) first keys: ${Object.keys(inner[1][0] || {}).join(',')}` : ''}`;
  }
  return `${data === null ? 'null' : typeof data}`;
};

const args = process.argv.slice(2);
const saveDir = args[0] === '--save' ? args[1] : null;
const credentials = loadCredentials();
if (!credentials.ok) { console.error(`probe: ${credentials.reason}`); process.exit(2); }
const w3 = createBinanceWeb3({ credentials });
let n = 0;
for (const [name, options] of PROBES) {
  n += 1;
  const label = `${name}${options.query?.platformId ? `:${options.query.platformId}` : ''}`;
  try {
    const data = await w3.request(name, options);
    const entry = w3.log.at(-1);
    console.log(`${entry.at} ${label} HTTP ${entry.http} code ${entry.code} ${entry.ms} ms — ${shape(data)}`);
    if (saveDir) { fs.mkdirSync(saveDir, { recursive: true }); fs.writeFileSync(path.join(saveDir, `${String(n).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-')}.json`), `${JSON.stringify(data, null, 1)}\n`); }
  } catch (error) {
    const entry = w3.log.at(-1);
    console.log(`${entry?.at ?? new Date().toISOString()} ${label} ${error instanceof BinanceApiError ? `${error.kind} HTTP ${error.http} code ${error.code}` : 'error'}: ${String(error.message).slice(0, 200)}`);
    if (error.fatal) break;
  }
}
