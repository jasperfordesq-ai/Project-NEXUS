// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * setJsonVersion — bump the version in a dependency manifest surgically.
 *
 * 🔴 Why this is not a string replace. Cutting v1.8.0 rewrote
 * `react-frontend/package-lock.json` with a blind `1.7.0` → `1.8.0` replace and
 * broke `main`: all eight React shards, React Build & Tests, Translation Drift,
 * the Release Gate, Security Scan, Lighthouse CI and the Platform-contracts
 * React job all died on `npm ci`, with
 *
 *   npm error code ETARGET
 *   npm error notarget No matching version found for esquery@1.8.0.
 *
 * because the old platform version also occurred in the lockfile as:
 *
 *   - a third-party package's own version (`esquery` 1.7.0 — there is no 1.8.0);
 *   - dependency ranges (`^1.7.0` for @emnapi/runtime and es-module-lexer);
 *   - 17 Node engine ranges (`^21.7.0` silently became `^21.8.0`).
 *
 * The replace had only ever worked by luck: no earlier platform version happened
 * to collide with a dependency's. `1.7.0` is a very common third-party version,
 * so the luck ran out. A manifest carries the version at known keys, so set
 * those keys and leave every other byte alone.
 *
 * Re-serialisation uses the file's OWN indentation (npm writes 2 spaces,
 * composer 4), which makes the round trip byte-identical apart from the version
 * lines. `scripts/test/test-release-manifest-rewrite.mjs` pins both properties.
 */

/**
 * Manifests whose version must be set by key, never by string replace, and the
 * key paths that hold it. `''` is the lockfile's root-package entry.
 */
export const JSON_VERSION_KEYS = {
  'composer.json': [['version']],
  'react-frontend/package.json': [['version']],
  'react-frontend/package-lock.json': [['version'], ['packages', '', 'version']],
};

/**
 * @param {string} before        current file contents
 * @param {string[][]} keyPaths  key paths to update
 * @param {string} from          version expected at those keys
 * @param {string} to            version to write
 * @returns {{after: string, occurrences: number} | null} null when no key held `from`
 */
export function setJsonVersion(before, keyPaths, from, to) {
  const doc = JSON.parse(before);

  let occurrences = 0;
  for (const keyPath of keyPaths) {
    let node = doc;
    for (const key of keyPath.slice(0, -1)) {
      if (node === null || typeof node !== 'object') {
        node = null;
        break;
      }
      node = node[key];
    }
    const leaf = keyPath[keyPath.length - 1];
    if (node !== null && typeof node === 'object' && node[leaf] === from) {
      node[leaf] = to;
      occurrences += 1;
    }
  }
  if (occurrences === 0) return null;

  const indentMatch = before.match(/\n(\s+)\S/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const trailingNewline = before.endsWith('\n') ? '\n' : '';

  return { after: JSON.stringify(doc, null, indent) + trailingNewline, occurrences };
}
