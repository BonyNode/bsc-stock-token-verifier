// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The snapshot schema `stv-bsc-snapshot/1` (docs/snapshot-schema.md): constants and a validator.
// The scan validates every snapshot before writing it, so a file that does not match the document
// is never produced. Within /1 changes are additive only.

export const SCHEMA_ID = 'stv-bsc-snapshot/1';

export const FAMILY_IDS = Object.freeze(['bstocks', 'ondo', 'xstocks']);
export const ROLES = Object.freeze(['token', 'wrapper']);
export const STATUSES = Object.freeze(['ok', 'partial', 'skipped', 'failed']);
export const SURFACES = Object.freeze(['binance-web3-api', 'binance-public', 'issuer', 'chain']);
export const TOKEN_VERDICTS = Object.freeze(['genuine', 'unknown']);
export const VERDICTS = Object.freeze(['genuine', 'look-alike', 'unknown', 'none']);
export const ASSET_CLASSES = Object.freeze(['stock', 'etf', 'portfolio', 'currency', 'other']);
export const CREATOR_STATUSES = Object.freeze(['ok', 'not_checked', 'no_answer', 'failed']);

export const REASONS = Object.freeze([
  'issuer_list', 'not_in_issuer_list', 'binance_list', 'no_code', 'code_unreadable',
  'code_hash_match', 'code_hash_mismatch', 'proxy_match', 'proxy_mismatch',
  'creator_match', 'creator_mismatch', 'creator_not_checked', 'fingerprint_without_listing',
  'claims_symbol', 'claims_name', 'shares_ticker',
]);

export const NOTICES = Object.freeze({
  affiliation: 'Independent open-source tool. Not affiliated with, endorsed by or connected with Binance, Ondo Finance or Backed (xStocks).',
  advice: 'Information only, not investment advice. Nothing here is an offer or a recommendation to buy or sell anything.',
  referencePrice: 'Binance documents referencePrice as a per-share figure converted from the on-chain token price, not an official quote of the share. It is shown next to the token price, never as the price of the share.',
  lookalikeCounts: 'Counts of unlisted contracts using the same ticker or name are lower bounds: each search returns at most one page, and only the queries listed in the method were run.',
});

// Earlier wordings of a notice that a snapshot written before the change may carry (accepted on read).
export const NOTICE_HISTORY = Object.freeze({
  lookalikeCounts: ['Look-alike counts are lower bounds: each search returns at most one page, and only the queries listed in the method were run.'],
});

export const CLAIMANT_KINDS = Object.freeze(['bridged', 'test', 'other_issuer', 'unidentified']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isAddr = (v) => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v);
const isTs = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v));
const isHash = (v) => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const isInt = (v) => Number.isInteger(v) && v >= 0;
const orNull = (test) => (v) => v === null || test(v);
const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Problems found in a snapshot; an empty list means it matches `stv-bsc-snapshot/1`. */
export function validateSnapshot(snap) {
  const problems = [];
  const need = (ok, where) => { if (!ok) problems.push(where); };
  const section = (s, name) => {
    need(isObj(s), `${name} is an object`);
    if (!isObj(s)) return false;
    need(STATUSES.includes(s.status), `${name}.status is one of ${STATUSES.join('/')}`);
    need(orNull(isTs)(s.fetchedAt ?? null), `${name}.fetchedAt is a timestamp or null`);
    if (s.status === 'skipped') need(isStr(s.reason), `${name}.reason says why it was skipped`);
    if (s.status === 'failed') need(isStr(s.error), `${name}.error says why it failed`);
    need(Array.isArray(s.items), `${name}.items is an array`);
    if (s.status === 'failed' || s.status === 'skipped') need(Array.isArray(s.items) && s.items.length === 0, `${name} has no items when ${s.status}`);
    return Array.isArray(s.items);
  };

  need(isObj(snap), 'the snapshot is an object');
  if (!isObj(snap)) return problems;
  need(snap.schema === SCHEMA_ID, `schema is ${SCHEMA_ID}`);
  need(isTs(snap.generatedAt), 'generatedAt is a timestamp');
  need(isObj(snap.generator) && snap.generator.name === 'stock-token-verifier' && isStr(snap.generator.version), 'generator names the package and version');
  need(isObj(snap.chain) && snap.chain.id === 56 && snap.chain.idHex === '0x38', 'chain is 56 / 0x38');
  need(isObj(snap.chain) && orNull(isInt)(snap.chain.block) && Array.isArray(snap.chain.rpcHosts)
    && snap.chain.rpcHosts.every((h) => isStr(h) && !/[/?#@]/.test(h)), 'chain.block and chain.rpcHosts (host names only)');
  need(isObj(snap.notices) && Object.entries(NOTICES).every(([k, v]) => snap.notices[k] === v || (NOTICE_HISTORY[k] || []).includes(snap.notices[k])), 'notices carry the fixed sentences');

  need(Array.isArray(snap.sources), 'sources is an array');
  for (const [i, s] of (Array.isArray(snap.sources) ? snap.sources : []).entries()) {
    const at = `sources[${i}]`;
    need(isStr(s?.id) && SURFACES.includes(s?.surface) && isStr(s?.url) && STATUSES.includes(s?.status), `${at} has id, surface, url and status`);
    need(orNull(isTs)(s?.fetchedAt ?? null) && isInt(s?.requests), `${at} has fetchedAt and requests`);
    need(!/[?]/.test(String(s?.url)) && !/x-oc-sign|signature=/i.test(JSON.stringify(s)), `${at} carries no query string and no signature`);
  }

  need(isObj(snap.families), 'families is an object');
  for (const id of FAMILY_IDS) {
    const f = snap.families?.[id];
    const at = `families.${id}`;
    need(isObj(f) && f.id === id && isStr(f.label) && isStr(f.wording) && isStr(f.issuerList), `${at} has id, label, wording and issuerList`);
    need(isObj(f?.claimMarkers) && isStr(f.claimMarkers.symbolPattern), `${at}.claimMarkers.symbolPattern`);
    const fp = f?.fingerprint;
    need(isObj(fp) && orNull(isTs)(fp.measuredAt) && isObj(fp.roles), `${at}.fingerprint has measuredAt and roles`);
    for (const [role, rule] of Object.entries(isObj(fp?.roles) ? fp.roles : {})) {
      need(ROLES.includes(role), `${at}.fingerprint.roles.${role} is a known role`);
      need(isObj(rule) && orNull(isHash)(rule.codeHash) && ['beacon', 'transparent', null].includes(rule.proxyKind ?? null)
        && orNull(isAddr)(rule.slotValue ?? null) && isInt(rule.members) && isInt(rule.outliers), `${at}.fingerprint.roles.${role} is a rule`);
    }
  }

  need(Array.isArray(snap.tokens), 'tokens is an array');
  const seen = new Set();
  for (const [i, t] of (Array.isArray(snap.tokens) ? snap.tokens : []).entries()) {
    const at = `tokens[${i}]`;
    need(isAddr(t?.address), `${at}.address`);
    need(!seen.has(`${t?.family}|${t?.address}`), `${at} is not a duplicate`);
    seen.add(`${t?.family}|${t?.address}`);
    need(FAMILY_IDS.includes(t?.family) && ROLES.includes(t?.role), `${at}.family and role`);
    need(orNull(isAddr)(t?.pairAddress ?? null), `${at}.pairAddress`);
    need(orNull(isStr)(t?.symbol ?? null) && orNull(isStr)(t?.name ?? null) && orNull(isInt)(t?.decimals ?? null), `${at} symbol/name/decimals`);
    need(orNull((v) => ASSET_CLASSES.includes(v))(t?.assetClass ?? null), `${at}.assetClass`);
    need(Array.isArray(t?.listedBy) && t.listedBy.length > 0, `${at}.listedBy names at least one source`);
    need(isObj(t?.onchain) && orNull(isInt)(t.onchain.codeSize) && orNull(isHash)(t.onchain.codeHash), `${at}.onchain`);
    need(isObj(t?.creator) && CREATOR_STATUSES.includes(t.creator.status) && orNull(isAddr)(t.creator.address), `${at}.creator`);
    need(isObj(t?.checks) && ['issuerList', 'hasCode', 'codeHash', 'proxy', 'creator'].every((k) => orNull(isBool)(t.checks[k] ?? null)), `${at}.checks`);
    need(TOKEN_VERDICTS.includes(t?.verdict), `${at}.verdict is genuine or unknown`);
    need(Array.isArray(t?.reasons) && t.reasons.length > 0 && t.reasons.every((r) => REASONS.includes(r)), `${at}.reasons are known codes`);
    need(isStr(t?.explanation), `${at}.explanation`);
    if (t?.verdict === 'genuine') {
      need(t.checks?.issuerList === true && t.checks?.codeHash === true && t.checks?.proxy === true && t.checks?.creator !== false, `${at} is genuine only with list, code hash and proxy matching`);
    }
  }

  const lk = snap.lookalikes;
  if (section(lk, 'lookalikes')) {
    need(isInt(lk.queries) && isInt(lk.pageCap) && isInt(lk.fullPages) && isBool(lk.lowerBound), 'lookalikes.queries/pageCap/fullPages/lowerBound');
    need(isObj(lk.counts) && [...FAMILY_IDS, 'total'].every((k) => isInt(lk.counts[k])), 'lookalikes.counts');
    need(Array.isArray(lk.otherIssuerClaims), 'lookalikes.otherIssuerClaims is an array');
    for (const [i, l] of lk.items.entries()) {
      const at = `lookalikes.items[${i}]`;
      need(isAddr(l?.address) && l?.verdict === 'look-alike', `${at} address and verdict`);
      need(isObj(l?.claims) && FAMILY_IDS.includes(l.claims.family) && Array.isArray(l.claims.by) && l.claims.by.length > 0, `${at}.claims`);
      need(Array.isArray(l?.reasons) && l.reasons.every((r) => REASONS.includes(r)), `${at}.reasons`);
      need(l?.claimantKind === undefined || CLAIMANT_KINDS.includes(l.claimantKind), `${at}.claimantKind is one of ${CLAIMANT_KINDS.join('/')}`);
    }
  }

  const mk = snap.market;
  if (section(mk, 'market')) {
    need(Array.isArray(mk.sizesUsd) && mk.sizesUsd.every(isNum), 'market.sizesUsd');
    need(Array.isArray(mk.sessions), 'market.sessions is an array');
    need(orNull(isAddr)(mk.walletPlaceholder ?? null), 'market.walletPlaceholder');
    for (const [i, m] of mk.items.entries()) {
      const at = `market.items[${i}]`;
      need(isAddr(m?.address) && FAMILY_IDS.includes(m?.family), `${at} address and family`);
      need(Array.isArray(m?.quotes) && m.quotes.every((q) => isNum(q?.sizeUsd) && ['ok', 'error'].includes(q?.status) && orNull(isTs)(q?.fetchedAt ?? null)), `${at}.quotes`);
      need(m.quotes.every((q) => q.representative === undefined || q.representative === null || (isBool(q.representative) && (q.representative || isStr(q.notRepresentativeReason)))), `${at}.quotes: representative false comes with a reason`);
    }
  }

  const pr = snap.prices;
  if (section(pr, 'prices')) {
    need(pr.caveat === NOTICES.referencePrice, 'prices.caveat is the referencePrice notice');
    for (const [i, p] of pr.items.entries()) {
      const at = `prices.items[${i}]`;
      need(isAddr(p?.address) && FAMILY_IDS.includes(p?.family) && isStr(p?.label), `${at} address, family and label`);
      need(orNull(isNum)(p?.tokenOverReference ?? null) && orNull(isNum)(p?.tokenOverReferenceVsMultiplierPct ?? null), `${at} computed ratios are numbers or null`);
    }
  }

  const sm = snap.summary;
  need(isObj(sm) && orNull(isTs)(sm.measuredAt) && isBool(sm.keyUsed), 'summary.measuredAt and keyUsed');
  for (const id of FAMILY_IDS) {
    const c = sm?.families?.[id];
    need(isObj(c) && ['listed', 'noCode', 'genuine', 'unknown', 'lookalikes'].every((k) => isInt(c[k])), `summary.families.${id} counts`);
    if (isObj(c) && Array.isArray(snap.tokens)) {
      const mine = snap.tokens.filter((t) => t.family === id);
      need(c.listed === mine.length, `summary.families.${id}.listed equals its token entries`);
      need(c.genuine === mine.filter((t) => t.verdict === 'genuine').length, `summary.families.${id}.genuine equals its genuine entries`);
      need(c.noCode === mine.filter((t) => t.checks?.hasCode === false).length, `summary.families.${id}.noCode equals its entries without code`);
      need(c.genuine + c.unknown + c.noCode === c.listed, `summary.families.${id}: genuine + unknown + noCode = listed`);
    }
  }
  need(isObj(sm?.lookalikes) && isInt(sm.lookalikes.total) && isBool(sm.lookalikes.lowerBound), 'summary.lookalikes');
  return problems;
}
