// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256Hex, keccak256Text, selector, hexToBytes } from '../src/keccak.js';
import { AEHRX, FAKE_NVDAX, NVDAB } from './fixtures/bsc.mjs';

// Reference values computed with an independent, audited implementation.
test('keccak256 matches reference vectors, including every padding edge of the 136-byte rate', () => {
  assert.equal(keccak256Text(''), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccak256Text('abc'), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(keccak256Text('a'.repeat(135)), '0x34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446');
  assert.equal(keccak256Text('a'.repeat(136)), '0xa6c4d403279fe3e0af03729caada8374b5ca54d8065329a3ebcaeb4b60aa386e');
  assert.equal(keccak256Text('a'.repeat(137)), '0xd869f639c7046b4929fc92a4d988a8b22c55fbadb802c0c66ebcd484f1915f39');
  assert.equal(keccak256Text('a'.repeat(272)), '0xcf7fcd4f705ee749930d19ca84561a9bf62516bd90a471545fa2f49fdc7e63c8');
});

test('it is Keccak, not SHA3-256: the empty-input hashes differ', async () => {
  const { createHash } = await import('node:crypto');
  assert.notEqual(keccak256Text(''), `0x${createHash('sha3-256').update('').digest('hex')}`);
});

test('the live bytecode of bStocks NVDAB and xStocks AEHRx hashes to the measured values; the look-alike does not', () => {
  assert.equal(keccak256Hex(NVDAB.code), NVDAB.codeHash);
  assert.equal(keccak256Hex(AEHRX.code), AEHRX.codeHash);
  assert.equal(keccak256Hex(FAKE_NVDAX.code), '0x63ad5291cdef5d82cddf8e5d8d4c48bd6ad1de2394616ab66a6c6c6cceae63bb');
  assert.equal(keccak256Hex('0x'), keccak256Text(''), 'an empty account hashes like empty input');
});

test('function selectors are derived, not copied', () => {
  assert.equal(selector('symbol()'), '0x95d89b41');
  assert.equal(selector('name()'), '0x06fdde03');
  assert.equal(selector('decimals()'), '0x313ce567');
  // The bStocks runtime code asks its beacon for implementation(), and the beacon address is in the bytes.
  assert.ok(NVDAB.code.includes(selector('implementation()').slice(2)));
  assert.ok(NVDAB.code.includes(NVDAB.beacon.slice(2)));
});

test('hexToBytes rejects what is not hex', () => {
  assert.deepEqual([...hexToBytes('0x00ff')], [0, 255]);
  assert.throws(() => hexToBytes('0xabc'));
  assert.throws(() => hexToBytes('0xzz'));
});
