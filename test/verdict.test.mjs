// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256Hex } from '../src/keccak.js';
import { addressVerdict, deriveRule, fitsRule, listedVerdict } from '../src/verdict.js';
import { claimIndex, claimOf } from '../src/families.js';
import { AEHRX, FAKE_NVDAX, MRNAON, NVDAB, NVDAX_ADDR, WAEHRX } from './fixtures/bsc.mjs';

const facts = (f, extra = {}) => ({ address: f.addr, codeSize: (f.code.length - 2) / 2, codeHash: keccak256Hex(f.code), beacon: f.beacon, admin: f.admin, implementation: f.implementation, symbol: f.symbol, name: f.name, decimals: f.decimals, unread: false, ...extra });
const other = (n, patch) => ({ ...facts(NVDAB), address: `0x${String(n).padStart(40, '0')}`, ...patch });

test('the rule is derived from the listed contracts: dominant code hash, then the shared beacon', () => {
  const members = [facts(NVDAB), other(1), other(2), other(3, { beacon: '0x16ba2c6cdcdca14a6e071255a7cf28318ba193d8' }), other(4, { codeHash: `0x${'ab'.repeat(32)}` })];
  const rule = deriveRule(members);
  assert.equal(rule.codeHash, NVDAB.codeHash);
  assert.equal(rule.slot, 'beacon');
  assert.equal(rule.slotValue, NVDAB.beacon);
  assert.equal(rule.proxyKind, 'beacon');
  assert.equal(rule.members, 3);
  assert.equal(rule.outliers, 2, 'a second beacon and a second code hash are outliers, not members');
  assert.equal(rule.majority, true);
});

test('transparent proxies are ruled by the admin slot; implementations are reported, not required', () => {
  const rule = deriveRule([facts(AEHRX), { ...facts(AEHRX), address: `0x${'1'.repeat(40)}`, implementation: '0x65c40d624af3b18c109fbf87b7deff34cdc5f19b' }]);
  assert.equal(rule.slot, 'admin');
  assert.equal(rule.slotValue, AEHRX.admin);
  assert.equal(rule.members, 2, 'two implementations, one family');
  assert.deepEqual(rule.implementations.map((i) => i.count), [1, 1]);
});

test('the wrapper rule differs from the token rule: same size, other hash and admin', () => {
  const token = deriveRule([facts(AEHRX)]);
  const wrapper = deriveRule([facts(WAEHRX)]);
  assert.equal(token.codeSize, wrapper.codeSize);
  assert.notEqual(token.codeHash, wrapper.codeHash);
  assert.deepEqual(fitsRule(facts(WAEHRX), token), { codeHash: false, proxy: false });
});

test('genuine needs the issuer list AND the code hash AND the proxy slot', () => {
  const rule = deriveRule([facts(NVDAB)]);
  const ok = listedVerdict({ inIssuerList: true, listedByBinance: true, facts: facts(NVDAB), rule });
  assert.equal(ok.verdict, 'genuine');
  assert.deepEqual(ok.reasons, ['issuer_list', 'binance_list', 'code_hash_match', 'proxy_match', 'creator_not_checked']);
  assert.equal(listedVerdict({ inIssuerList: false, listedByBinance: true, facts: facts(NVDAB), rule }).verdict, 'unknown', 'not on the issuer list');
  const foreignBeacon = listedVerdict({ inIssuerList: true, facts: { ...facts(NVDAB), beacon: `0x${'9'.repeat(40)}` }, rule });
  assert.equal(foreignBeacon.verdict, 'unknown');
  assert.ok(foreignBeacon.reasons.includes('proxy_mismatch'));
  const foreignCode = listedVerdict({ inIssuerList: true, facts: facts(MRNAON), rule });
  assert.ok(foreignCode.reasons.includes('code_hash_mismatch'));
});

test('a creator that differs from the family makes a listed contract unknown; an unchecked one does not', () => {
  const rule = deriveRule([facts(NVDAB)]);
  const fam = ['0x64fdaf82d69d5a8ab409331e3042042e8a178d53', '0x16ace0cc69fc841e2707913ec2607c8d65126664'];
  assert.equal(listedVerdict({ inIssuerList: true, facts: facts(NVDAB), rule, creator: fam[1], familyCreators: fam, creatorChecked: true }).verdict, 'genuine', 'any creator of the family set');
  const bad = listedVerdict({ inIssuerList: true, facts: facts(NVDAB), rule, creator: `0x${'7'.repeat(40)}`, familyCreators: fam, creatorChecked: true });
  assert.equal(bad.verdict, 'unknown');
  assert.equal(bad.checks.creator, false);
  assert.ok(bad.reasons.includes('creator_mismatch'));
});

test('no code and unreadable code are never genuine, and never a look-alike either', () => {
  const rule = deriveRule([facts(NVDAB)]);
  const empty = listedVerdict({ inIssuerList: true, facts: { ...facts(NVDAB), codeSize: 0, codeHash: keccak256Hex('0x') }, rule });
  assert.equal(empty.verdict, 'unknown');
  assert.equal(empty.checks.hasCode, false);
  assert.ok(empty.reasons.includes('no_code'));
  const unread = listedVerdict({ inIssuerList: true, facts: { address: NVDAB.addr, unread: true, codeSize: null }, rule });
  assert.deepEqual(unread.reasons, ['issuer_list', 'code_unreadable']);
});

test('claims are read from the contract: the family marker in the name, or the exact symbol backed by the name', () => {
  const index = claimIndex([
    { family: 'xstocks', role: 'token', address: NVDAX_ADDR, symbol: 'NVDAx', name: 'NVIDIA xStock', underlyingTicker: 'NVDA' },
    { family: 'bstocks', role: 'token', address: NVDAB.addr, symbol: 'NVDAB', name: 'NVIDIA Corp', underlyingTicker: 'NVDA' },
    { family: 'bstocks', role: 'token', address: `0x${'b'.repeat(40)}`, symbol: 'BEB', name: 'Bloom Energy Corp', underlyingTicker: 'BE' },
    { family: 'ondo', role: 'token', address: `0x${'c'.repeat(40)}`, symbol: 'AIon', name: 'C3.ai (Ondo Tokenized)', underlyingTicker: 'AI' },
    { family: 'xstocks', role: 'token', address: `0x${'d'.repeat(40)}`, symbol: 'Fx', name: 'Ford xStock', underlyingTicker: 'F' },
  ]);
  assert.deepEqual(claimOf({ symbol: 'NVDAx', name: 'NVIDIA xStock' }, index), { family: 'xstocks', by: ['symbol', 'name'], genuineSymbol: 'NVDAx', genuineAddress: NVDAX_ADDR });
  assert.deepEqual(claimOf({ symbol: 'NVDAB', name: 'NVIDIA Corporation' }, index).by, ['symbol'], 'a distinctive word of the genuine name');
  assert.deepEqual(claimOf({ symbol: 'NVDAB', name: 'NVDAB' }, index).by, ['symbol'], 'the name repeats the symbol');
  assert.equal(claimOf({ symbol: 'BEB', name: 'Bloom Energy' }, index).family, 'bstocks');
  assert.equal(claimOf({ symbol: 'BEB', name: 'A Battered Pepe' }, index), null, 'the same symbol for another project is not a claim');
  assert.equal(claimOf({ symbol: 'AION', name: 'Aion Finance' }, index), null, 'case matters: AION is not AIon');
  assert.equal(claimOf({ symbol: 'FX', name: 'FENGXIN' }, index), null);
  assert.deepEqual(claimOf({ symbol: 'GSX', name: 'Goldman Sachs xStock' }, index).by, ['name'], 'the marker claims even when the symbol differs');
  assert.equal(claimOf({ symbol: 'ABCon', name: 'Abc (Ondo Tokenized)' }, index).family, 'ondo');
  assert.equal(claimOf({ symbol: 'NVDA', name: 'NVDA RTX STOCKS' }, index), null, 'a shared ticker is not a claim');
  assert.equal(claimOf({ symbol: 'FNVDAB', name: 'Flap NVDAB Vault' }, index), null);
});

test('a single address: listed → its rule; on no list with a copied symbol → look-alike; a ticker alone → none', () => {
  const rules = { bstocks: { token: deriveRule([facts(NVDAB)]) }, xstocks: { token: deriveRule([facts(AEHRX)]), wrapper: deriveRule([facts(WAEHRX)]) } };
  const index = claimIndex([{ family: 'xstocks', role: 'token', address: NVDAX_ADDR, symbol: 'NVDAx', name: 'NVIDIA xStock', underlyingTicker: 'NVDA' }]);
  const listed = { family: 'bstocks', role: 'token', checks: { issuerList: true }, listedBy: ['binance-public:stock-list'], creator: { status: 'not_checked' } };
  assert.equal(addressVerdict({ listed, facts: facts(NVDAB), rules, index }).verdict, 'genuine');

  const fake = addressVerdict({ listed: null, facts: facts(FAKE_NVDAX), rules, index });
  assert.equal(fake.verdict, 'look-alike');
  assert.deepEqual(fake.reasons, ['not_in_issuer_list', 'claims_symbol', 'claims_name', 'code_hash_mismatch', 'proxy_mismatch']);
  assert.equal(fake.claim.genuineAddress, NVDAX_ADDR);

  const meme = addressVerdict({ listed: null, facts: { ...facts(FAKE_NVDAX), symbol: 'NVDA', name: 'No Value Dog Agent' }, rules, index });
  assert.equal(meme.verdict, 'none');
  assert.deepEqual(meme.reasons, ['not_in_issuer_list', 'shares_ticker']);

  const unlisted = addressVerdict({ listed: null, facts: { ...facts(AEHRX), address: `0x${'5'.repeat(40)}` }, rules, index });
  assert.equal(unlisted.verdict, 'unknown');
  assert.ok(unlisted.reasons.includes('fingerprint_without_listing'));

  const down = addressVerdict({ listed: null, facts: { unread: true, codeSize: null }, rules, index });
  assert.deepEqual([down.verdict, down.reasons], ['unknown', ['code_unreadable']]);
});

test('the kind of claimant is read only from what the contract says about itself', async () => {
  const { claimantKind } = await import('../src/families.js');
  assert.equal(claimantKind({ symbol: 'SPYX', name: 'SP500 tokenized ETF (xStock) WormHole' }), 'bridged');
  assert.equal(claimantKind({ symbol: 't-ABBVon', name: 'Testing AbbVie (Ondo Tokenized)' }), 'test');
  assert.equal(claimantKind({ symbol: 'NVDAx', name: 'NVIDIA Tokenized Stock (Coinbase)' }), 'other_issuer');
  assert.equal(claimantKind({ symbol: 'NVDAx', name: 'NVIDIA xStock' }), 'unidentified', 'no guess when the contract says nothing');
  assert.equal(claimantKind({ symbol: 'TESLAx', name: 'Tesla xStock' }), 'unidentified', 'a ticker that merely starts with TE is not a test');
});
