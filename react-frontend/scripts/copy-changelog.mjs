// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * copy-changelog.mjs
 *
 * Copies CHANGELOG.md into react-frontend/public/changelog.md so the Vite
 * build serves it as a static asset for the in-app /changelog route.
 *
 * Runs as part of `prebuild` and `predev`. Looks for the source in two
 * places, in order of preference:
 *
 *   1. ../CHANGELOG.md  (repo root — works in local dev)
 *   2. ./CHANGELOG.md   (frontend root — works in Docker builds when the
 *                        deploy pipeline pre-copies it into the build ctx)
 *
 * If neither exists (e.g. Docker build with a narrow build context and no
 * pre-copy step), we write a stub pointing users to the GitHub copy. We
 * never fail the build over a missing changelog — the /changelog page
 * already has a "View on GitHub" link as its fallback.
 *
 * It also writes what the page actually reads since 15 Nov 2026:
 *
 *   public/changelog-data/index.json    every release, with counts, no text
 *   public/changelog-data/<slug>.json   one release's entries
 *
 * The page opens with the index and fetches a release only when someone
 * opens it, instead of downloading the whole 3.78 MB file. The directory is
 * emptied first, so a release that was renamed leaves no stale file behind.
 * `changelog.md` is still copied but the page no longer reads it.
 */

import { copyFile, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, parseChangelog } from './lib/changelog-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const candidates = [
  path.resolve(frontendRoot, '..', 'CHANGELOG.md'),
  path.resolve(frontendRoot, 'CHANGELOG.md'),
];
const target = path.resolve(frontendRoot, 'public', 'changelog.md');

await mkdir(path.dirname(target), { recursive: true });

let copied = null;
for (const candidate of candidates) {
  try {
    await access(candidate, constants.R_OK);
    await copyFile(candidate, target);
    copied = candidate;
    break;
  } catch {
    /* try next candidate */
  }
}

if (copied) {
  console.log(`copy-changelog: ${copied} → ${target}`);
} else {
  const stub = [
    '# Changelog',
    '',
    'The full changelog could not be bundled into this build.',
    '',
    'You can read the complete, up-to-date version on GitHub:',
    '',
    '[CHANGELOG.md on GitHub](https://github.com/jasperfordesq-ai/Project-NEXUS/blob/main/CHANGELOG.md)',
    '',
  ].join('\n');
  await writeFile(target, stub, 'utf8');
  console.warn('copy-changelog: source not found in any candidate location, wrote GitHub-link stub');
  console.warn(`copy-changelog: tried: ${candidates.join(', ')}`);
}

// ── The per-release data files ───────────────────────────────────────────────
const dataDir = path.resolve(frontendRoot, 'public', 'changelog-data');
await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

let parsed = { releases: [] };
if (copied) {
  try {
    parsed = parseChangelog(await readFile(copied, 'utf8'));
  } catch (error) {
    // Same rule as above: a changelog problem never fails the build. An empty
    // index makes the page show its "read it on GitHub" message. The parser is
    // run against the real CHANGELOG.md by changelogData.test.ts, so a file it
    // cannot read is caught in CI rather than here.
    console.warn(`copy-changelog: could not split the changelog into releases: ${error?.message ?? error}`);
  }
}

for (const release of parsed.releases) {
  await writeFile(path.join(dataDir, `${release.slug}.json`), JSON.stringify(release), 'utf8');
}
await writeFile(path.join(dataDir, 'index.json'), JSON.stringify(buildIndex(parsed)), 'utf8');
console.log(`copy-changelog: wrote ${parsed.releases.length} release file(s) and index.json → ${dataDir}`);
