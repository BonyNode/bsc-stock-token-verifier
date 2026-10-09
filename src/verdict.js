// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// The authenticity rule and the verdicts. PURE: inputs are facts already read (src/onchain.js) and
// lists already fetched; outputs are verdicts with the reason codes they were derived from.
//
// The rule of a family, per role (xStocks have two roles: the token and its ERC-4626 v2 wrapper):
//   code hash  — keccak256 of the runtime code shared by the issuer-listed contracts;
//   proxy slot — the EIP-1967 beacon (beacon proxies) or admin (transparent proxies) they share.
// Proxy runtime code is generic — anyone can deploy the same bytes — so the hash alone is not a
// fingerprint; the slot names the issuer's beacon or admin. The implementation slot is reported but
// is NOT part of the rule: an issuer may upgrade its tokens one at a time.
//
// Rules are DERIVED from the issuer-listed contracts on chain (the dominant code hash, then the
// dominant beacon/admin inside it), never typed in. A listed contract that does not fit the rule is
// an outlier: it is reported as `unknown`, not forced into either side.
//
// Verdicts: genuine | look-alike | unknown | none (none only for a single-address check).
import { claimOf, sharedTicker } from './families.js';

const countBy = (items, key) => {
  const m = new Map();
  for (const it of items) { const k = key(it); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

/**
 * The rule for one family role from the facts of its issuer-listed contracts that have code.
 * @param {object[]} members facts { address, codeHash, codeSize, beacon, admin, implementation }
 */
export function deriveRule(members) {
  const withCode = members.filter((m) => m && m.codeSize > 0 && m.codeHash);
  if (!withCode.length) return { codeHash: null, codeSize: null, proxyKind: null, slot: null, slotValue: null, members: 0, implementations: [], outliers: 0, clusters: [], majority: false };
  const hashes = countBy(withCode, (m) => m.codeHash);
  const [codeHash, inHash] = hashes[0];
  const cluster = withCode.filter((m) => m.codeHash === codeHash);
  const beacons = countBy(cluster, (m) => m.beacon);
  const admins = countBy(cluster, (m) => m.admin);
  let slot = null;
  let slotValue = null;
  if (beacons.length && beacons[0][1] * 2 > cluster.length) [slot, slotValue] = ['beacon', beacons[0][0]];
  else if (admins.length && admins[0][1] * 2 > cluster.length) [slot, slotValue] = ['admin', admins[0][0]];
  const fits = (m) => m.codeHash === codeHash && slot !== null && m[slot] === slotValue;
  const matching = withCode.filter(fits).length;
  return {
    codeHash,
    codeSize: cluster[0].codeSize,
    proxyKind: slot === 'beacon' ? 'beacon' : slot === 'admin' ? 'transparent' : null,
    slot,
    slotValue,
    members: matching,
    implementations: countBy(cluster, (m) => m.implementation).map(([address, count]) => ({ address, count })),
    outliers: withCode.length - matching,
    clusters: hashes.map(([hash, count]) => ({ codeHash: hash, count })),
    majority: inHash * 2 > withCode.length,
  };
}

/** Does a contract fit a role rule? null when the rule or the facts are missing. */
export function fitsRule(facts, rule) {
  if (!rule?.codeHash || !rule.slot || !facts?.codeHash) return { codeHash: null, proxy: null };
  return { codeHash: facts.codeHash === rule.codeHash, proxy: facts[rule.slot] === rule.slotValue };
}

const EXPLAIN = Object.freeze({
  issuer_list: 'listed by the issuer',
  not_in_issuer_list: 'not in the issuer list',
  binance_list: 'listed by Binance',
  no_code: 'no contract code at this address on BNB Smart Chain',
  code_unreadable: 'the bytecode could not be read, so nothing was compared',
  code_hash_match: 'runtime code matches the family',
  code_hash_mismatch: 'runtime code differs from the family',
  proxy_match: 'proxy points to the issuer beacon/admin',
  proxy_mismatch: 'proxy beacon/admin differs from the issuer',
  creator_match: 'created by an address that created contracts fitting the family rule',
  creator_mismatch: 'created by an address that created no contract fitting the family rule',
  creator_not_checked: 'creator not checked',
  fingerprint_without_listing: 'code and proxy match a family, but no list has this address',
  claims_symbol: 'its symbol() copies a genuine contract',
  claims_name: 'its name() carries the family marker',
  shares_ticker: 'shares a ticker with a family token (not a claim)',
});

export const explain = (reasons) => {
  const text = reasons.map((r) => EXPLAIN[r] || r).join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/**
 * Verdict for an address that a list puts in a family.
 * @param {object} input
 * @param {boolean} input.inIssuerList
 * @param {boolean} input.listedByBinance
 * @param {object|null} input.facts      from readOnchain (null = not read)
 * @param {object|null} input.rule       the family rule for this role
 * @param {string|null} [input.creator]          creator from Binance basic-info, when checked
 * @param {string[]|null} [input.familyCreators] creators of the contracts that fit the family rule
 * @param {boolean} [input.creatorChecked]
 */
export function listedVerdict({ inIssuerList, listedByBinance, facts, rule, creator = null, familyCreators = null, creatorChecked = false }) {
  const reasons = [inIssuerList ? 'issuer_list' : 'not_in_issuer_list'];
  if (listedByBinance) reasons.push('binance_list');
  const checks = { issuerList: !!inIssuerList, hasCode: null, codeHash: null, proxy: null, creator: null };
  const done = (verdict) => ({ verdict, reasons, checks, explanation: explain(reasons) });
  if (!facts || facts.unread || facts.codeSize == null) { reasons.push('code_unreadable'); return done('unknown'); }
  if (facts.codeSize === 0) { checks.hasCode = false; reasons.push('no_code'); return done('unknown'); }
  checks.hasCode = true;
  const fit = fitsRule(facts, rule);
  checks.codeHash = fit.codeHash;
  checks.proxy = fit.proxy;
  if (fit.codeHash !== null) reasons.push(fit.codeHash ? 'code_hash_match' : 'code_hash_mismatch');
  if (fit.proxy !== null) reasons.push(fit.proxy ? 'proxy_match' : 'proxy_mismatch');
  if (creatorChecked && creator && familyCreators && familyCreators.length) {
    checks.creator = familyCreators.includes(creator);
    reasons.push(checks.creator ? 'creator_match' : 'creator_mismatch');
  } else reasons.push('creator_not_checked');
  const genuine = checks.issuerList && checks.codeHash === true && checks.proxy === true && checks.creator !== false;
  return done(genuine ? 'genuine' : 'unknown');
}

/**
 * Verdict for any address (the single-address check): the snapshot decides membership, the live
 * facts decide the rest.
 * @param {object} input
 * @param {object|null} input.listed     the snapshot entry for this address, if any
 * @param {object} input.facts           live facts (readOnchain shape)
 * @param {object} input.rules           { [family]: { token: rule, wrapper?: rule } }
 * @param {object} input.index           claimIndex(genuine tokens)
 */
export function addressVerdict({ listed, facts, rules, index }) {
  if (listed) {
    const rule = rules[listed.family]?.[listed.role] ?? null;
    const v = listedVerdict({
      inIssuerList: listed.checks?.issuerList === true,
      listedByBinance: (listed.listedBy || []).some((s) => s.startsWith('binance')),
      facts, rule,
      creator: listed.creator?.address ?? null,
      familyCreators: listed.familyCreators ?? null,
      creatorChecked: listed.creator?.status === 'ok',
    });
    return { ...v, family: listed.family, role: listed.role, claim: null, shared: null };
  }
  if (!facts || facts.unread || facts.codeSize == null) {
    return { verdict: 'unknown', reasons: ['code_unreadable'], checks: { issuerList: false, hasCode: null, codeHash: null, proxy: null, creator: null }, explanation: explain(['code_unreadable']), family: null, role: null, claim: null, shared: null };
  }
  const checks = { issuerList: false, hasCode: facts.codeSize > 0, codeHash: null, proxy: null, creator: null };
  // A contract with a family's fingerprint but on no list: identical bytes can be deployed by anyone
  // only if they also point at the issuer's beacon/admin — possible for the issuer's own new token.
  for (const [family, roles] of Object.entries(rules)) {
    for (const [role, rule] of Object.entries(roles || {})) {
      const fit = fitsRule(facts, rule);
      if (fit.codeHash && fit.proxy) {
        const reasons = ['not_in_issuer_list', 'code_hash_match', 'proxy_match', 'fingerprint_without_listing'];
        return { verdict: 'unknown', reasons, checks: { ...checks, codeHash: true, proxy: true }, explanation: explain(reasons), family, role, claim: null, shared: null };
      }
    }
  }
  const claim = claimOf(facts, index);
  if (claim) {
    const rule = rules[claim.family]?.token ?? null;
    const fit = fitsRule(facts, rule);
    const reasons = ['not_in_issuer_list'];
    if (claim.by.includes('symbol')) reasons.push('claims_symbol');
    if (claim.by.includes('name')) reasons.push('claims_name');
    if (fit.codeHash !== null) reasons.push(fit.codeHash ? 'code_hash_match' : 'code_hash_mismatch');
    if (fit.proxy !== null) reasons.push(fit.proxy ? 'proxy_match' : 'proxy_mismatch');
    return { verdict: 'look-alike', reasons, checks: { ...checks, codeHash: fit.codeHash, proxy: fit.proxy }, explanation: explain(reasons), family: claim.family, role: null, claim, shared: null };
  }
  const shared = sharedTicker(facts, index);
  const reasons = ['not_in_issuer_list', ...(shared ? ['shares_ticker'] : [])];
  return { verdict: 'none', reasons, checks, explanation: explain(reasons), family: null, role: null, claim: null, shared };
}
