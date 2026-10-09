// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Reading and writing the snapshot file. The writer puts every element of a long array on its own
// line (readable diffs between two snapshots) and writes non-ASCII characters as \uXXXX escapes:
// contract names on a public chain can hold any text, and the file stays plain ASCII.
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_ID, validateSnapshot } from './schema.js';

export const DEFAULT_SNAPSHOT = new URL('../data/snapshot.json', import.meta.url);

const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

function pretty(value, indent) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) return asciiJson(value);
    return `[\n${value.map((v) => `${pad}  ${asciiJson(v)}`).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    if (indent >= 6) return asciiJson(value);
    return `{\n${keys.map((k) => `${pad}  ${JSON.stringify(k)}: ${pretty(value[k], indent + 2)}`).join(',\n')}\n${pad}}`;
  }
  return asciiJson(value);
}

/** The snapshot as file text. */
export const formatSnapshot = (snapshot) => `${pretty(snapshot, 0)}\n`;

/** Validates, then writes atomically (temp file + rename): a reader never sees half a file. */
export function writeSnapshot(file, snapshot) {
  const problems = validateSnapshot(snapshot);
  if (problems.length) throw new Error(`refusing to write a snapshot that does not match ${SCHEMA_ID}: ${problems.slice(0, 5).join('; ')}`);
  const target = file instanceof URL ? file.pathname : file;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, formatSnapshot(snapshot));
  fs.renameSync(tmp, target);
  return target;
}

/** Reads and validates a snapshot file; a file that does not match the schema is an error. */
export function readSnapshot(file = DEFAULT_SNAPSHOT) {
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateSnapshot(snapshot);
  if (problems.length) throw new Error(`snapshot does not match ${SCHEMA_ID}: ${problems.slice(0, 3).join('; ')}`);
  return snapshot;
}
