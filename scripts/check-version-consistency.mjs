#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const issues = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function addIssue(message) {
  issues.push(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertContains(relativePath, pattern, description) {
  const text = read(relativePath);
  const matches = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);

  if (!matches) {
    addIssue(`${relativePath}: missing ${description}`);
  }
}

function assertAbsent(relativePath, pattern, description) {
  const text = read(relativePath);
  const matches = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);

  if (matches) {
    addIssue(`${relativePath}: ${description}`);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

const version = read('VERSION').trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  addIssue(`VERSION: "${version}" is not a semantic version`);
}

const composerVersion = readJson('composer.json').version;
if (composerVersion !== version) {
  addIssue(`composer.json: version is ${composerVersion}, expected ${version}`);
}

const frontendPackage = readJson('react-frontend/package.json');
const frontendVersion = frontendPackage.version;
if (frontendVersion !== version) {
  addIssue(`react-frontend/package.json: version is ${frontendVersion}, expected ${version}`);
}

const versionEscaped = escapeRegExp(version);

assertContains('config/app.php', `'version' => env('APP_VERSION', '${version}')`, 'config app.version fallback');
assertContains('README.md', new RegExp(`Version ${versionEscaped}\\b`), 'current platform version in README headline');
assertContains('README.md', new RegExp(`Project NEXUS V${versionEscaped}\\b`), 'current Project NEXUS version in README headline');
assertContains('README.md', new RegExp(`version ${versionEscaped}\\b`, 'i'), 'current platform version in README status');
assertContains('CHANGELOG.md', new RegExp(`^## \\[${versionEscaped}\\] - `, 'm'), 'current version changelog section');
assertContains('CHANGELOG.md', `[Unreleased]: https://github.com/jasperfordesq-ai/Project-NEXUS/compare/v${version}...HEAD`, 'Unreleased compare link');
assertContains('react-frontend/src/config/releaseStatus.ts', `Generally Available (v${version})`, 'release status label');

// --- Extended enforcement (added 2026-06-23) ---
// A partial version bump must FAIL here rather than ship a stale reference.
// These cover every remaining place the version is surfaced, including the
// user-visible footer/changelog label (the one that has gone stale before).
assertContains('README.md', `version-${version}-`, 'README version badge');
// releaseStatus.test.ts must DERIVE the version from this file, not restate it.
// It hardcoded `v1.6.2` until 2026-08-28, which meant the frontend suite could
// not tell a correct label from a stale VERSION — the test and the source were
// bumped together and only this script noticed. Now the test reads VERSION
// itself, so the two checks are independent: the test catches the mismatch at
// `npm test` time, and the pair of assertions below stops anyone quietly
// reintroducing a literal and taking that coverage away again.
assertContains(
  'react-frontend/src/config/releaseStatus.test.ts',
  "readFileSync(resolve(REPO_ROOT, 'VERSION'), 'utf8')",
  'releaseStatus test must read the root VERSION file as its source of truth'
);
assertAbsent(
  'react-frontend/src/config/releaseStatus.test.ts',
  /toContain\(\s*['"`]v\d+\.\d+\.\d+/,
  'releaseStatus test asserts a hardcoded version literal; assert against the root VERSION file instead'
);
assertContains('SECURITY.md', new RegExp(`v${versionEscaped}\\b`), 'SECURITY.md supported-version row');
assertContains('docs/ARCHITECTURE.md', `Platform version: ${version}`, 'ARCHITECTURE platform version');
assertContains('app/Services/Enterprise/LoggerService.php', `'${version}'`, 'LoggerService version fallback');
assertContains('app/Services/Enterprise/MetricsService.php', `'${version}'`, 'MetricsService version fallback');
assertContains('.github/ISSUE_TEMPLATE/bug_report.yml', `placeholder: "${version}"`, 'bug-report version placeholder');

// The in-app changelog is a generated, ignored build artifact. Fresh checkouts
// must not require the file to exist, but every dev/build path must regenerate
// it from the canonical root CHANGELOG before Vite serves or bundles the app.
const frontendScripts = frontendPackage.scripts ?? {};
if (frontendScripts['copy-changelog'] !== 'node scripts/copy-changelog.mjs') {
  addIssue('react-frontend/package.json: copy-changelog must run scripts/copy-changelog.mjs');
}
for (const hook of ['predev', 'prebuild']) {
  const command = frontendScripts[hook];
  if (typeof command !== 'string' || !command.includes('copy-changelog')) {
    addIssue(`react-frontend/package.json: ${hook} must regenerate the bundled changelog`);
  }
}
assertContains('react-frontend/.gitignore', /^public\/changelog\.md$/m, 'ignore rule for the generated changelog bundle');

// The visible footer + changelog-chip label is driven by the per-language
// `release_stage` translation key — enforce all installed locale files.
const localesRoot = path.join(root, 'react-frontend/public/locales');
if (fs.existsSync(localesRoot)) {
  for (const lang of fs.readdirSync(localesRoot).sort()) {
    for (const ns of ['common.json', 'public.json']) {
      const rel = toPosix(path.join('react-frontend/public/locales', lang, ns));
      if (!fs.existsSync(path.join(root, rel))) continue;
      let data;
      try {
        data = JSON.parse(read(rel));
      } catch {
        addIssue(`${rel}: invalid JSON`);
        continue;
      }
      const label = data.release_stage;
      if (typeof label !== 'string') {
        addIssue(`${rel}: missing release_stage label`);
      } else if (!label.includes(version)) {
        addIssue(`${rel}: release_stage "${label}" does not contain version ${version}`);
      }
    }
  }
}

// resources.d.ts mirrors the en locale; every release_stage value must carry the version.
{
  const rel = 'react-frontend/src/resources.d.ts';
  if (fs.existsSync(path.join(root, rel))) {
    const text = read(rel);
    const re = /"release_stage":\s*"([^"]*)"/g;
    let match;
    let found = false;
    while ((match = re.exec(text)) !== null) {
      found = true;
      if (!match[1].includes(version)) {
        addIssue(`${rel}: release_stage "${match[1]}" does not contain version ${version}`);
      }
    }
    if (!found) addIssue(`${rel}: no release_stage entries found`);
  }
}

const changelog = read('CHANGELOG.md');
const bundledChangelogPath = path.join(root, 'react-frontend/public/changelog.md');
if (fs.existsSync(bundledChangelogPath)) {
  const bundledChangelog = read('react-frontend/public/changelog.md');
  if (changelog !== bundledChangelog) {
    addIssue('react-frontend/public/changelog.md: does not match root CHANGELOG.md; run npm --prefix react-frontend run copy-changelog');
  }
}

const publicCollateralFiles = [
  'README.md',
  ...walk(path.join(root, 'docs-public'))
    .filter((file) => ['.md', '.html'].includes(path.extname(file).toLowerCase()))
    .map((file) => toPosix(path.relative(root, file))),
];

const staleCurrentVersionPatterns = [
  /\bProject NEXUS V(\d+\.\d+\.\d+)\b/g,
  /\bWhat's Inside V(\d+\.\d+\.\d+)\b/g,
  /\bV(\d+\.\d+\.\d+) ships\b/g,
  /\bavailable in V(\d+\.\d+\.\d+)\b/g,
  /\bv(\d+\.\d+\.\d+)\. For the most current implementation\b/g,
  /\*\*Version:\*\* (\d+\.\d+\.\d+)\b/g,
  /\bV(\d+\.\d+\.\d+) today\b/g,
];

for (const relativePath of publicCollateralFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) continue;
  const text = read(relativePath);

  for (const pattern of staleCurrentVersionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] !== version) {
        addIssue(`${relativePath}: current public version token is ${match[1]}, expected ${version}`);
      }
    }
  }
}

if (issues.length > 0) {
  console.error('Version consistency check failed:');
  for (const issue of issues.sort()) {
    console.error(`- ${issue}`);
  }
  console.error('');
  console.error('Update VERSION, composer.json, react-frontend/package.json, README.md, CHANGELOG.md, releaseStatus.ts, and current public collateral together.');
  console.error('Native mobile app versions, legal document versions, API versions, and deployment build IDs are intentionally separate.');
  process.exit(1);
}

console.log(`Version consistency OK (${version}).`);
