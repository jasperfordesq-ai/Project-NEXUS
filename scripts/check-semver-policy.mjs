#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-semver-policy — make "this project adheres to Semantic Versioning" true.
 *
 * 🔴 Why this exists. CHANGELOG.md has claimed adherence to Semantic Versioning
 * since the file was created, and nothing checked it. In practice the version
 * behaved like an odometer: the patch component was incremented by one per
 * release and rolled over at nine, so `1.5.9` was followed by `1.6.0` for no
 * reason connected to the content of the release. Both `1.6.1` and `1.6.2`
 * shipped an `### Added` subsection — new functionality — as PATCH releases.
 * A reader could not infer anything from the number, which is the single thing
 * a version number is for.
 *
 * 🔴 The changelog is the evidence, and the number must agree with it. This
 * checker derives the MINIMUM bump the release content justifies and refuses a
 * bump smaller than that. It cannot derive the bump from the diff, because
 * "breaking" is a statement about consumers, not about lines changed — so a
 * breaking change is declared with an explicit `**BREAKING:**` marker, and the
 * absence of that marker is a claim that nothing broke.
 *
 * 🔴 Ordering, comparison and pre-release precedence use the `semver` package
 * (the npm reference implementation), not string comparison. Hand-rolled
 * comparison gets `1.6.9 < 1.6.10` right and `1.8.0-rc.1 < 1.8.0` wrong.
 *
 * Policy and rationale: docs/VERSIONING.md
 *
 * What is asserted:
 *   1. VERSION is a valid semantic version.
 *   2. The newest changelog release section equals VERSION.
 *   3. Release sections are strictly ordered, newest first, with no duplicates.
 *   4. Release dates are real, not in the future, and do not go backwards.
 *   5. From ENFORCED_FROM onward, every `### ` subsection is one this project
 *      defines. Without this, `### New` or a lower-case `### added` would dodge
 *      the bump rule silently, which is worse than having no rule.
 *   6. From ENFORCED_FROM onward, the bump is at least what the release content
 *      justifies (BREAKING marker ⇒ major; `### Added` ⇒ minor; else patch).
 *   7. Every released version has a compare link, and [Unreleased] compares
 *      against the current version.
 *   8. From ENFORCED_FROM onward, every released version has an annotated tag
 *      `vX.Y.Z` — skipped entirely while the repository has no tags at all,
 *      because the compare links are already known-broken in that state and a
 *      blocking failure would only restate it on every commit.
 *
 * Exit codes: 0 pass, 1 policy violation, 2 could not run.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let semver;
try {
  semver = await import('semver');
} catch {
  console.error('check-semver-policy: the `semver` package is not installed.');
  console.error('Run `npm ci` at the repository root, then try again.');
  process.exit(2);
}
const { valid, gt, diff, parse, lt } = semver.default ?? semver;

// NEXUS_SEMVER_ROOT is a TEST SEAM, used only by
// scripts/test/test-semver-policy-gate.mjs to run this checker against fixture
// files. A gate that has never been shown to fail is not evidence of anything.
const root = process.env.NEXUS_SEMVER_ROOT
  ? path.resolve(process.env.NEXUS_SEMVER_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 🔴 The floor below which this policy is NOT applied.
 *
 * Releases before 1.7.0 predate the policy and do not conform. Their numbers are
 * already published in the changelog, in SECURITY.md and in the running app;
 * renumbering them would corrupt the historical record to no benefit.
 *
 * Lowering this constant is NOT a way to clear a failure. A failure below the
 * floor means a historical section has been edited, which is the one thing the
 * floor is here to notice.
 */
const ENFORCED_FROM = '1.7.0';

const issues = [];
const notes = [];
const fail = (m) => issues.push(m);
const note = (m) => notes.push(m);

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ---------------------------------------------------------------- 1. VERSION
const version = read('VERSION').trim();
if (!valid(version)) {
  console.error(`check-semver-policy: VERSION "${version}" is not a valid semantic version.`);
  console.error('Expected MAJOR.MINOR.PATCH, optionally with a pre-release suffix (see docs/VERSIONING.md).');
  process.exit(1);
}

// ------------------------------------------------------ 2. parse the changelog
const changelogLines = read('CHANGELOG.md').split(/\r?\n/);

/** @type {{version:string,date:string|null,line:number,body:string[]}[]} */
const sections = [];
let current = null;
for (let i = 0; i < changelogLines.length; i++) {
  const line = changelogLines[i];
  const heading = line.match(/^## \[([^\]]+)\](?:\s*-\s*(\S+))?/);
  if (heading) {
    if (current) sections.push(current);
    current = { version: heading[1], date: heading[2] ?? null, line: i + 1, body: [] };
    continue;
  }
  if (current) current.body.push(line);
}
if (current) sections.push(current);

const releases = sections.filter((s) => s.version !== 'Unreleased');
if (releases.length === 0) {
  console.error('check-semver-policy: CHANGELOG.md contains no release sections.');
  process.exit(2);
}

for (const r of releases) {
  if (!valid(r.version)) {
    fail(`CHANGELOG.md:${r.line}: "${r.version}" is not a valid semantic version`);
  }
}
if (issues.length) {
  report();
}

// --------------------------------------- 3. newest section must match VERSION
if (releases[0].version !== version) {
  fail(
    `VERSION is ${version} but the newest changelog release section is ${releases[0].version} ` +
      `(CHANGELOG.md:${releases[0].line}). Cut the release with scripts/release.mjs so both move together.`
  );
}

// -------------------------------------------- 4. strict ordering, no duplicates
const seen = new Map();
for (const r of releases) {
  if (seen.has(r.version)) {
    fail(`CHANGELOG.md:${r.line}: ${r.version} appears twice (also at line ${seen.get(r.version)})`);
  }
  seen.set(r.version, r.line);
}
for (let i = 0; i < releases.length - 1; i++) {
  const newer = releases[i];
  const older = releases[i + 1];
  if (!gt(newer.version, older.version)) {
    fail(
      `CHANGELOG.md:${newer.line}: ${newer.version} is listed above ${older.version} but is not greater than it; ` +
        'release sections must run newest first'
    );
  }
}

// ------------------------------------------------------------------- 5. dates
const today = new Date().toISOString().slice(0, 10);
for (const r of releases) {
  if (!r.date) {
    fail(`CHANGELOG.md:${r.line}: release ${r.version} has no date; expected "## [${r.version}] - YYYY-MM-DD"`);
    continue;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) {
    fail(`CHANGELOG.md:${r.line}: release ${r.version} has an invalid date "${r.date}"`);
    continue;
  }
  if (r.date > today) {
    fail(`CHANGELOG.md:${r.line}: release ${r.version} is dated ${r.date}, which is in the future`);
  }
}
for (let i = 0; i < releases.length - 1; i++) {
  const newer = releases[i];
  const older = releases[i + 1];
  if (newer.date && older.date && newer.date < older.date) {
    fail(
      `CHANGELOG.md:${newer.line}: ${newer.version} is dated ${newer.date}, earlier than ` +
        `${older.version} (${older.date}) below it`
    );
  }
}

// ------------------------------------------- 6. the bump must match the content
const RANK = { patch: 0, minor: 1, major: 2 };

/**
 * The subsection vocabulary. Keep a Changelog's six, plus `Internal`.
 *
 * 🔴 `Internal` exists because this changelog documents developer tooling — CI
 * gates, test harnesses, release scripts — alongside member-facing work. Filing
 * a new CI gate under `### Added` would force a MINOR bump for something no
 * consumer can observe, and if every release does that, MINOR stops meaning
 * "new functionality" and the number goes back to carrying no information.
 * `Internal` is therefore excluded from bump derivation.
 *
 * 🔴 The obvious abuse is filing a real feature under `Internal` to dodge a
 * MINOR bump. No checker can detect that; it is a review question. The test is
 * whether any consumer named in docs/VERSIONING.md could observe the change.
 */
const ALLOWED_SUBSECTIONS = new Set([
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
  'Internal',
]);

// Headings used by releases predating the policy. Accepted below the floor only.
const LEGACY_SUBSECTIONS = new Set(['Notes', 'Documentation']);

for (const rel of releases) {
  if (lt(rel.version, ENFORCED_FROM)) continue;

  rel.body.forEach((line, i) => {
    const m = line.match(/^###\s+(.*?)\s*$/);
    if (!m) return;
    if (ALLOWED_SUBSECTIONS.has(m[1])) return;
    const legacy = LEGACY_SUBSECTIONS.has(m[1]) ? ' (retired heading — re-file these entries)' : '';
    fail(
      `CHANGELOG.md:${rel.line + i + 1}: "### ${m[1]}" is not a recognised subsection${legacy}. ` +
        `Use one of: ${[...ALLOWED_SUBSECTIONS].join(', ')}. See docs/VERSIONING.md.`
    );
  });

  // 🔴 An entry that sits above every heading belongs to no category, so the
  // bump derivation cannot see it. That is precisely how 1.7.0 came to hold
  // fifteen new features while deriving as a PATCH: forty-four of its
  // forty-seven entries were floating.
  const firstHeading = rel.body.findIndex((l) => /^###\s/.test(l));
  const floating = rel.body
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => /^- /.test(l) && (firstHeading === -1 || i < firstHeading));
  if (floating.length) {
    fail(
      `CHANGELOG.md:${rel.line + floating[0].i + 1}: ${floating.length} entr${floating.length === 1 ? 'y is' : 'ies are'} ` +
        `in release ${rel.version} above any "### " subsection, so they belong to no category and cannot affect the ` +
        'bump. File each under Added / Changed / Deprecated / Removed / Fixed / Security / Internal.'
    );
  }
}

/** The minimum bump the section's own content justifies. */
function requiredBump(section) {
  const body = section.body;

  const breaking = body.findIndex((l) => /\*\*BREAKING:?\*\*/.test(l));
  if (breaking !== -1) {
    return { level: 'major', because: `an entry marked **BREAKING:** (CHANGELOG.md:${section.line + breaking + 1})` };
  }

  // `### Added` only counts when it actually carries an entry — an empty
  // subsection left behind by an edit must not force a minor bump.
  for (let i = 0; i < body.length; i++) {
    if (!/^###\s+Added\s*$/.test(body[i])) continue;
    for (let j = i + 1; j < body.length; j++) {
      if (/^###\s/.test(body[j])) break;
      if (/^- /.test(body[j])) {
        return { level: 'minor', because: `an "### Added" entry (CHANGELOG.md:${section.line + j + 1})` };
      }
    }
  }

  return { level: 'patch', because: 'only fixes, security, changes, removals or notes' };
}

/** semver.diff returns premajor/preminor/prepatch/prerelease for pre-release moves. */
function normaliseDiff(d) {
  if (!d) return null;
  if (d === 'prerelease') return 'patch';
  return d.startsWith('pre') ? d.slice(3) : d;
}

for (let i = 0; i < releases.length - 1; i++) {
  const rel = releases[i];
  const prev = releases[i + 1];

  if (lt(rel.version, ENFORCED_FROM)) continue;

  const actual = normaliseDiff(diff(prev.version, rel.version));
  if (!actual) {
    fail(`CHANGELOG.md:${rel.line}: cannot determine the bump from ${prev.version} to ${rel.version}`);
    continue;
  }

  const required = requiredBump(rel);

  if (RANK[actual] < RANK[required.level]) {
    fail(
      `CHANGELOG.md:${rel.line}: ${prev.version} → ${rel.version} is a ${actual.toUpperCase()} bump, but the release ` +
        `contains ${required.because}, which requires at least a ${required.level.toUpperCase()} bump. ` +
        'See docs/VERSIONING.md.'
    );
  } else if (RANK[actual] > RANK[required.level]) {
    note(
      `${prev.version} → ${rel.version} is a ${actual.toUpperCase()} bump where the content justifies ` +
        `${required.level.toUpperCase()} (${required.because}). Permitted, but the number then says more than the release does.`
    );
  }

  // A pre-1.0.0 project may bump minor for breaking changes; this project is
  // past 1.0.0, so the exemption does not apply and is deliberately not offered.
  const parsed = parse(rel.version);
  if (parsed.major === 0) {
    note(`${rel.version} is a 0.x version; the policy in docs/VERSIONING.md assumes a stable 1.x+ line.`);
  }
}

// --------------------------------------------------------- 7. compare links
const changelogText = changelogLines.join('\n');
const unreleasedLink = changelogText.match(/^\[Unreleased\]:\s*(\S+)$/m);
if (!unreleasedLink) {
  fail('CHANGELOG.md: the [Unreleased] compare link is missing');
} else if (!unreleasedLink[1].endsWith(`/compare/v${version}...HEAD`)) {
  fail(
    `CHANGELOG.md: the [Unreleased] compare link should end with "/compare/v${version}...HEAD"; ` +
      `found "${unreleasedLink[1]}"`
  );
}
for (const r of releases) {
  const linkRe = new RegExp(`^\\[${r.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:\\s*\\S+$`, 'm');
  if (!linkRe.test(changelogText)) {
    fail(`CHANGELOG.md: release ${r.version} has no compare link at the foot of the file`);
  }
}

// ----------------------------------------------------------------- 8. tags
let tags = null;
try {
  tags = new Set(
    execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
  );
} catch {
  note('git is unavailable, so release tags were not checked.');
}

if (tags) {
  if (tags.size === 0) {
    note(
      'No release tags exist in this repository, so tag coverage was not enforced. ' +
        'Until tags are pushed, every compare link in CHANGELOG.md resolves to a 404. ' +
        'Create them with scripts/release.mjs (new releases) or scripts/backfill-release-tags.mjs (history), then push them.'
    );
  } else {
    for (const r of releases) {
      if (lt(r.version, ENFORCED_FROM)) continue;
      if (!tags.has(`v${r.version}`)) {
        fail(
          `release ${r.version} has no git tag "v${r.version}"; its compare link cannot resolve. ` +
            'Tag the commit that cut it and push the tag.'
        );
      }
    }
    const untagged = releases.filter((r) => lt(r.version, ENFORCED_FROM) && !tags.has(`v${r.version}`));
    if (untagged.length) {
      note(
        `${untagged.length} historical release(s) below the ${ENFORCED_FROM} enforcement floor have no tag ` +
          `(${untagged.map((r) => r.version).join(', ')}); their compare links 404.`
      );
    }
  }
}

report();

function report() {
  for (const n of notes) console.log(`note: ${n}`);

  if (issues.length > 0) {
    console.error('');
    console.error('Semantic versioning policy check failed:');
    for (const issue of issues.sort()) console.error(`- ${issue}`);
    console.error('');
    console.error('The rules, and how to choose a version, are in docs/VERSIONING.md.');
    console.error('Cut releases with `node scripts/release.mjs` so the version and the changelog move together.');
    process.exit(1);
  }

  console.log(
    `Semantic versioning policy OK (${version}; ${releases.length} releases, ` +
      `${releases.filter((r) => !lt(r.version, ENFORCED_FROM)).length} under enforcement).`
  );
}
