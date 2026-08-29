#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * backfill-release-tags — give the already-published releases the tags they
 * never got.
 *
 * 🔴 Why this exists. CHANGELOG.md ends with fifteen compare links of the form
 * `.../compare/v1.6.1...v1.6.2`. Not one of those tags existed — locally or on
 * the remote — so every link 404'd. The releases were real; the tags were simply
 * never created, because the cut was a manual edit rather than a tool.
 *
 * 🔴 The commit is found from the repository, not guessed from the message.
 * Release commit subjects are inconsistent across the history ("cut v1.6.2",
 * "bump platform version 1.5.9 -> 1.6.0", "cut version 1.5.3"), so matching on
 * them would be unreliable. Instead this walks every commit that touched a file
 * carrying the version, oldest first, and takes the FIRST commit at which that
 * file holds the released value. That commit is by definition the one that cut it.
 *
 * 🔴 `VERSION` alone is not enough for the whole history: the file was only
 * introduced at 1.5.2 (commit e7ae23768). `react-frontend/package.json` carried
 * the version before that, so it is consulted as a fallback, then composer.json.
 *
 * Tags are annotated, created only if absent, and never pushed.
 *
 * Usage:
 *   node scripts/backfill-release-tags.mjs --dry-run
 *   node scripts/backfill-release-tags.mjs
 *
 * Exit codes: 0 done, 1 some release could not be located, 2 could not run.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts });

/**
 * Files that have carried the canonical version, most authoritative first, with
 * how to read the value out of each. VERSION only goes back to 1.5.2.
 */
const VERSION_SOURCES = [
  { file: 'VERSION', read: (t) => t.trim() },
  { file: 'react-frontend/package.json', read: (t) => safeJson(t)?.version ?? null },
  { file: 'composer.json', read: (t) => safeJson(t)?.version ?? null },
];

/**
 * Releases that are documented but have no commit to tag, with the reason.
 * These are NOT failures — they are recorded history that predates the version
 * ever being written into a file.
 */
const UNTAGGABLE = new Map([
  [
    '1.5.0-rc.1',
    'documented retroactively on 2026-05-04 (commit 6284465b6); no commit ever set a version file to it',
  ],
]);

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// version -> the first commit at which a version-carrying file held that value
const introducedAt = new Map();
try {
  for (const source of VERSION_SOURCES) {
    const commits = git(['log', '--format=%H', '--reverse', '--', source.file])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sha of commits) {
      let value;
      try {
        value = source.read(git(['show', `${sha}:${source.file}`]));
      } catch {
        continue; // the file did not exist at that commit
      }
      if (value && !introducedAt.has(value)) introducedAt.set(value, sha);
    }
  }
} catch {
  console.error('backfill-release-tags: not a git repository, or git is unavailable.');
  process.exit(2);
}

const releases = fs
  .readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.match(/^## \[([^\]]+)\](?:\s*-\s*(\S+))?/))
  .filter(Boolean)
  .filter((m) => m[1] !== 'Unreleased')
  .map((m) => ({ version: m[1], date: m[2] ?? null }));

const existingTags = new Set(
  git(['tag', '--list']).split('\n').map((t) => t.trim()).filter(Boolean)
);

const created = [];
const skipped = [];
const unlocatable = [];

for (const { version, date } of releases) {
  const tag = `v${version}`;
  if (existingTags.has(tag)) {
    skipped.push(`${tag} (already exists)`);
    continue;
  }

  const sha = introducedAt.get(version);
  if (!sha) {
    if (UNTAGGABLE.has(version)) {
      skipped.push(`${tag} (not taggable: ${UNTAGGABLE.get(version)})`);
    } else {
      unlocatable.push(version);
    }
    continue;
  }

  if (DRY_RUN) {
    created.push(`${tag} -> ${sha.slice(0, 9)}`);
    continue;
  }

  // Date the tag to the release date so `git tag --sort=creatordate` and any
  // future tooling see the real chronology rather than the backfill run's clock.
  const env = { ...process.env };
  if (date) {
    env.GIT_COMMITTER_DATE = `${date}T12:00:00`;
  }
  git(['tag', '-a', tag, sha, '-m', `Project NEXUS ${tag}`], { env });
  created.push(`${tag} -> ${sha.slice(0, 9)}`);
}

for (const c of created) console.log(`${DRY_RUN ? 'would create' : 'created'}: ${c}`);
for (const s of skipped) console.log(`skipped: ${s}`);

if (unlocatable.length) {
  console.error('');
  console.error('Could not locate a commit for these releases (no commit sets VERSION to them):');
  for (const v of unlocatable) console.error(`- ${v}`);
  console.error('');
  console.error('Tag them by hand once you identify the commit:');
  console.error('  git tag -a vX.Y.Z <sha> -m "Project NEXUS vX.Y.Z"');
}

console.log('');
console.log(
  DRY_RUN
    ? `--dry-run: nothing written (${created.length} tag(s) would be created).`
    : `${created.length} tag(s) created. They are LOCAL until pushed:\n  git push origin --tags`
);

process.exit(unlocatable.length ? 1 : 0);
