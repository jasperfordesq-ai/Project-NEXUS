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
 */

import { copyFile, mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
