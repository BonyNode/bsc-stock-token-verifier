// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Keccak-256 as used by Ethereum (original Keccak padding 0x01, not the SHA3-256 padding 0x06).
// Node's crypto module ships sha3-256 but not keccak-256, and this package has no dependencies,
// so the permutation is implemented here. It is pinned by reference vectors in test/keccak.test.mjs,
// including the on-chain reference bytecode whose hash is the core of the authenticity rule.

const MASK = (1n << 64n) - 1n;
const RATE = 136; // bytes absorbed per block for a 256-bit output

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function keccakF(st) {
  const bc = new Array(5);
  for (let round = 0; round < 24; round += 1) {
    // theta
    for (let i = 0; i < 5; i += 1) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
    for (let i = 0; i < 5; i += 1) {
      const t = bc[(i + 4) % 5] ^ rotl(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) st[j + i] ^= t;
    }
    // rho and pi
    let t = st[1];
    for (let i = 0; i < 24; i += 1) {
      const j = PILN[i];
      const next = st[j];
      st[j] = rotl(t, ROTC[i]);
      t = next;
    }
    // chi
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i += 1) bc[i] = st[j + i];
      for (let i = 0; i < 5; i += 1) st[j + i] ^= (~bc[(i + 1) % 5] & MASK) & bc[(i + 2) % 5];
    }
    // iota
    st[0] ^= RC[round];
  }
}

/** keccak256 of raw bytes → 32-byte Uint8Array. */
export function keccak256(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const padded = new Uint8Array(Math.floor(input.length / RATE) * RATE + RATE);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const st = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i += 1) {
      let lane = 0n;
      for (let b = 7; b >= 0; b -= 1) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      st[i] ^= lane;
    }
    keccakF(st);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i += 1) {
    let lane = st[i];
    for (let b = 0; b < 8; b += 1) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

export function hexToBytes(hex) {
  const clean = String(hex).replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new TypeError('not a hex string');
  return Uint8Array.from(clean.match(/../g) || [], (h) => parseInt(h, 16));
}

const toHex = (bytes) => `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

/** keccak256 of a 0x-hex byte string (e.g. the answer of eth_getCode) → 0x-prefixed lowercase hex. */
export const keccak256Hex = (hex) => toHex(keccak256(hexToBytes(hex)));

/** keccak256 of a UTF-8 string → 0x-prefixed lowercase hex. */
export const keccak256Text = (text) => toHex(keccak256(new TextEncoder().encode(String(text))));

/** 4-byte function selector, e.g. selector('uiMultiplier()') → '0xa60bf13d'. */
export const selector = (signature) => keccak256Text(signature).slice(0, 10);
