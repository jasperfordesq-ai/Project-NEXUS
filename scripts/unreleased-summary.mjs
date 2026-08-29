#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * unreleased-summary — say how much has piled up under [Unreleased], and how
 * long it has been there.
 *
 * 🔴 Why this exists. Deploying and cutting a version are deliberately separate
 * acts (docs/VERSIONING.md), and that separation is correct: most deploys
 * contain nothing worth announcing. The cost of the separation is that nobody
 * is ever prompted to cut a release, so the pile grows unnoticed. By 2026-08-29
 * it held 47 entries — including two member-facing features — while the app,
 * the About page and the public site all still said 1.6.2.
 *
 * 🔴 THIS IS INFORMATIONAL AND MUST NEVER BLOCK A DEPLOY. Deploying with a full
 * [Unreleased] section is a completely legitimate thing to do; it is how the
 * platform normally ships. This prints a nudge, nothing more, and exits 0 even
 * when it cannot read anything. A deploy that fails because a changelog note
 * could not be printed would be a self-inflicted outage.
 *
 * Usage:
 *   node scripts/unreleased-summary.mjs            # human-readable nudge
 *   node scripts/unreleased-summary.mjs --quiet    # print nothing when the pile is small
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

// Above this many entries, the pile is worth mentioning even in --quiet mode.
const NUDGE_AT = 10;

try {
  const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);

  const unreleasedIdx = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
  if (unreleasedIdx === -1) process.exit(0);

  const nextIdx = lines.findIndex((l, i) => i > unreleasedIdx && /^## \[/.test(l));
  const body = lines.slice(unreleasedIdx + 1, nextIdx === -1 ? lines.length : nextIdx);

  // Break the pile down by subsection so the nudge says what KIND of work is waiting.
  const counts = new Map();
  let heading = 'uncategorised';
  let total = 0;
  for (const line of body) {
    const h = line.match(/^###\s+(.*?)\s*$/);
    if (h) {
      heading = h[1];
      continue;
    }
    if (/^- /.test(line)) {
      counts.set(heading, (counts.get(heading) ?? 0) + 1);
      total++;
    }
  }

  if (total === 0) {
    if (!QUIET) console.log('[changelog] Nothing unreleased — the current version describes what is live.');
    process.exit(0);
  }

  if (QUIET && total < NUDGE_AT) process.exit(0);

  // How long has it been sitting there?
  const last = lines
    .slice(nextIdx === -1 ? lines.length : nextIdx)
    .map((l) => l.match(/^## \[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/))
    .find(Boolean);

  let age = '';
  if (last) {
    const days = Math.floor((Date.now() - Date.parse(last[2])) / 86_400_000);
    age =
      days <= 0
        ? ` (${last[1]} was cut today)`
        : ` — ${days} day${days === 1 ? '' : 's'} since ${last[1]} on ${last[2]}`;
  }

  const breakdown = [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(', ');
  const feature = (counts.get('Added') ?? 0) > 0;

  console.log('');
  console.log(`[changelog] ${total} unreleased entr${total === 1 ? 'y' : 'ies'}${age}.`);
  console.log(`[changelog]   ${breakdown}`);
  if (feature) {
    console.log('[changelog]   Includes new functionality, so the next version is at least a MINOR bump.');
  }
  console.log('[changelog]   This does not block the deploy. To cut a version: node scripts/release.mjs --auto');
  console.log('');
} catch {
  // Deliberately silent. See the header: this must never affect a deploy.
}

process.exit(0);
