#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract tests for scripts/lib/set-json-version.mjs — the manifest rewrite
 * scripts/release.mjs uses.
 *
 * 🔴 Why this test exists. Cutting v1.8.0 rewrote react-frontend/package-lock.json
 * with a blind `1.7.0` → `1.8.0` string replace and turned `main` red: every
 * React job died on `npm ci` with
 * `ETARGET  No matching version found for esquery@1.8.0`, because the platform
 * version also appeared as a third-party package's version, inside two
 * dependency ranges, and inside 17 Node engine ranges. Nothing caught it before
 * the push, so this pins the invariant in BOTH directions:
 *
 *   - the declared version keys ARE updated;
 *   - every other byte, including decoy versions identical to the old one, is
 *     left exactly as it was.
 *
 * It also asserts the real repository manifests survive the round trip
 * byte-identically, which is what keeps a release diff reviewable.
 *
 * Run: node scripts/test/test-release-manifest-rewrite.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { JSON_VERSION_KEYS, setJsonVersion } from '../lib/set-json-version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ok    ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
};

// ---------------------------------------------------------------- fixtures
// A lockfile shaped like the real one, carrying every collision that broke main.
const LOCKFILE = `{
  "name": "nexus-react-frontend",
  "version": "1.7.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "nexus-react-frontend",
      "version": "1.7.0",
      "license": "AGPL-3.0-or-later",
      "dependencies": {
        "es-module-lexer": "^1.7.0"
      }
    },
    "node_modules/esquery": {
      "version": "1.7.0",
      "dev": true,
      "engines": {
        "node": ">=23.5.0 || ^22.13.0 || ^21.7.0 || ^20.12.0"
      }
    },
    "node_modules/@emnapi/runtime": {
      "version": "1.10.0",
      "dependencies": {
        "@emnapi/runtime": "^1.7.0"
      }
    }
  }
}
`;

console.log('set-json-version: lockfile rewrite');

const lockKeys = JSON_VERSION_KEYS['react-frontend/package-lock.json'];
const result = setJsonVersion(LOCKFILE, lockKeys, '1.7.0', '1.8.0');

check('rewrites exactly the two root version keys', result !== null && result.occurrences === 2, `occurrences=${result?.occurrences}`);

const after = result?.after ?? '';
const doc = after ? JSON.parse(after) : {};

check('root .version is bumped', doc.version === '1.8.0', `got ${doc.version}`);
check('root package .version is bumped', doc.packages?.['']?.version === '1.8.0', `got ${doc.packages?.['']?.version}`);

// The regressions. Each of these was silently corrupted by the string replace.
check(
  "a dependency's own version at the old platform version is untouched (esquery)",
  doc.packages?.['node_modules/esquery']?.version === '1.7.0',
  `got ${doc.packages?.['node_modules/esquery']?.version}`
);
check(
  'a dependency RANGE at the old platform version is untouched (es-module-lexer)',
  doc.packages?.['']?.dependencies?.['es-module-lexer'] === '^1.7.0',
  `got ${doc.packages?.['']?.dependencies?.['es-module-lexer']}`
);
check(
  'a dependency RANGE in a nested package is untouched (@emnapi/runtime)',
  doc.packages?.['node_modules/@emnapi/runtime']?.dependencies?.['@emnapi/runtime'] === '^1.7.0',
  `got ${doc.packages?.['node_modules/@emnapi/runtime']?.dependencies?.['@emnapi/runtime']}`
);
check(
  'a Node ENGINE range containing the old version is untouched',
  doc.packages?.['node_modules/esquery']?.engines?.node === '>=23.5.0 || ^22.13.0 || ^21.7.0 || ^20.12.0',
  `got ${doc.packages?.['node_modules/esquery']?.engines?.node}`
);
check(
  'no stray 1.8.0 appears anywhere but the two root keys',
  (after.match(/1\.8\.0/g) ?? []).length === 2,
  `found ${(after.match(/1\.8\.0/g) ?? []).length}`
);

// ------------------------------------------------------------- no-op safety
console.log('set-json-version: refusals and no-ops');

check(
  'returns null when no key holds the expected version',
  setJsonVersion(LOCKFILE, lockKeys, '9.9.9', '10.0.0') === null
);
check('throws on unparseable JSON rather than guessing', (() => {
  try {
    setJsonVersion('{ not json', lockKeys, '1.7.0', '1.8.0');
    return false;
  } catch {
    return true;
  }
})());
check('a missing key path is skipped, not created', (() => {
  const r = setJsonVersion('{\n  "version": "1.7.0"\n}\n', lockKeys, '1.7.0', '1.8.0');
  return r !== null && r.occurrences === 1 && JSON.parse(r.after).packages === undefined;
})());

// --------------------------------------------------- real manifest fidelity
console.log('set-json-version: real manifests round-trip byte-identically');

for (const [rel, keyPaths] of Object.entries(JSON_VERSION_KEYS)) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    check(`${rel} exists`, false, 'file not found — update JSON_VERSION_KEYS');
    continue;
  }
  const before = fs.readFileSync(abs, 'utf8');
  const current = JSON.parse(before).version;

  // Bump to a throwaway version and back; the file must return to itself.
  const up = setJsonVersion(before, keyPaths, current, '0.0.0-roundtrip');
  check(`${rel}: the version key is found`, up !== null, `no key held ${current}`);
  if (!up) continue;

  const down = setJsonVersion(up.after, keyPaths, '0.0.0-roundtrip', current);
  check(`${rel}: round trip is byte-identical (no reformatting)`, down !== null && down.after === before);

  const changedLines = up.after
    .split(/\r?\n/)
    .filter((line, i) => line !== before.split(/\r?\n/)[i]).length;
  check(`${rel}: a bump changes only the version line(s)`, changedLines === up.occurrences, `changed ${changedLines} lines for ${up.occurrences} key(s)`);
}

console.log('');
if (failures > 0) {
  console.error(`set-json-version contract tests FAILED (${failures}).`);
  process.exit(1);
}
console.log('set-json-version contract tests passed.');
