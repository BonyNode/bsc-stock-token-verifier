#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Pre-publication check: nothing in this repository may carry private working material, secrets
// (Binance Web3 API keys and signatures included), or a call to buy.
//
//   node scripts/check-clean.mjs          self-test, then scan every file in the working tree
//
// What is checked, per file and per line:
//   · absolute local paths and private IP ranges;
//   · anything shaped like a credential (private keys, API tokens, key assignments), Binance Web3
//     API key values and signing-header values;
//   · non-English text (this repository is English-only; contract names in data are \u-escaped);
//   · calls to buy or invest: the output is information only, not investment advice;
//   · file names that should never be committed (.env*, keys, databases).
//
// Rules about a maintainer's own environment (host names, ports, directory names, ticket numbers)
// do not belong in a public file. Keep them in a JSON file outside the repository and point
// CHECK_CLEAN_EXTRA at it; no such file is needed, but a file that exists and cannot be loaded
// stops the check. Format: [{ "id", "pattern", "flags", "secret", "hit": [...], "miss": [...] }].
//
// Every rule carries a fixture it MUST catch and the self-test fails if one does not: a check that
// is green on a broken tree as well as on a healthy one checks nothing. The patterns and fixtures
// below are spelled with escapes or in pieces so that this file passes its own scan with ZERO
// exemptions — an exemption list is where such checks go blind.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// .cache holds the scan's working files (gitignored, never published).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache']);
const j = (...parts) => parts.join('');

export const RULES = [
  { id: 'local-path', re: /\/root\/|\/home\/\w/i,
    hit: [j('/ro', 'ot/x'), j('/ho', 'me/user/notes')], miss: ['see src/registry.js'] },
  { id: 'private-ip', re: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
    hit: [j('10.', '0.0.1'), j('192.', '168.1.20')], miss: ['127.0.0.1', 'version 10.2'] },
  { id: 'credential', secret: true,
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b\d{8,10}:[A-Za-z0-9_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{36}\b|\bsk-[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\b(?:private[_ -]?key|mnemonic|seed[_ -]?phrase|secret|api[_-]?key|password)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
    hit: [j('-----BEGIN ', 'EC PRIVATE KEY-----'), j('123456789', ':', 'A'.repeat(35)), j('gh', 'p_', 'a'.repeat(36)), j('private', '_key = ', 'f'.repeat(16))],
    miss: ['free public read API, no key required'] },
  { id: 'hex-near-key-word', secret: true, line: (l) => /priv|secret|mnemonic|seed/i.test(l) && /\b(?:0x)?[0-9a-f]{64}\b/i.test(l),
    hit: [j('const priv = "0x', 'ab'.repeat(32), '"')], miss: [j('codeHash: 0x', 'ab'.repeat(32))] },
  { id: 'non-english', re: /[\u0400-\u04ff]/,
    hit: ['\u0436'], miss: ['Stock Tokens'] },
  // Binance Web3 API credentials as they would appear in a pasted env file, a log or a fixture: the
  // variable with a value, or a signing header with its value.
  { id: 'binance-key-value', secret: true, re: /\bBINANCE_W3_(?:API|SECRET)_KEY\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}/,
    hit: [j('BINANCE_W3_', 'SECR', 'ET_KEY=', 'Zm9v'.repeat(6))], miss: ['a file with BINANCE_W3_API_KEY= lines'] },
  { id: 'binance-header-value', secret: true, re: /x-oc-(?:sign|apikey)['"]?\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{20,}/i,
    hit: [j('X-OC-', 'SIGN: ', 'q83vEjRWeJ'.repeat(3), '=')], miss: ["'X-OC-APIKEY': apiKey,", "'X-OC-SIGN': signRequest({ secretKey })"] },
  // Information only: no call to buy or to invest, anywhere in the repository.
  // Our own wording only: data/ and report/ quote third-party contract names verbatim, and a name on
  // a public chain can say anything.
  { id: 'call-to-buy', skipFiles: /^(?:data|report)\//, re: /\b(?:buy|invest)\s+(?:now|today|here)\b|\bguaranteed\s+(?:returns?|profits?)\b|\bto\s+the\s+moon\b/i,
    hit: [j('Buy ', 'now before it is gone'), j('guaranteed ', 'returns')], miss: ['Nothing here is an offer or a recommendation to buy or sell anything.'] },
];

export const FORBIDDEN_FILES = /(^|\/)(?:\.env(?:\..*)?|id_[a-z0-9]+|.*\.(?:pem|key|p12|db|sqlite|sqlite3))$/i;

const test = (rule, text) => (rule.line ? rule.line(text) : rule.re.test(text));

/**
 * Optional rules from a JSON file outside the repository. No file name, or a file that does not
 * exist, means no extra rules; a file that exists but cannot be loaded is an error, never a skip.
 */
export function loadExtraRules(file) {
  if (!file) return { rules: [], note: 'no extra rules: CHECK_CLEAN_EXTRA is not set' };
  if (!fs.existsSync(file)) return { rules: [], note: 'no extra rules: the CHECK_CLEAN_EXTRA file does not exist' };
  let spec;
  try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`the CHECK_CLEAN_EXTRA file cannot be read as JSON: ${error.message}`); }
  if (!Array.isArray(spec)) throw new Error('the CHECK_CLEAN_EXTRA file must hold a JSON array of rules');
  const rules = spec.map((r, i) => {
    const ok = r && typeof r.id === 'string' && typeof r.pattern === 'string' && Array.isArray(r.hit) && r.hit.length > 0
      && (r.miss === undefined || Array.isArray(r.miss));
    if (!ok) throw new Error(`extra rule #${i + 1} needs an id, a pattern and a non-empty hit list`);
    let re;
    try { re = new RegExp(r.pattern, String(r.flags ?? '').replace(/[gy]/g, '')); } catch (error) { throw new Error(`extra rule ${r.id}: ${error.message}`); }
    return { id: r.id, re, ...(r.secret === true ? { secret: true } : {}), hit: r.hit.map(String), miss: (r.miss ?? []).map(String) };
  });
  return { rules, note: `${rules.length} extra rules from CHECK_CLEAN_EXTRA` };
}

/** Findings for one file's text. Secret rules never echo what they found. */
export function scanText(text, file = '<text>', rules = RULES) {
  const out = [];
  const active = rules.filter((rule) => !(rule.skipFiles && rule.skipFiles.test(file)));
  text.split('\n').forEach((line, index) => {
    for (const rule of active) {
      if (!test(rule, line)) continue;
      const m = rule.re ? line.match(rule.re) : null;
      out.push({ file, line: index + 1, rule: rule.id, excerpt: rule.secret ? '[redacted]' : JSON.stringify((m?.[0] ?? line.trim()).slice(0, 60)) });
    }
  });
  return out;
}

export function listFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name)); continue; }
      out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

export function scanTree(root = ROOT, rules = RULES) {
  const files = listFiles(root);
  const findings = [];
  for (const rel of files) {
    if (FORBIDDEN_FILES.test(rel)) findings.push({ file: rel, line: 0, rule: 'forbidden-file', excerpt: 'this kind of file must never be committed' });
    findings.push(...scanText(fs.readFileSync(path.join(root, rel), 'utf8'), rel, rules));
  }
  return { files, findings };
}

/** Every rule must catch each of its fixtures and pass each of its counter-examples. */
export function selfTest(rules = RULES) {
  const problems = [];
  for (const rule of rules) {
    for (const s of rule.hit) if (!test(rule, s)) problems.push(`${rule.id} does not catch its own fixture`);
    for (const s of rule.miss) if (test(rule, s)) problems.push(`${rule.id} fires on an allowed text`);
  }
  for (const name of ['.env', '.env.local', 'keys/id_ed25519', 'deploy.pem', 'cache.db']) if (!FORBIDDEN_FILES.test(name)) problems.push(`forbidden-file misses ${name}`);
  for (const name of ['README.md', 'data/snapshot.json', 'src/keccak.js']) if (FORBIDDEN_FILES.test(name)) problems.push(`forbidden-file fires on ${name}`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let extra;
  try { extra = loadExtraRules(process.env.CHECK_CLEAN_EXTRA); } catch (error) { console.error(`check-clean: ${error.message}`); process.exit(2); }
  const rules = [...RULES, ...extra.rules];
  const problems = selfTest(rules);
  if (problems.length) {
    console.error(`self-test failed:\n  ${problems.join('\n  ')}`);
    process.exit(2);
  }
  const { files, findings } = scanTree(ROOT, rules);
  if (files.length < 10) { console.error(`only ${files.length} files found — the walk is broken`); process.exit(2); }
  for (const f of findings) console.error(`${f.file}:${f.line} ${f.rule} ${f.excerpt}`);
  console.log(`check-clean: ${rules.length} rules self-tested (${extra.note}), ${files.length} files scanned, ${findings.length} findings`);
  process.exit(findings.length ? 1 : 0);
}
