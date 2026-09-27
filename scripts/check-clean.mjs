#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Pre-publication check: nothing in this repository may carry private working material, secrets,
// or wording the chain's terms do not allow.
//
//   node scripts/check-clean.mjs          self-test, then scan every file in the working tree
//
// What is checked, per file and per line:
//   · absolute local paths and private IP ranges;
//   · anything shaped like a credential (private keys, API tokens, key assignments);
//   · non-English text (this repository is English-only);
//   · terminology: the assets are "Stock Tokens" — the family of words meaning "securities issued as
//     tokens" is not used for them, in any of six languages; the issuer's stock ticker is not
//     mentioned in material about the chain; the chain is always "Robinhood Chain", never abbreviated
//     and never an informal or unofficial variant of the name;
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
const SKIP_DIRS = new Set(['.git', 'node_modules']);
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
  { id: 'terminology-en', re: /toke\x6ei[sz]/i, hit: [j('these toke', 'nized shares')], miss: ['Stock Tokens', 'tokens'] },
  { id: 'terminology-de', re: /toke\x6eisier/i, hit: [j('ein Katalog toke', 'nisierter Aktien')], miss: ['Stock Tokens'] },
  { id: 'terminology-fr', re: /tok\u00e9\x6eis|toke\x6eis[e\u00e9]/i, hit: [j('actions toke', 'nis\u00e9es'), j('tok\u00e9', 'nisation')], miss: ['Stock Tokens'] },
  { id: 'terminology-es', re: /toke\x6eizad|toke\x6eizaci/i, hit: [j('acciones toke', 'nizadas')], miss: ['Stock Tokens'] },
  { id: 'terminology-zh', re: /\u4ee3\u5e01\u5316|\u901a\u8bc1\u5316/, hit: ['\u94fe\u4e0a\u4ee3\u5e01\u5316\u80a1\u7968\u76ee\u5f55'], miss: ['Stock Tokens'] },
  { id: 'terminology-ar', re: /\u0645\u0631\u0645\u0632|\u062a\u0631\u0645\u064a\u0632/,
    hit: ['\u0643\u062a\u0627\u0644\u0648\u062c \u0627\u0644\u0623\u0633\u0647\u0645 \u0627\u0644\u0645\u0631\u0645\u0632\u0629'], miss: ['Stock Tokens'] },
  // The issuer's ticker. A bare search would hit the chain's own name in every URL, so the brand is
  // removed first and only a standalone four-letter word (or its dollar form) is looked for.
  { id: 'issuer-ticker', line: (l) => { const s = l.replace(/robinhood/gi, ' '); return /(^|[^A-Za-z])\x48OOD([^A-Za-z]|$)/.test(s) || /\$\x48OOD/i.test(s); },
    hit: [j('chain volume beats H', 'OOD revenue'), j('see $H', 'OOD')], miss: ['Robinhood Chain · rpc.mainnet.chain.robinhood.com', 'ROBINHOOD CHAIN'] },
  // The chain is named in full. Its three-letter abbreviation is looked for as a word of its own,
  // also inside identifiers such as an environment variable prefix or a command name.
  { id: 'chain-abbreviation', re: /(^|[^A-Za-z0-9])\x72hc(?![A-Za-z])/i,
    hit: [j('R', 'HC_ENDPOINT'), j('bin/r', 'hc-tool'), j('bridged to R', 'HC')], miss: ['Robinhood Chain', 'STV_RPC_URLS', 'robinhoodchain.blockscout.com'] },
  // The chain's terms prohibit the shorthand and any other abbreviated, informal or unofficial variant
  // of its name in external-facing material. The variants are looked for as words of their own — a
  // shortened brand, its initials, or its first half, before "chain" — also inside identifiers.
  { id: 'chain-informal-name', re: /(^|[^A-Za-z0-9])(?:\x68ood|\x72h|\x72obin)[\s_.-]*chain(?![A-Za-z])/i,
    hit: [j('Ho', 'od Chain'), j('Ho', 'odChain'), j('R', 'H Chain'), j('R', 'H_CHAIN_ID'), j('Robin Ho', 'od Chain'), j('Robin', ' Chain')],
    miss: ['Robinhood Chain', 'robinhoodchain.blockscout.com', 'docs.robinhood.com/chain/contracts', 'a neighbourhood chain store'] },
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
  text.split('\n').forEach((line, index) => {
    for (const rule of rules) {
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
  for (const name of ['README.md', 'data/stock-tokens.snapshot.json', 'src/keccak.js']) if (FORBIDDEN_FILES.test(name)) problems.push(`forbidden-file fires on ${name}`);
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
