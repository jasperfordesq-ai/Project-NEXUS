#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * release — cut a platform release in one atomic, checkable step.
 *
 * 🔴 Why this exists. Cutting a release touches thirty-six files. Done by hand it
 * goes wrong in ways that are individually small and collectively corrosive:
 *
 *   - Entries written above the `## [Unreleased]` heading are outside every
 *     section, so the cut skips them. Nine such entries survived TWO consecutive
 *     releases (1.6.1 and 1.6.2) before anyone noticed, and by then their dates
 *     were eleven days wrong.
 *   - A partial bump leaves the app's "what's new" label disagreeing with
 *     `VERSION`, which `check-version-consistency.mjs` exists to catch after the
 *     fact — this tool stops it happening in the first place.
 *   - No tag gets created, so every compare link in the changelog 404s.
 *
 * 🔴 The bump type is DERIVED FROM THE CHANGELOG and must be confirmed
 * explicitly. The tool will not guess: you pass --major/--minor/--patch, and it
 * refuses anything smaller than the release content justifies. See
 * docs/VERSIONING.md for what justifies what.
 *
 * It never pushes and never deploys. Both stay deliberate, separate acts.
 *
 * Usage:
 *   node scripts/release.mjs --dry-run          # show the plan, write nothing
 *   node scripts/release.mjs --auto             # take the bump the changelog justifies
 *   node scripts/release.mjs --minor            # state the bump yourself
 *   node scripts/release.mjs --patch --no-tag   # cut without tagging
 *
 * --auto takes the MINIMUM justified bump and never more. Choosing to go higher
 * — calling something 2.0.0 because it feels like a milestone — is a claim about
 * significance that only a person can make.
 *
 * Exit codes: 0 done, 1 refused, 2 could not run.
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
  console.error('release: the `semver` package is not installed. Run `npm ci` first.');
  process.exit(2);
}
const { valid, inc, gt } = semver.default ?? semver;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flagValue = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};

const DRY_RUN = has('--dry-run');
const NO_TAG = has('--no-tag');
const NO_COMMIT = has('--no-commit');
const ALLOW_DIRTY = has('--allow-dirty');
const DATE = flagValue('--date') ?? new Date().toISOString().slice(0, 10);

const AUTO = has('--auto');
const explicit = ['major', 'minor', 'patch'].find((l) => has(`--${l}`)) ?? null;

if (AUTO && explicit) {
  console.error(`release: --auto and --${explicit} contradict each other. Pass one or the other.`);
  process.exit(1);
}

const die = (msg, code = 1) => {
  console.error(`release: ${msg}`);
  process.exit(code);
};

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();

// ------------------------------------------------------------------- guards
let branch;
try {
  branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
} catch {
  die('this is not a git repository', 2);
}
if (branch !== 'main') {
  die(`releases are cut on main; you are on "${branch}". See AGENTS.md.`);
}

const dirty = git(['status', '--porcelain']).split('\n').filter((l) => l && !l.startsWith('??'));
if (dirty.length && !ALLOW_DIRTY && !DRY_RUN) {
  console.error('release: the working tree has uncommitted changes:');
  for (const l of dirty.slice(0, 10)) console.error(`  ${l}`);
  if (dirty.length > 10) console.error(`  ... and ${dirty.length - 10} more`);
  console.error('');
  console.error('Commit or set aside your work first. A release commit must contain only the release.');
  console.error('(--allow-dirty overrides this; the release commit still only stages release files.)');
  process.exit(1);
}

// ------------------------------------------------------- read current state
const changelogPath = path.join(root, 'CHANGELOG.md');
const currentVersion = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (!valid(currentVersion)) die(`VERSION "${currentVersion}" is not a valid semantic version`, 2);

const lines = fs.readFileSync(changelogPath, 'utf8').split(/\r?\n/);

// 🔴 Entries written ABOVE the [Unreleased] heading are the failure this tool was
// built after. Refuse rather than silently skipping them, as the manual process did.
const preambleEnd = lines.findIndex((l) => /^---\s*$/.test(l));
const unreleasedIdx = lines.findIndex((l) => /^## \[Unreleased\]/.test(l));
if (unreleasedIdx === -1) die('CHANGELOG.md has no "## [Unreleased]" heading', 2);
if (preambleEnd !== -1 && preambleEnd < unreleasedIdx) {
  const stranded = lines.slice(0, preambleEnd).filter((l) => /^- /.test(l));
  if (stranded.length) {
    console.error(`release: ${stranded.length} changelog entr${stranded.length === 1 ? 'y is' : 'ies are'} above the`);
    console.error('[Unreleased] heading, outside every section. A release cut would skip them.');
    console.error('');
    for (const s of stranded.slice(0, 5)) console.error(`  ${s.slice(0, 100)}`);
    console.error('');
    console.error('Move them under [Unreleased] (or into the release they actually shipped in) first.');
    process.exit(1);
  }
}

const nextHeadingIdx = lines.findIndex((l, i) => i > unreleasedIdx && /^## \[/.test(l));
const unreleasedBody = lines.slice(unreleasedIdx + 1, nextHeadingIdx === -1 ? lines.length : nextHeadingIdx);
const unreleasedEntries = unreleasedBody.filter((l) => /^- /.test(l));

if (unreleasedEntries.length === 0) {
  die('the [Unreleased] section is empty — there is nothing to release.');
}

// --------------------------------------------- what the content justifies
const RANK = { patch: 0, minor: 1, major: 2 };

// Must stay identical to ALLOWED_SUBSECTIONS in scripts/check-semver-policy.mjs.
// An unrecognised heading would dodge the bump rule, so catch it before the cut
// rather than after, when the version is already written into thirty-six files.
const ALLOWED_SUBSECTIONS = new Set([
  'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security', 'Internal',
]);

const badHeadings = unreleasedBody
  .map((l) => l.match(/^###\s+(.*?)\s*$/))
  .filter((m) => m && !ALLOWED_SUBSECTIONS.has(m[1]))
  .map((m) => m[1]);

if (badHeadings.length) {
  console.error('release: [Unreleased] uses subsection headings this project does not define:');
  for (const h of [...new Set(badHeadings)]) console.error(`  ### ${h}`);
  console.error('');
  console.error(`Use one of: ${[...ALLOWED_SUBSECTIONS].join(', ')}. See docs/VERSIONING.md.`);
  console.error('This matters because the bump type is derived from these headings.');
  process.exit(1);
}

// An entry above every heading belongs to no category, so it cannot affect the
// bump. Refuse before the cut rather than shipping an under-numbered release.
const firstHeadingIdx = unreleasedBody.findIndex((l) => /^###\s/.test(l));
const floatingEntries = unreleasedBody.filter(
  (l, i) => /^- /.test(l) && (firstHeadingIdx === -1 || i < firstHeadingIdx)
);
if (floatingEntries.length) {
  console.error(
    `release: ${floatingEntries.length} [Unreleased] entr${floatingEntries.length === 1 ? 'y sits' : 'ies sit'} above any ` +
      '"### " subsection, so they belong to no category.'
  );
  console.error('');
  for (const e of floatingEntries.slice(0, 5)) console.error(`  ${e.slice(0, 100)}`);
  console.error('');
  console.error(`File each under one of: ${[...ALLOWED_SUBSECTIONS].join(', ')}.`);
  console.error('Uncategorised entries derive as PATCH, which is how a release with fifteen new');
  console.error('features once derived as a patch bump. See docs/VERSIONING.md.');
  process.exit(1);
}

function requiredBump(body) {
  if (body.some((l) => /\*\*BREAKING:?\*\*/.test(l))) {
    return { level: 'major', because: 'an entry marked **BREAKING:**' };
  }
  for (let i = 0; i < body.length; i++) {
    if (!/^###\s+Added\s*$/.test(body[i])) continue;
    for (let j = i + 1; j < body.length; j++) {
      if (/^###\s/.test(body[j])) break;
      if (/^- /.test(body[j])) return { level: 'minor', because: 'an "### Added" entry' };
    }
  }
  return { level: 'patch', because: 'no new functionality and no breaking change' };
}

const required = requiredBump(unreleasedBody);

// --auto takes exactly the bump the changelog justifies. It is deliberately the
// MINIMUM and never more: going higher is a claim about significance that only a
// person can make, so automation must not make it on their behalf.
const requested = AUTO ? required.level : explicit;

if (AUTO) {
  console.log(`--auto: the changelog justifies a ${required.level.toUpperCase()} bump (${required.because}).`);
  if (required.level === 'major') {
    console.log('');
    console.log('🔴 This is a MAJOR bump, because an entry is marked **BREAKING:**.');
    console.log('   It tells every consumer that something they depend on has changed.');
    console.log('   If that is not what you meant, stop now and fix the entry.');
    console.log('');
  }
}

if (!requested) {
  console.log(`Current version: ${currentVersion}`);
  console.log(`[Unreleased] holds ${unreleasedEntries.length} entr${unreleasedEntries.length === 1 ? 'y' : 'ies'}.`);
  console.log('');
  console.log(`The content justifies at least a ${required.level.toUpperCase()} bump (${required.because}).`);
  console.log(`That would make the next version ${inc(currentVersion, required.level)}.`);
  console.log('');
  console.log('Re-run with the bump you intend, so the choice is deliberate:');
  console.log(`  node scripts/release.mjs --${required.level}`);
  console.log('');
  console.log('Or take the derived bump without confirming:');
  console.log('  node scripts/release.mjs --auto');
  console.log('');
  console.log('Rules: docs/VERSIONING.md');
  process.exit(1);
}

if (RANK[requested] < RANK[required.level]) {
  console.error(`release: you asked for a ${requested.toUpperCase()} bump, but the [Unreleased] section contains`);
  console.error(`${required.because}, which requires at least a ${required.level.toUpperCase()} bump.`);
  console.error('');
  console.error('Either cut the larger bump, or move the entries that do not belong in this release.');
  console.error('Rules: docs/VERSIONING.md');
  process.exit(1);
}

const nextVersion = inc(currentVersion, requested);
if (!nextVersion || !gt(nextVersion, currentVersion)) {
  die(`could not compute a ${requested} bump from ${currentVersion}`, 2);
}

// ------------------------------------------------- files carrying the version
// Mirrors every assertion in scripts/check-version-consistency.mjs. A new place
// the version appears must be added THERE first, then here.
const versionFiles = [
  'VERSION',
  'composer.json',
  'config/app.php',
  'README.md',
  'SECURITY.md',
  'docs/ARCHITECTURE.md',
  'app/Services/Enterprise/LoggerService.php',
  'app/Services/Enterprise/MetricsService.php',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  'react-frontend/package.json',
  'react-frontend/package-lock.json',
  'react-frontend/src/config/releaseStatus.ts',
  'react-frontend/src/resources.d.ts',
];
const localesDir = path.join(root, 'react-frontend/public/locales');
if (fs.existsSync(localesDir)) {
  for (const lang of fs.readdirSync(localesDir).sort()) {
    for (const ns of ['common.json', 'public.json']) {
      const rel = `react-frontend/public/locales/${lang}/${ns}`;
      if (fs.existsSync(path.join(root, rel))) versionFiles.push(rel);
    }
  }
}

console.log(`Cutting ${currentVersion} → ${nextVersion} (${requested.toUpperCase()}), dated ${DATE}`);
console.log(`  ${unreleasedEntries.length} changelog entries; content justifies ${required.level.toUpperCase()} (${required.because})`);
console.log('');

// ---------------------------------------------------------- rewrite changelog
const newChangelog = (() => {
  const out = [...lines];
  out.splice(unreleasedIdx + 1, 0, '', `## [${nextVersion}] - ${DATE}`);

  const text = out.join('\n');
  const oldLink = new RegExp(`^\\[Unreleased\\]:\\s*(\\S+?)/compare/v${currentVersion.replace(/\./g, '\\.')}\\.\\.\\.HEAD$`, 'm');
  const m = text.match(oldLink);
  if (!m) {
    die('could not find the [Unreleased] compare link to update; fix CHANGELOG.md by hand', 2);
  }
  return text.replace(
    m[0],
    `[Unreleased]: ${m[1]}/compare/v${nextVersion}...HEAD\n[${nextVersion}]: ${m[1]}/compare/v${currentVersion}...v${nextVersion}`
  );
})();

// ----------------------------------------------------------- rewrite versions
const edits = [];
for (const rel of versionFiles) {
  const abs = path.join(root, rel);
  const before = fs.readFileSync(abs, 'utf8');
  const occurrences = before.split(currentVersion).length - 1;
  if (occurrences === 0) continue;
  edits.push({ rel, abs, after: before.split(currentVersion).join(nextVersion), occurrences });
}

for (const e of edits) console.log(`  ${e.rel} (${e.occurrences})`);
console.log(`  CHANGELOG.md (new [${nextVersion}] section)`);
console.log('');

if (DRY_RUN) {
  console.log('--dry-run: nothing written.');
  process.exit(0);
}

fs.writeFileSync(changelogPath, newChangelog);
for (const e of edits) fs.writeFileSync(e.abs, e.after);

// ------------------------------------------------------------- derived output
const run = (cmd, args) => {
  try {
    execFileSync(cmd, args, { cwd: root, stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' });
    return true;
  } catch (err) {
    console.error(err.stdout ?? '');
    console.error(err.stderr ?? '');
    return false;
  }
};

if (!run('npm', ['--prefix', 'react-frontend', 'run', 'copy-changelog'])) {
  die('failed to regenerate the in-app changelog copy', 2);
}

// --------------------------------------------------------------- self-check
let checksPassed = true;
for (const script of ['scripts/check-version-consistency.mjs', 'scripts/check-semver-policy.mjs']) {
  if (!run('node', [script])) {
    console.error(`release: ${script} FAILED after the rewrite.`);
    checksPassed = false;
  }
}
if (!checksPassed) {
  console.error('');
  console.error('The files were written but do not pass their own gates. Inspect the diff before committing.');
  process.exit(1);
}
console.log('Checks passed: version consistency, semver policy.');

// ------------------------------------------------------------ commit and tag
if (NO_COMMIT) {
  console.log('');
  console.log('--no-commit: files written, nothing committed. Tag after you commit, or the tag will point at the wrong commit.');
  process.exit(0);
}

const staged = ['CHANGELOG.md', ...edits.map((e) => e.rel)];
git(['commit', '-m', `chore(release): cut v${nextVersion}`, '--', ...staged]);
console.log(`Committed: chore(release): cut v${nextVersion}`);

if (!NO_TAG) {
  git(['tag', '-a', `v${nextVersion}`, '-m', `Project NEXUS v${nextVersion}`]);
  console.log(`Tagged: v${nextVersion}`);
}

console.log('');
console.log('Nothing has been pushed and nothing has been deployed.');
console.log('When you are ready:');
console.log('  git push origin main');
if (!NO_TAG) console.log(`  git push origin v${nextVersion}`);
