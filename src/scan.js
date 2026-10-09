// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The full scan: lists → on-chain facts → rules → verdicts → look-alikes → prices → market sample →
// snapshot (docs/snapshot-schema.md). Every upstream is recorded in `sources` with what came back;
// a failing upstream makes its section `failed` or `partial`, never an empty success.
import fs from 'node:fs';
import path from 'node:path';
import { CHAIN_ID, CHAIN_ID_HEX, CHAIN_NAME, hostOf, USDT } from './chain.js';
import { FAMILIES, FAMILY_ORDER, OTHER_ISSUER_MARKER, claimIndex, claimOf } from './families.js';
import { BinanceApiError, W3_ENDPOINTS, W3_ORIGIN, W3_PREFIX, readBasicInfo, readRwaPrice, readRwaTokens, readTokenSearch } from './binance-web3.js';
import { PUBLIC_ENDPOINTS } from './binance-public.js';
import { ONDO_DOCS, XSTOCKS_API, XSTOCKS_PRICE, bareUrl, fetchOndo, fetchXStocks, fetchXStocksQuote } from './issuers.js';
import { openCache, readOnchain } from './onchain.js';
import { deriveRule, listedVerdict } from './verdict.js';
import { NOTICES, SCHEMA_ID, validateSnapshot } from './schema.js';
import { SIZES_USD, WALLET_PLACEHOLDER, pickSample, sampleMarket } from './market.js';

export const VERSION = '0.2.0';
export const PRICE_CHUNK = 50;
const now = () => new Date().toISOString();
const msToIso = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null; };
const scrub = (m) => String(m?.message || m || 'unknown error').replace(/\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#]*@)?([^\s/?#)]+)[^\s)]*/gi, '$1://$2').slice(0, 240);
const PUBLIC_CLASS = { 1: 'stock', 3: 'etf', 4: 'currency' };

/** A JSON-lines file as a Map keyed by `address` (last line wins; a torn line is skipped). */
function readJsonl(file) {
  const out = new Map();
  if (!file || !fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { try { const e = JSON.parse(line); if (e?.address) out.set(e.address, e); } catch { /* torn line */ } }
  return out;
}
function appendJsonl(file, entry) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/** Records every upstream with its outcome; the snapshot's `sources` array is built from it. */
function sourceBook() {
  const book = new Map();
  return {
    set(id, surface, url, patch) {
      const cur = book.get(id) || { id, surface, url: bareUrl(url), status: 'ok', fetchedAt: null, requests: 0, note: null, error: null };
      book.set(id, { ...cur, ...patch, url: bareUrl(url) });
    },
    get: (id) => book.get(id) || null,
    list: () => [...book.values()],
  };
}

const w3Url = (name) => `${W3_ORIGIN}${W3_PREFIX}${W3_ENDPOINTS[name].path}`;

/**
 * @param {object} o
 * @param {object} o.rpc            createRpc()
 * @param {object} o.pub            createBinancePublic()
 * @param {object|null} o.w3        createBinanceWeb3() or null when there is no key
 * @param {string|null} o.w3Reason  why there is no keyed client (no_api_key, key_file_missing, …)
 * @param {string|null} [o.cacheFile]
 * @param {'binance'|'all'|'none'} [o.lookalikeScope]
 * @param {boolean} [o.market]      run the market sample (needs the key)
 * @param {Function} [o.say]        progress lines (stderr)
 * @param {string|null} [o.gitCommit]
 */
export async function runScan({ rpc, pub, w3 = null, w3Reason = 'no_api_key', cacheFile = null, lookalikeScope = 'binance', market = true, say = () => {}, gitCommit = null, fetchImpl = globalThis.fetch }) {
  const src = sourceBook();
  const keyUsed = !!w3;
  const familyNotes = { bstocks: [], ondo: [], xstocks: [] };

  // ── 1. Lists ──────────────────────────────────────────────────────────────────────────────────
  say('lists: xStocks API, Ondo CSV, Binance lists');
  let xs = null;
  try {
    xs = await fetchXStocks({ fetchImpl });
    src.set('xstocks-api', 'issuer', XSTOCKS_API, { fetchedAt: xs.fetchedAt, requests: xs.requests, note: `${xs.pages} pages of up to 100; ${xs.assets.length} assets list a BinanceSmartChain deployment` });
  } catch (error) { src.set('xstocks-api', 'issuer', XSTOCKS_API, { status: 'failed', fetchedAt: now(), error: scrub(error) }); }

  let ondo = null;
  try {
    ondo = await fetchOndo({ fetchImpl });
    src.set('ondo-csv', 'issuer', ondo.url, { fetchedAt: ondo.fetchedAt, requests: ondo.requests, note: `linked from ${ONDO_DOCS}; ${ondo.tokens.length} rows with a BSC address${ondo.note ? `; ${ondo.note}` : ''}` });
  } catch (error) { src.set('ondo-csv', 'issuer', ONDO_DOCS, { status: 'failed', fetchedAt: now(), error: scrub(error) }); }

  let pubList = null;
  try {
    pubList = await pub.stockList();
    const other = Object.entries(pubList.otherTypes).map(([t, n]) => `type ${t}: ${n}`).join(', ');
    src.set('binance-public:stock-list', 'binance-public', PUBLIC_ENDPOINTS.stockList.url, {
      fetchedAt: now(), requests: pub.counts['binance-public:stock-list'] || 1,
      note: `${pubList.totalRows} rows on all chains, ${pubList.chainRows} on chain 56: bStocks (type 3) ${pubList.byFamily.bstocks.length}, Ondo (type 1) ${pubList.byFamily.ondo.length}, xStocks (type 2) ${pubList.byFamily.xstocks.length}${other ? `; not used: ${other}` : ''}`,
    });
  } catch (error) { src.set('binance-public:stock-list', 'binance-public', PUBLIC_ENDPOINTS.stockList.url, { status: 'failed', fetchedAt: now(), requests: 1, error: scrub(error) }); }

  let rwa = null; // { bstock: rows, ondo: rows }
  let platforms = null; // platformId → token count on chain 56, as rwa/platforms states it
  let fatal = null;
  if (w3) {
    try {
      const rows = await w3.request('rwaPlatforms', { query: { binanceChainId: String(CHAIN_ID) } });
      platforms = {};
      for (const p of Array.isArray(rows) ? rows : []) {
        const n = (p?.chainDistribution || []).find((c) => String(c?.binanceChainId) === String(CHAIN_ID))?.tokenCount;
        if (p?.platformId) platforms[p.platformId] = n == null ? null : Number(n);
      }
      src.set('binance-w3:rwa-platforms', 'binance-web3-api', w3Url('rwaPlatforms'), { fetchedAt: now(), requests: w3.counts['binance-w3:rwa-platforms'] || 1, note: `tokens on chain 56 per platform: ${Object.entries(platforms).map(([k, v]) => `${k} ${v}`).join(', ')}` });
    } catch (error) {
      if (error instanceof BinanceApiError && error.fatal) fatal = error;
      src.set('binance-w3:rwa-platforms', 'binance-web3-api', w3Url('rwaPlatforms'), { status: 'failed', fetchedAt: now(), requests: 1, error: scrub(error) });
    }
  }
  if (w3 && !fatal) {
    rwa = {};
    for (const platformId of ['bstock', 'ondo']) {
      try {
        rwa[platformId] = readRwaTokens(await w3.request('rwaTokens', { query: { binanceChainId: String(CHAIN_ID), platformId } }));
      } catch (error) {
        rwa[platformId] = null;
        if (error instanceof BinanceApiError && error.fatal) fatal = error;
        src.set('binance-w3:rwa-tokens', 'binance-web3-api', w3Url('rwaTokens'), { status: 'partial', error: scrub(error) });
        if (fatal) break;
      }
    }
    const got = Object.entries(rwa).filter(([, v]) => v).map(([k, v]) => `${k} ${v.length}`).join(', ');
    const prev = src.get('binance-w3:rwa-tokens');
    src.set('binance-w3:rwa-tokens', 'binance-web3-api', w3Url('rwaTokens'), {
      status: !got ? 'failed' : (prev?.status === 'partial' ? 'partial' : 'ok'), fetchedAt: now(), requests: w3.counts['binance-w3:rwa-tokens'] || 0,
      note: got ? `rows on chain 56: ${got}` : null, error: prev?.error ?? (got ? null : 'no answer'),
    });
  } else {
    src.set('binance-w3:rwa-tokens', 'binance-web3-api', w3Url('rwaTokens'), { status: fatal ? 'failed' : 'skipped', note: fatal ? null : `skipped: ${w3Reason}`, error: fatal ? scrub(fatal) : null });
  }

  // ── 2. Entries per family and address ─────────────────────────────────────────────────────────
  const entries = new Map(); // key family|address
  const key = (f, a) => `${f}|${a}`;
  const add = (family, address, patch, source) => {
    const k = key(family, address);
    const cur = entries.get(k) || { family, address, role: 'token', pairAddress: null, underlyingTicker: null, assetClass: null, listedBy: new Set(), listSymbols: new Set(), status: null, multiplier: null, tokenToShareRatio: null };
    for (const [f, v] of Object.entries(patch)) if (v != null && (cur[f] == null || f === 'role' || f === 'pairAddress')) cur[f] = v;
    cur.listedBy.add(source);
    if (patch.listSymbol) cur.listSymbols.add(patch.listSymbol);
    entries.set(k, cur);
    return cur;
  };

  const xsRole = new Map(); // address → { role, pair, ticker, symbol }
  for (const a of xs?.assets || []) {
    xsRole.set(a.token, { role: 'token', pair: a.wrapper, ticker: a.underlyingTicker, symbol: a.symbol });
    if (a.wrapper) xsRole.set(a.wrapper, { role: 'wrapper', pair: a.token, ticker: a.underlyingTicker, symbol: `w${a.symbol}` });
    add('xstocks', a.token, { role: 'token', pairAddress: a.wrapper, underlyingTicker: a.underlyingTicker, listSymbol: a.symbol }, 'xstocks-api');
    if (a.wrapper) add('xstocks', a.wrapper, { role: 'wrapper', pairAddress: a.token, underlyingTicker: a.underlyingTicker, listSymbol: `w${a.symbol}` }, 'xstocks-api');
  }
  for (const o of ondo?.tokens || []) add('ondo', o.address, { underlyingTicker: o.underlyingTicker && o.underlyingTicker !== '-' ? o.underlyingTicker : null, assetClass: o.assetClass, listSymbol: o.symbol }, 'ondo-csv');
  for (const [family, rows] of Object.entries(pubList?.byFamily || {})) {
    for (const r of rows) {
      const x = family === 'xstocks' ? xsRole.get(r.address) : null;
      add(family, r.address, {
        underlyingTicker: r.underlyingTicker, assetClass: PUBLIC_CLASS[r.assetType] ?? null, multiplier: r.multiplier, listSymbol: r.symbol,
        ...(x ? { role: x.role, pairAddress: x.pair } : {}),
      }, 'binance-public:stock-list');
    }
  }
  for (const [platformId, family] of [['bstock', 'bstocks'], ['ondo', 'ondo']]) {
    for (const r of rwa?.[platformId] || []) {
      add(family, r.address, { underlyingTicker: r.underlyingTicker, tokenToShareRatio: r.tokenToShareRatio, status: r.status, listSymbol: r.symbol }, 'binance-w3:rwa-tokens');
    }
  }
  // Facts about the Binance lists against the issuers' own lists.
  if (pubList && xs) {
    const wrappersListed = pubList.byFamily.xstocks.filter((r) => xsRole.get(r.address)?.role === 'wrapper');
    if (wrappersListed.length) familyNotes.xstocks.push(`Binance lists ${wrappersListed.length} xStocks entries by their ERC-4626 v2 wrapper instead of the token: ${wrappersListed.map((r) => `${r.symbol} ${r.address}`).join(', ')}`);
    const unknownToIssuer = pubList.byFamily.xstocks.filter((r) => !xsRole.has(r.address));
    if (unknownToIssuer.length) familyNotes.xstocks.push(`${unknownToIssuer.length} xStocks addresses in the Binance list are not in the issuer API`);
  }
  // bStocks have no issuer registry of their own; membership is a Binance list. Measured 2026-10-09:
  // the keyed rwa/tokens answered 46 bStocks rows (tabId and paging parameters changed nothing) while
  // rwa/platforms counts 91 on chain 56 and the keyless list has 91. The complete list is used, the
  // other is a cross-check, and the counts are stated in the family notes.
  const bstocksList = pubList?.byFamily?.bstocks?.length ? 'binance-public:stock-list' : (rwa?.bstock ? 'binance-w3:rwa-tokens' : 'binance-public:stock-list');
  const issuerListOf = { bstocks: bstocksList, ondo: 'ondo-csv', xstocks: 'xstocks-api' };
  familyNotes.bstocks.push(`No separate issuer registry was found for bStocks; membership is the Binance list ${bstocksList}`);
  for (const [platformId, family, label] of [['bstock', 'bstocks', 'bStocks'], ['ondo', 'ondo', 'Ondo']]) {
    const parts = [];
    if (platforms && platforms[platformId] != null) parts.push(`binance-w3:rwa-platforms counts ${platforms[platformId]} on chain 56`);
    if (rwa?.[platformId]) parts.push(`binance-w3:rwa-tokens answered ${rwa[platformId].length} rows`);
    if (pubList) parts.push(`binance-public:stock-list has ${pubList.byFamily[family].length}`);
    if (family === 'ondo' && ondo) parts.push(`the Ondo CSV has ${ondo.tokens.length}`);
    if (parts.length > 1) familyNotes[family].push(`${label} list sizes: ${parts.join('; ')}`);
  }

  // ── 3. On-chain facts ─────────────────────────────────────────────────────────────────────────
  const addresses = [...new Set([...entries.values()].map((e) => e.address))];
  say(`on-chain: ${addresses.length} addresses`);
  let chainFacts;
  let chainBlock = null;
  const rpcBefore = rpc.requests;
  try {
    const r = await readOnchain(addresses, { rpc, cache: openCache(cacheFile), onProgress: (phase, done, total) => { if (done === total || done % 400 < rpc.batchMax) say(`  ${phase} ${done}/${total}`); } });
    chainFacts = r.facts;
    chainBlock = r.block;
    src.set('bsc-rpc', 'chain', `https://${rpc.answeredHost || hostOf(rpc.urls[0])}`, { fetchedAt: now(), requests: rpc.requests - rpcBefore, note: `${addresses.length} addresses (${r.fromCache} from a cache younger than 12 h); eth_getCode, EIP-1967 slots, name/symbol/decimals at the latest block; block ${r.block} at the start` });
  } catch (error) {
    chainFacts = new Map();
    src.set('bsc-rpc', 'chain', rpc.urls[0], { status: 'failed', fetchedAt: now(), requests: rpc.requests - rpcBefore, error: scrub(error) });
  }
  const measuredAt = now();

  // ── 4. Rules per family and role ──────────────────────────────────────────────────────────────
  const inIssuerList = (e) => e.listedBy.has(issuerListOf[e.family]);
  const rules = {};
  for (const family of FAMILY_ORDER) {
    rules[family] = {};
    for (const role of family === 'xstocks' ? ['token', 'wrapper'] : ['token']) {
      const members = [...entries.values()].filter((e) => e.family === family && e.role === role && inIssuerList(e)).map((e) => chainFacts.get(e.address)).filter(Boolean);
      rules[family][role] = deriveRule(members);
    }
  }

  // ── 5. Creators (keyed basic-info) ────────────────────────────────────────────────────────────
  // basic-info takes ONE address per request, so the creator is read for every bStocks and Ondo
  // contract and, for xStocks, for the contracts Binance lists and their pairs (2 544 xStocks
  // contracts would be 2 544 more requests). The others carry creator_not_checked.
  const creators = new Map();
  let creatorStatus = w3 ? 'ok' : 'skipped';
  let creatorErrors = 0;
  let creatorTargets = [];
  let creatorsFromCache = 0;
  const creatorCacheFile = cacheFile ? cacheFile.replace(/[^/]*$/, 'creators.jsonl') : null;
  if (w3 && !fatal) {
    const pairsOfBinanceXs = new Set();
    for (const e of entries.values()) if (e.family === 'xstocks' && [...e.listedBy].some((x) => x.startsWith('binance'))) { pairsOfBinanceXs.add(e.address); if (e.pairAddress) pairsOfBinanceXs.add(e.pairAddress); }
    creatorTargets = [...new Set([...entries.values()]
      .filter((e) => (e.family !== 'xstocks' || pairsOfBinanceXs.has(e.address)) && chainFacts.get(e.address)?.codeSize > 0)
      .map((e) => e.address))];
    // A creator never changes: answers are kept in a cache file and not asked again.
    const known = readJsonl(creatorCacheFile);
    for (const a of creatorTargets) { const hit = known.get(a); if (hit?.creator) creators.set(a, hit); }
    creatorsFromCache = creators.size;
    const ask = creatorTargets.filter((a) => !creators.has(a));
    say(`creators: ${ask.length} basic-info requests (${creatorsFromCache} known from the cache)`);
    for (const [i, a] of ask.entries()) {
      try {
        for (const row of readBasicInfo(await w3.request('basicInfo', { query: { binanceChainId: String(CHAIN_ID), tokenContractAddress: a }, body: {} }))) {
          const entry = { ...row, fetchedAt: now() };
          creators.set(row.address, entry);
          if (entry.creator) appendJsonl(creatorCacheFile, entry);
        }
      } catch (error) {
        creatorErrors += 1;
        src.set('binance-w3:basic-info', 'binance-web3-api', w3Url('basicInfo'), { error: scrub(error) });
        if (error instanceof BinanceApiError && error.fatal) { fatal = error; break; }
        if (error instanceof BinanceApiError && error.kind === 'schema') break;
      }
      if ((i + 1) % 200 === 0) say(`  ${i + 1}/${ask.length}`);
    }
    creatorStatus = creators.size === 0 ? 'failed' : (creatorErrors ? 'partial' : 'ok');
  }
  const creatorTargetSet = new Set(creatorTargets);
  src.set('binance-w3:basic-info', 'binance-web3-api', w3Url('basicInfo'), w3
    ? { status: creatorStatus, fetchedAt: now(), requests: w3.counts['binance-w3:basic-info'] || 0, note: `one address per request; creators known for ${creators.size} of ${creatorTargets.length} contracts (every bStocks and Ondo contract, xStocks contracts listed by Binance and their pairs); ${creatorsFromCache} from an earlier answer kept in the cache` }
    : { status: 'skipped', note: `skipped: ${w3Reason}` });
  // The creators of a family: every address that created an issuer-listed contract fitting the
  // family rule (Ondo uses several deployers). A creator outside that set is a mismatch.
  const familyCreators = {};
  for (const family of FAMILY_ORDER) {
    const counts = new Map();
    for (const e of entries.values()) {
      if (e.family !== family || !inIssuerList(e)) continue;
      const c = creators.get(e.address)?.creator;
      const rule = rules[family][e.role];
      const f = chainFacts.get(e.address);
      if (c && f && f.codeHash === rule.codeHash && f[rule.slot] === rule.slotValue) counts.set(c, (counts.get(c) || 0) + 1);
    }
    familyCreators[family] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([address, members]) => ({ address, members }));
  }

  // ── 6. Verdicts ───────────────────────────────────────────────────────────────────────────────
  const tokens = [];
  for (const e of entries.values()) {
    const f = chainFacts.get(e.address) || null;
    const c = creators.get(e.address);
    const creatorChecked = !!(c && c.creator);
    const v = listedVerdict({
      inIssuerList: inIssuerList(e),
      listedByBinance: [...e.listedBy].some((s) => s.startsWith('binance')),
      facts: f, rule: rules[e.family][e.role],
      creator: c?.creator ?? null, familyCreators: familyCreators[e.family].map((x) => x.address), creatorChecked: creatorChecked && familyCreators[e.family].length > 0,
    });
    tokens.push({
      address: e.address, family: e.family, role: e.role, pairAddress: e.pairAddress,
      symbol: f?.symbol ?? null, name: f?.name ?? null, decimals: f?.decimals ?? null,
      underlyingTicker: e.underlyingTicker, assetClass: e.assetClass,
      listedBy: [...e.listedBy].sort(),
      onchain: { readAt: f?.readAt ?? null, block: f?.block ?? null, codeSize: f?.codeSize ?? null, codeHash: f?.codeHash ?? null, beacon: f?.beacon ?? null, implementation: f?.implementation ?? null, admin: f?.admin ?? null },
      creator: w3 && creatorTargetSet.has(e.address)
        ? { status: c ? (c.creator ? 'ok' : 'no_answer') : (creatorStatus === 'failed' ? 'failed' : 'no_answer'), address: c?.creator ?? null, source: 'binance-w3:basic-info', fetchedAt: c?.fetchedAt ?? null }
        : { status: 'not_checked', address: null, source: 'binance-w3:basic-info', fetchedAt: null },
      checks: v.checks, verdict: v.verdict, reasons: v.reasons, explanation: v.explanation,
      _status: e.status, _multiplier: e.multiplier, _ratio: e.tokenToShareRatio,
    });
  }
  const famRank = Object.fromEntries(FAMILY_ORDER.map((f, i) => [f, i]));
  tokens.sort((a, b) => famRank[a.family] - famRank[b.family] || String(a.underlyingTicker ?? a.symbol ?? '').localeCompare(String(b.underlyingTicker ?? b.symbol ?? '')) || a.role.localeCompare(b.role) || a.address.localeCompare(b.address));
  for (const family of FAMILY_ORDER) {
    const outs = tokens.filter((t) => t.family === family && t.checks.hasCode && t.checks.issuerList && t.verdict === 'unknown');
    if (outs.length) {
      const groups = new Map();
      for (const t of outs) { const k = `${t.onchain.codeHash}|${t.onchain.beacon ?? t.onchain.admin ?? '-'}`; groups.set(k, [...(groups.get(k) || []), t]); }
      for (const [k, ts] of groups) {
        const [hash, slot] = k.split('|');
        familyNotes[family].push(`${ts.length} issuer-listed contract(s) outside the rule share code ${hash.slice(0, 10)}… and beacon/admin ${slot}: ${ts.slice(0, 8).map((t) => t.symbol).join(', ')}${ts.length > 8 ? ', …' : ''} (asset class: ${[...new Set(ts.map((t) => t.assetClass ?? 'not stated'))].join('/')})`);
      }
    }
  }

  // ── 7. Look-alikes ────────────────────────────────────────────────────────────────────────────
  const genuine = tokens.filter((t) => t.verdict === 'genuine');
  const index = claimIndex(genuine);
  const genuineSet = new Set(tokens.map((t) => t.address));
  const lookalikes = await scanLookalikes({ scope: lookalikeScope, tokens, genuine, genuineSet, index, w3: fatal ? null : w3, pub, rpc, cacheFile, src, say });

  // ── 8. Prices ─────────────────────────────────────────────────────────────────────────────────
  const sample = pickSample(tokens);
  const prices = await scanPrices({ w3: fatal ? null : w3, w3Reason: fatal ? `stopped: ${fatal.kind}` : w3Reason, genuine, sample, src, fetchImpl, say });

  // ── 9. Market sample ──────────────────────────────────────────────────────────────────────────
  const marketSection = await scanMarket({ w3: fatal ? null : w3, w3Reason: fatal ? `stopped: ${fatal.kind}` : w3Reason, enabled: market, sample, pub, src, say });

  // ── 10. Families, summary, snapshot ───────────────────────────────────────────────────────────
  const families = {};
  for (const family of FAMILY_ORDER) {
    const def = FAMILIES[family];
    const roles = {};
    for (const [role, r] of Object.entries(rules[family])) {
      roles[role] = { codeHash: r.codeHash, codeSize: r.codeSize, proxyKind: r.proxyKind, slot: r.slot, slotValue: r.slotValue, members: r.members, implementations: r.implementations, outliers: r.outliers, clusters: r.clusters, majority: r.majority };
    }
    families[family] = {
      id: family, label: def.label, wording: def.wording, issuerList: issuerListOf[family],
      crossChecks: [...new Set(tokens.filter((t) => t.family === family).flatMap((t) => t.listedBy))].filter((s) => s !== issuerListOf[family]).sort(),
      claimMarkers: def.claimMarkers,
      fingerprint: {
        measuredAt, block: chainBlock, source: 'bsc-rpc',
        method: 'rule derived from the issuer-listed contracts of each role on chain 56: the most common keccak256 of the runtime code, then the beacon (beacon proxies) or admin (transparent proxies) EIP-1967 slot shared by more than half of them; the implementation slot is reported, not required',
        roles,
        creators: familyCreators[family],
      },
      notes: familyNotes[family],
    };
  }
  const counts = (family) => {
    const mine = tokens.filter((t) => t.family === family);
    const c = (ts) => ({ listed: ts.length, noCode: ts.filter((t) => t.checks.hasCode === false).length, genuine: ts.filter((t) => t.verdict === 'genuine').length, unknown: ts.filter((t) => t.verdict === 'unknown' && t.checks.hasCode !== false).length });
    const byClass = {};
    for (const t of mine) { const k = t.assetClass ?? 'not_stated'; byClass[k] = byClass[k] || { listed: 0, genuine: 0 }; byClass[k].listed += 1; if (t.verdict === 'genuine') byClass[k].genuine += 1; }
    return {
      ...c(mine), lookalikes: lookalikes.counts[family],
      byRole: family === 'xstocks' ? { token: c(mine.filter((t) => t.role === 'token')), wrapper: c(mine.filter((t) => t.role === 'wrapper')) } : null,
      byAssetClass: byClass,
    };
  };
  for (const t of tokens) { delete t._status; delete t._multiplier; delete t._ratio; }

  const snapshot = {
    schema: SCHEMA_ID,
    generatedAt: now(),
    generator: { name: 'stock-token-verifier', version: VERSION, gitCommit },
    chain: { id: CHAIN_ID, idHex: CHAIN_ID_HEX, name: CHAIN_NAME, block: chainBlock, rpcHosts: [...new Set([rpc.answeredHost].filter(Boolean))] },
    notices: { ...NOTICES },
    sources: src.list(),
    families,
    tokens,
    lookalikes,
    market: marketSection,
    prices,
    summary: {
      measuredAt, keyUsed,
      families: Object.fromEntries(FAMILY_ORDER.map((f) => [f, counts(f)])),
      lookalikes: { total: lookalikes.counts.total, lowerBound: lookalikes.lowerBound },
    },
  };
  addQuoteCosts(snapshot);
  const problems = validateSnapshot(snapshot);
  if (problems.length) throw new Error(`the snapshot does not match ${SCHEMA_ID}: ${problems.slice(0, 5).join('; ')}`);
  return { snapshot, fatal };
}

/**
 * What each successful quote costs against the token price of the same run (rwa/price for bStocks
 * and Ondo): vsTokenPricePct = (effective price ÷ token price − 1) × 100. Computed here because the
 * quote's own priceImpactPercent was measured to be a fraction, not a percent (an impact of
 * 0.9996 came with an effective price 2.9 million times the token price), so it is kept as
 * returned and not used for this figure. Pure: reads and writes the snapshot object only.
 */
export function addQuoteCosts(snapshot) {
  const px = new Map((snapshot.prices?.items || []).filter((p) => p.source === 'binance-w3:rwa-price' && Number(p.tokenPrice) > 0).map((p) => [p.address, Number(p.tokenPrice)]));
  for (const it of snapshot.market?.items || []) {
    const ref = px.get(it.address) ?? null;
    for (const q of it.quotes || []) q.vsTokenPricePct = q.status === 'ok' && q.effectivePriceUsd && ref ? (q.effectivePriceUsd / ref - 1) * 100 : null;
  }
  return snapshot;
}

// ── Look-alike scan ─────────────────────────────────────────────────────────────────────────────

/** The search terms: one per underlying ticker (Binance-listed, or all), plus the family words. */
export function lookalikeQueries(tokens, scope) {
  if (scope === 'none') return [];
  const pool = scope === 'all' ? tokens : tokens.filter((t) => t.listedBy.some((s) => s.startsWith('binance')));
  const tickers = [...new Set(pool.map((t) => t.underlyingTicker).filter((t) => t && /^[A-Za-z0-9.\-]{1,12}$/.test(t)).map((t) => t.toUpperCase()))].sort();
  return [...tickers, 'xStock', 'Ondo Tokenized', 'bStocks'];
}

async function scanLookalikes({ scope, tokens, genuineSet, index, w3, pub, rpc, cacheFile, src, say }) {
  const sourceId = w3 ? 'binance-w3:token-search' : 'binance-public:token-search';
  const base = { source: sourceId, pageCap: 50, method: '', queries: 0, fullPages: 0, lowerBound: true, counts: { bstocks: 0, ondo: 0, xstocks: 0, total: 0 }, items: [], otherIssuerClaims: [] };
  if (scope === 'none') {
    src.set(sourceId, w3 ? 'binance-web3-api' : 'binance-public', w3 ? w3Url('tokenSearch') : PUBLIC_ENDPOINTS.tokenSearch.url, { status: 'skipped', note: 'skipped: disabled' });
    return { ...base, status: 'skipped', reason: 'disabled', error: null, fetchedAt: null, method: 'not run' };
  }
  const queries = lookalikeQueries(tokens, scope);
  // The keyed search is preferred; if its first answer cannot be read (or the key is refused), the
  // run switches to the keyless search and says so — the source id of the section follows the switch.
  let keyed = !!w3;
  let switched = null;
  const searchOnce = async (q) => (keyed ? readTokenSearch(await w3.request('tokenSearch', { query: { chains: String(CHAIN_ID), search: q } })) : pub.tokenSearch(q));
  const seen = new Map(); // address → { row, query }
  const errors = [];
  let fullPages = 0;
  const pageCap = 50;
  let ran = 0;
  const genuineSymbolsLower = new Set([...index.bySymbol.keys()].map((k) => k.toLowerCase()));
  const run = async (q) => {
    ran += 1;
    try {
      const rows = await searchOnce(q);
      if (rows.length >= pageCap) fullPages += 1;
      for (const r of rows) if (!seen.has(r.address)) seen.set(r.address, { row: r, query: q });
      return rows;
    } catch (error) {
      if (keyed && ran === 1) {
        switched = `keyed search unusable (${scrub(error).slice(0, 140)}); switched to the keyless search`;
        src.set('binance-w3:token-search', 'binance-web3-api', w3Url('tokenSearch'), { status: 'failed', fetchedAt: now(), requests: 1, error: scrub(error) });
        keyed = false;
        ran = 0;
        return run(q);
      }
      errors.push(`${q}: ${scrub(error).slice(0, 120)}`);
      return null;
    }
  };
  say(`look-alikes: ${queries.length} searches on ${sourceId}`);
  for (const [i, q] of queries.entries()) {
    const rows = await run(q);
    // A full page may hide more: search the family symbols of this ticker as well.
    if (rows && rows.length >= pageCap && /^[A-Z0-9.\-]+$/.test(q)) {
      for (const variant of [`${q}x`, `${q}B`, `${q}on`]) if (index.bySymbol.has(variant)) await run(variant);
    }
    if ((i + 1) % 100 === 0) say(`  searched ${i + 1}/${queries.length}`);
  }
  // Candidates: not on any list, and the search row looks like a claim (symbol of a genuine family
  // contract, or a family marker in the name). The claim itself is then read from the contract.
  const looksLikeClaim = (r) => (r.symbol && genuineSymbolsLower.has(r.symbol.trim().toLowerCase()))
    || /xstock|ondo|bstock/i.test(r.name || '') || (r.name && OTHER_ISSUER_MARKER.test(r.name));
  const candidates = [...seen.values()].filter(({ row }) => !genuineSet.has(row.address) && looksLikeClaim(row));
  say(`look-alikes: ${seen.size} distinct contracts in the results, ${candidates.length} candidates to read on chain`);
  let facts = new Map();
  if (candidates.length) {
    try { facts = (await readOnchain(candidates.map((c) => c.row.address), { rpc, cache: openCache(cacheFile) })).facts; } catch (error) { errors.push(`on-chain read of candidates: ${scrub(error).slice(0, 120)}`); }
  }
  const items = [];
  const otherIssuerClaims = [];
  for (const { row, query } of candidates) {
    const f = facts.get(row.address);
    const claimant = { symbol: f?.symbol ?? null, name: f?.name ?? null };
    const claim = f && !f.unread ? claimOf(claimant, index) : null;
    if (!claim) {
      if (f && !f.unread && OTHER_ISSUER_MARKER.test(claimant.name || '')) otherIssuerClaims.push({ address: row.address, symbol: claimant.symbol, name: claimant.name, query });
      continue;
    }
    const reasons = ['not_in_issuer_list'];
    if (claim.by.includes('symbol')) reasons.push('claims_symbol');
    if (claim.by.includes('name')) reasons.push('claims_name');
    items.push({
      address: row.address, symbol: claimant.symbol, name: claimant.name, claims: claim,
      onchain: { readAt: f.readAt, codeSize: f.codeSize, codeHash: f.codeHash },
      search: { query, liquidityUsd: row.liquidityUsd ?? null, holders: row.holders ?? null, launchPlatform: row.launchPlatform ?? null, isRecognized: row.isRecognized ?? null },
      verdict: 'look-alike', reasons,
    });
  }
  items.sort((a, b) => a.claims.family.localeCompare(b.claims.family) || String(a.claims.genuineSymbol ?? a.symbol).localeCompare(String(b.claims.genuineSymbol ?? b.symbol)) || a.address.localeCompare(b.address));
  const counts = { bstocks: 0, ondo: 0, xstocks: 0, total: items.length };
  for (const it of items) counts[it.claims.family] += 1;
  const fetchedAt = now();
  const status = errors.length ? (ran > errors.length ? 'partial' : 'failed') : 'ok';
  const usedId = keyed ? 'binance-w3:token-search' : 'binance-public:token-search';
  src.set(usedId, keyed ? 'binance-web3-api' : 'binance-public', keyed ? w3Url('tokenSearch') : PUBLIC_ENDPOINTS.tokenSearch.url, {
    status, fetchedAt, requests: ran, note: `${ran} searches on chain 56, ${fullPages} came back full (${pageCap} rows)${switched ? `; ${switched}` : ''}`, error: errors[0] ?? null,
  });
  if (status === 'failed') return { ...base, source: usedId, status, reason: null, error: errors[0], fetchedAt, queries: ran, method: 'search failed' };
  return {
    ...base, source: usedId, status, reason: null, error: errors[0] ?? null, errors, fetchedAt, queries: ran, fullPages, lowerBound: true,
    method: `one search on chain 56 per underlying ticker of the ${scope === 'all' ? 'family' : 'Binance-listed'} contracts, plus "xStock", "Ondo Tokenized" and "bStocks"; when a page came back full, also the family symbols of that ticker. A result is a look-alike when it is on no list and either its own name() carries the family marker ("xStock", "(Ondo Tokenized)"), or its own symbol() is exactly the symbol of a genuine family contract (case included) and its name repeats that symbol or shares a distinctive word with the genuine name`,
    counts, items, otherIssuerClaims,
  };
}

// ── Prices ──────────────────────────────────────────────────────────────────────────────────────

async function scanPrices({ w3, w3Reason, genuine, sample, src, fetchImpl, say }) {
  const caveat = NOTICES.referencePrice;
  if (!w3) {
    src.set('binance-w3:rwa-price', 'binance-web3-api', w3Url('rwaPrice'), { status: 'skipped', note: `skipped: ${w3Reason}` });
    return { status: 'skipped', reason: w3Reason, error: null, fetchedAt: null, sources: [], caveat, items: [] };
  }
  say('prices: rwa/price for bStocks and Ondo, issuer quotes for sampled xStocks');
  const items = [];
  const errors = [];
  const targets = genuine.filter((t) => t.family !== 'xstocks');
  const byAddr = new Map(targets.map((t) => [t.address, t]));
  // Measured 2026-10-09: 100 addresses in the query (the documented maximum) answer HTTP 414 URI Too
  // Long; 65 passed. Chunks of 50 stay clear of it.
  for (let i = 0; i < targets.length; i += PRICE_CHUNK) {
    const chunk = targets.slice(i, i + PRICE_CHUNK);
    try {
      const rows = readRwaPrice(await w3.request('rwaPrice', { query: { binanceChainId: String(CHAIN_ID), tokenContractAddresses: chunk.map((t) => t.address).join(',') } }));
      const at = now();
      for (const r of rows) {
        const t = byAddr.get(r.address);
        if (!t) continue;
        const tp = Number(r.tokenPrice);
        const rp = Number(r.referencePrice);
        const ratio = Number.isFinite(tp) && Number.isFinite(rp) && rp > 0 ? tp / rp : null;
        const mult = Number(t._ratio ?? t._multiplier);
        items.push({
          address: t.address, family: t.family, symbol: t.symbol, source: 'binance-w3:rwa-price', fetchedAt: at,
          tokenPrice: r.tokenPrice, referencePrice: r.referencePrice, tokenPriceUpdatedAt: msToIso(r.tokenPriceUpdatedAt) ?? (typeof r.tokenPriceUpdatedAt === 'string' && !Number.isNaN(Date.parse(r.tokenPriceUpdatedAt)) ? new Date(r.tokenPriceUpdatedAt).toISOString() : null),
          multiplier: t._multiplier ?? null, tokenToShareRatio: t._ratio ?? null,
          tokenOverReference: ratio, tokenOverReferenceVsMultiplierPct: ratio !== null && Number.isFinite(mult) && mult > 0 ? (ratio / mult - 1) * 100 : null,
          label: 'on-chain token price vs Binance reference price',
        });
      }
    } catch (error) {
      errors.push(scrub(error));
      if (error instanceof BinanceApiError && (error.fatal || error.kind === 'schema')) break;
    }
  }
  src.set('binance-w3:rwa-price', 'binance-web3-api', w3Url('rwaPrice'), { status: errors.length ? (items.length ? 'partial' : 'failed') : 'ok', fetchedAt: now(), requests: w3.counts['binance-w3:rwa-price'] || 0, note: `${items.length} prices for ${targets.length} genuine bStocks and Ondo contracts`, error: errors[0] ?? null });
  let xsReq = 0;
  const xsErrors = [];
  for (const t of sample.filter((s) => s.family === 'xstocks' && s.role === 'token')) {
    xsReq += 1;
    try {
      const listSymbol = t.symbol;
      const q = await fetchXStocksQuote(listSymbol, { fetchImpl });
      items.push({ address: t.address, family: 'xstocks', symbol: t.symbol, source: 'xstocks-price', fetchedAt: q.fetchedAt, tokenPrice: String(q.quote), referencePrice: null, tokenPriceUpdatedAt: null, multiplier: null, tokenToShareRatio: null, tokenOverReference: null, tokenOverReferenceVsMultiplierPct: null, label: 'xStocks token quote (issuer API, no timestamp)' });
    } catch (error) { xsErrors.push(scrub(error)); }
    await new Promise((r) => { setTimeout(r, 300); });
  }
  src.set('xstocks-price', 'issuer', XSTOCKS_PRICE, { status: xsErrors.length ? (xsReq > xsErrors.length ? 'partial' : 'failed') : 'ok', fetchedAt: now(), requests: xsReq, note: 'token quote per symbol; the answer carries no timestamp', error: xsErrors[0] ?? null });
  const allErrors = [...errors, ...xsErrors];
  const status = allErrors.length ? (items.length ? 'partial' : 'failed') : 'ok';
  return { status, reason: null, error: allErrors[0] ?? null, errors: allErrors, fetchedAt: now(), sources: ['binance-w3:rwa-price', 'xstocks-price'], caveat, items: status === 'failed' ? [] : items };
}

// ── Market sample ───────────────────────────────────────────────────────────────────────────────

async function scanMarket({ w3, w3Reason, enabled, sample, pub, src, say }) {
  const sessions = [];
  try {
    const s = await pub.marketStatus();
    sessions.push({ family: 'ondo', source: 'binance-public:market-status', fetchedAt: now(), openState: s.openState, marketStatus: s.marketStatus ?? null, reasonCode: s.reasonCode ?? null, nextOpenAt: msToIso(s.nextOpenTime), nextCloseAt: msToIso(s.nextCloseTime), offhours: s.offhours ? { openState: s.offhours.openState ?? null, nextOpenAt: msToIso(s.offhours.nextOpenTime), nextCloseAt: msToIso(s.offhours.nextCloseTime) } : null });
    src.set('binance-public:market-status', 'binance-public', PUBLIC_ENDPOINTS.marketStatus.url, { fetchedAt: now(), requests: pub.counts['binance-public:market-status'] || 1, note: 'RWA market session (documented for Ondo)' });
  } catch (error) { src.set('binance-public:market-status', 'binance-public', PUBLIC_ENDPOINTS.marketStatus.url, { status: 'failed', fetchedAt: now(), requests: 1, error: scrub(error) }); }
  const base = { sizesUsd: [...SIZES_USD], quoteToken: { ...USDT }, walletPlaceholder: w3 && enabled ? WALLET_PLACEHOLDER : null, sessions };
  const skip = (reason) => {
    for (const [id, name] of [['binance-w3:top-liquidity', 'topLiquidity'], ['binance-w3:quote', 'quote']]) src.set(id, 'binance-web3-api', w3Url(name), { status: 'skipped', note: `skipped: ${reason}` });
    return { ...base, status: 'skipped', reason, error: null, fetchedAt: null, sources: [], method: 'not run', items: [] };
  };
  if (!enabled) return skip('disabled');
  if (!w3) return skip(w3Reason);
  say(`market: ${sample.length} sampled contracts × (top-liquidity + ${SIZES_USD.length} quotes)`);
  const targets = sample.map((t) => ({ address: t.address, family: t.family, role: t.role, symbol: t.symbol, underlyingTicker: t.underlyingTicker, decimals: t.decimals, status: t._status ? { source: 'binance-w3:rwa-tokens', fetchedAt: src.get('binance-w3:rwa-tokens')?.fetchedAt ?? null, openState: t._status.openState, marketStatus: t._status.marketStatus, reasonCode: t._status.reasonCode, nextOpenAt: msToIso(t._status.nextOpenTime), nextCloseAt: msToIso(t._status.nextCloseTime) } : null }));
  const r = await sampleMarket({ w3, targets, onProgress: (n, total) => { if (n % 10 === 0 || n === total) say(`  ${n}/${total}`); } });
  const fetchedAt = now();
  for (const [id, name] of [['binance-w3:top-liquidity', 'topLiquidity'], ['binance-w3:quote', 'quote']]) {
    src.set(id, 'binance-web3-api', w3Url(name), { status: r.fatal ? 'failed' : (r.errors.length ? 'partial' : 'ok'), fetchedAt, requests: w3.counts[id] || 0, error: r.fatal ? scrub(r.fatal) : (r.errors[0] ?? null), note: id === 'binance-w3:quote' ? `USDT -> token at ${SIZES_USD.join(' / ')} USD; RFQ refusals are recorded per quote` : null });
  }
  if (r.fatal) return { ...base, status: 'failed', reason: null, error: scrub(r.fatal), fetchedAt, sources: ['binance-w3:top-liquidity', 'binance-w3:quote'], method: 'stopped', items: [] };
  return {
    ...base, status: r.errors.length ? 'partial' : 'ok', reason: null, error: r.errors[0] ?? null, errors: r.errors, fetchedAt,
    sources: ['binance-w3:top-liquidity', 'binance-w3:quote', 'binance-w3:rwa-tokens', 'binance-public:market-status'],
    method: `genuine contracts whose underlying ticker is one of the sample tickers, in every family (xStocks: token and v2 wrapper); per contract the deepest pools and one quote ${USDT.symbol} -> token per size`,
    items: r.items,
  };
}
