// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Live check of one address on BNB Smart Chain: the facts are read now (one batch for the code, one
// for the proxy slots and name/symbol/decimals); the membership lists and the family rules come
// from a snapshot (data/snapshot.json by default). No key is needed.
import { CHAIN_ID } from './chain.js';
import { claimIndex } from './families.js';
import { createRpc, hideUrlSecrets } from './rpc.js';
import { isAddress, readOnchain } from './onchain.js';
import { readSnapshot } from './snapshot.js';
import { addressVerdict } from './verdict.js';

export const VERIFY_METHOD = 'eth_chainId (must be 56), eth_blockNumber and eth_getCode at the latest block; where there is code, '
  + 'the EIP-1967 implementation, admin and beacon slots and name(), symbol(), decimals(). The address is then looked up in the '
  + 'snapshot lists, and the code hash and proxy slot are compared with the rule the snapshot measured for the family';

/** Rules and lookups from a snapshot, ready for addressVerdict(). */
export function contextFromSnapshot(snapshot) {
  const rules = {};
  for (const [family, f] of Object.entries(snapshot.families)) rules[family] = f.fingerprint.roles;
  const creatorsOf = (family) => (snapshot.families[family]?.fingerprint?.creators || []).map((c) => c.address);
  const byAddress = new Map(snapshot.tokens.map((t) => [t.address, {
    ...t,
    familyCreators: creatorsOf(t.family),
    otherFamilyCreators: Object.keys(snapshot.families).filter((f) => f !== t.family).flatMap(creatorsOf),
  }]));
  const index = claimIndex(snapshot.tokens.filter((t) => t.verdict === 'genuine'));
  const lookalikes = new Map((snapshot.lookalikes?.items || []).map((l) => [l.address, l]));
  return { rules, byAddress, index, lookalikes };
}

/**
 * @param {string} address
 * @param {object} [options]
 * @param {object} [options.rpc]       a client from createRpc()
 * @param {object} [options.snapshot]  a snapshot object (data/snapshot.json by default)
 */
export async function verifyAddress(address, { rpc = createRpc(), snapshot = readSnapshot() } = {}) {
  if (!isAddress(address)) throw new TypeError(`not an EVM address: ${String(address).slice(0, 60)}`);
  const to = address.toLowerCase();
  const ctx = contextFromSnapshot(snapshot);
  const listed = ctx.byAddress.get(to) || null;
  const base = { chainId: CHAIN_ID, address: to, method: VERIFY_METHOD, checkedAt: new Date().toISOString(), snapshotGeneratedAt: snapshot.generatedAt };
  let facts = null;
  let block = null;
  let error = null;
  try {
    const r = await readOnchain([to], { rpc });
    facts = r.facts.get(to);
    block = r.block;
  } catch (e) {
    error = hideUrlSecrets(e?.message || e).slice(0, 200);
  }
  const v = addressVerdict({ listed, facts, rules: ctx.rules, index: ctx.index });
  const seenAsLookalike = ctx.lookalikes.get(to) || null;
  return {
    ...base,
    verdict: v.verdict,
    reasons: v.reasons,
    explanation: v.explanation,
    checks: v.checks,
    family: v.family,
    role: v.role,
    claim: v.claim,
    sharedTicker: v.shared,
    listedBy: listed?.listedBy ?? [],
    underlyingTicker: listed?.underlyingTicker ?? null,
    symbol: facts?.symbol ?? null,
    name: facts?.name ?? null,
    decimals: facts?.decimals ?? null,
    codeHash: facts?.codeHash ?? null,
    codeSize: facts?.codeSize ?? null,
    beacon: facts?.beacon ?? null,
    admin: facts?.admin ?? null,
    implementation: facts?.implementation ?? null,
    expected: v.family && (v.role || 'token') ? ctx.rules[v.family]?.[v.role || 'token'] ?? null : null,
    genuineAddress: v.claim?.genuineAddress ?? null,
    lookalikeInSnapshot: !!seenAsLookalike,
    block,
    rpc: rpc.answeredBy,
    ...(error ? { error, reason: 'rpc_unavailable' } : {}),
  };
}
