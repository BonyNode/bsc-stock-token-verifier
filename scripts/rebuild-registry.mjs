#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Reproduce the Stock Token registry.
//
//   node scripts/rebuild-registry.mjs --recheck
//       RPC only. Re-reads the bytecode of every address in the shipped snapshot and compares its
//       keccak256 with the reference hash. Anyone can run it over any RPC, at the latest block,
//       any time after the snapshot.
//
//   node scripts/rebuild-registry.mjs --rebuild [--out <file>]
//       Needs the chain explorer API (Blockscout v2). Lists every token whose name ends in
//       "Robinhood Token", applies the three tests described in src/registry.js, reports the split
//       and the difference from the shipped snapshot; --out writes a new snapshot file.
//       Some networks receive a browser challenge instead of JSON from the explorer; the script
//       then stops and says so rather than reporting an empty registry.
//
// Exit codes: 0 no difference found · 1 a mismatch, an unread bytecode or a disagreement between
// the tests · 2 the run failed · 64 usage error.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CHAIN_ID, EXPLORER, rpcUrlsFromEnv } from '../src/chain.js';
import { keccak256Hex, selector } from '../src/keccak.js';
import { CODE_HASH, DEPLOYER, SNAPSHOT_DATE, STOCK_TOKENS } from '../src/registry.js';
import { assertChainId, createRpc, hexToBigInt } from '../src/rpc.js';
import { lookupCreator, SEL } from '../src/verify.js';

const SEL_DECIMALS = selector('decimals()');
const EXPLORER_GAP_MS = 300;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function recheck({ rpc, tokens = STOCK_TOKENS }) {
  assertChainId((await rpc.batch([{ method: 'eth_chainId' }]))[0]);
  const answers = await rpc.paced(tokens.map((t) => ({ method: 'eth_getCode', params: [t.address, 'latest'] })));
  const mismatched = [];
  let unread = 0;
  tokens.forEach((t, i) => {
    const code = answers[i]?.result;
    if (typeof code !== 'string') { unread += 1; return; }
    if (keccak256Hex(code) !== CODE_HASH) mismatched.push({ symbol: t.symbol, address: t.address });
  });
  return { checked: tokens.length, matched: tokens.length - mismatched.length - unread, unread, mismatched };
}

/** Every ERC-20 in the explorer whose name ends in "Robinhood Token". */
export async function listCandidates({ explorer = EXPLORER, fetchImpl = globalThis.fetch, gapMs = EXPLORER_GAP_MS, maxPages = 50 }) {
  const out = new Map();
  let params = new URLSearchParams({ q: 'Robinhood Token', type: 'ERC-20' });
  for (let page = 0; page < maxPages; page += 1) {
    if (page > 0) await sleep(gapMs);
    const response = await fetchImpl(`${explorer}/api/v2/tokens?${params}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`explorer answered HTTP ${response.status} — cannot list candidates from this network`);
    let json;
    try { json = await response.json(); } catch { throw new Error('explorer answered something other than JSON (a browser challenge?) — cannot list candidates from this network'); }
    for (const item of Array.isArray(json?.items) ? json.items : []) {
      const address = String(item.address_hash ?? item.address ?? '').toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(address) && /robinhood token\s*$/i.test(String(item.name || ''))) {
        out.set(address, { address, name: String(item.name), symbol: String(item.symbol || '').toUpperCase() });
      }
    }
    if (!json?.next_page_params) break;
    params = new URLSearchParams({ q: 'Robinhood Token', type: 'ERC-20', ...Object.fromEntries(Object.entries(json.next_page_params).map(([k, v]) => [k, String(v)])) });
  }
  return [...out.values()];
}

export const underlyingOf = (name) => String(name).replace(/\s*[•·|-]?\s*Robinhood Token\s*$/i, '').trim();

export async function rebuild({ rpc, explorer = EXPLORER, fetchImpl = globalThis.fetch, gapMs = EXPLORER_GAP_MS }) {
  assertChainId((await rpc.batch([{ method: 'eth_chainId' }]))[0]);
  const candidates = await listCandidates({ explorer, fetchImpl, gapMs });
  if (!candidates.length) throw new Error('the explorer returned no candidates — refusing to report an empty registry');

  const calls = candidates.flatMap((c) => [
    { method: 'eth_getCode', params: [c.address, 'latest'] },
    { method: 'eth_call', params: [{ to: c.address, data: SEL_DECIMALS }, 'latest'] },
    { method: 'eth_call', params: [{ to: c.address, data: SEL.uiMultiplier }, 'latest'] },
  ]);
  const answers = await rpc.paced(calls);
  const rows = candidates.map((c, i) => {
    const [code, decimals, mul] = answers.slice(i * 3, i * 3 + 3).map((a) => a?.result);
    const mulRaw = hexToBigInt(mul);
    return {
      ...c,
      interface: hexToBigInt(decimals) === 18n && mulRaw !== null && mulRaw > 0n,
      bytecode: typeof code === 'string' ? keccak256Hex(code) === CODE_HASH : null,
      creator: null,
    };
  });

  for (const row of rows.filter((r) => r.interface)) {
    await sleep(gapMs);
    row.creator = await lookupCreator(row.address, { explorer, fetchImpl });
  }

  const tested = rows.filter((r) => r.interface);
  const genuine = tested.filter((r) => r.bytecode === true && r.creator === DEPLOYER);
  const disagreements = tested.filter((r) => (r.bytecode === true) !== (r.creator === DEPLOYER))
    .map(({ address, symbol, bytecode, creator }) => ({ address, symbol, bytecode, creator }));
  const shipped = new Set(STOCK_TOKENS.map((t) => t.address));
  const found = new Set(genuine.map((r) => r.address));
  const symbols = genuine.map((r) => r.symbol);
  return {
    chainId: CHAIN_ID,
    date: new Date().toISOString().slice(0, 10),
    candidates: rows.length,
    passedInterface: tested.length,
    passedBytecode: tested.filter((r) => r.bytecode === true).length,
    passedCreator: tested.filter((r) => r.creator === DEPLOYER).length,
    genuine: genuine.length,
    rejected: rows.length - genuine.length,
    disagreements,
    duplicateSymbols: [...new Set(symbols.filter((s, i) => symbols.indexOf(s) !== i))],
    added: genuine.filter((r) => !shipped.has(r.address)).map((r) => ({ symbol: r.symbol, address: r.address })),
    removed: STOCK_TOKENS.filter((t) => !found.has(t.address)).map((t) => ({ symbol: t.symbol, address: t.address })),
    tokens: genuine
      .map((r) => ({ symbol: r.symbol, address: r.address, underlying: underlyingOf(r.name) }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

export function snapshotText(report) {
  return [
    '{',
    `  "snapshotDate": "${report.date}",`,
    `  "chainId": ${report.chainId},`,
    `  "candidates": ${report.candidates},`,
    `  "genuine": ${report.genuine},`,
    `  "rejected": ${report.rejected},`,
    '  "tokens": [',
    report.tokens.map((t) => `    ${JSON.stringify(t)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

export const USAGE = `usage: node scripts/rebuild-registry.mjs --recheck
       node scripts/rebuild-registry.mjs --rebuild [--out <file>]

  --recheck        re-hash the bytecode of every address in the shipped snapshot (RPC only)
  --rebuild        repeat the whole selection against the chain explorer API (Blockscout v2)
  --out <file>     with --rebuild: write the new snapshot to <file>
  -h, --help       show this help

STV_RPC_URLS (comma-separated) is tried before the built-in public endpoints.
Exit codes: 0 no difference · 1 mismatch, unread bytecode or disagreement · 2 run failed · 64 usage.`;

export class UsageError extends Error {}

/** Arguments → { mode, out } or { help }; anything else is a usage error. Nothing here touches the network. */
export function parseArgs(argv) {
  const seen = { help: false, recheck: false, rebuild: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') seen.help = true;
    else if (arg === '--recheck') seen.recheck = true;
    else if (arg === '--rebuild') seen.rebuild = true;
    else if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('-')) throw new UsageError('--out needs a file name');
      seen.out = value;
      i += 1;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  if (seen.help) return { help: true };
  if (seen.recheck === seen.rebuild) throw new UsageError('choose exactly one of --recheck and --rebuild');
  if (seen.out !== null && !seen.rebuild) throw new UsageError('--out only applies to --rebuild');
  return { mode: seen.rebuild ? 'rebuild' : 'recheck', out: seen.out };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }
  const rpc = createRpc({ urls: rpcUrlsFromEnv() });
  if (args.mode === 'rebuild') {
    const report = await rebuild({ rpc });
    const { tokens, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
    if (args.out) {
      fs.writeFileSync(args.out, snapshotText(report));
      console.log(`wrote ${tokens.length} tokens to ${args.out}`);
    }
    return report.disagreements.length ? 1 : 0;
  }
  const result = await recheck({ rpc });
  console.log(JSON.stringify({ snapshotDate: SNAPSHOT_DATE, ...result }, null, 2));
  return result.mismatched.length || result.unread ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    if (error instanceof UsageError) { console.error(`${error.message}\n${USAGE}`); process.exit(64); }
    console.error(String(error?.message || error));
    process.exit(2);
  });
}
