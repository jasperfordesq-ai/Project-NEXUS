#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { execFileSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const allowMissingBase = args.includes('--allow-missing-base');
const baseRef = baseIndex >= 0 ? args[baseIndex + 1] : null;

function git(argsForGit, options = {}) {
  return execFileSync('git', argsForGit, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.quiet ? 'ignore' : 'pipe'],
  }).trim();
}

function gitList(argsForGit) {
  const output = git(argsForGit, { quiet: true });
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function commitExists(ref) {
  if (!ref) return false;

  try {
    git(['cat-file', '-e', `${ref}^{commit}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function changedFilesFromWorkingTree() {
  return new Set([
    ...gitList(['diff', '--name-only']),
    ...gitList(['diff', '--cached', '--name-only']),
    ...gitList(['ls-files', '--others', '--exclude-standard']),
  ]);
}

function changedFilesFromBase(ref) {
  return new Set(gitList(['diff', '--name-only', `${ref}...HEAD`]));
}

if (process.env.NO_CHANGELOG_NEEDED === '1') {
  console.log('Changelog guard skipped because NO_CHANGELOG_NEEDED=1.');
  process.exit(0);
}

let changedFiles;
if (baseRef) {
  if (!commitExists(baseRef)) {
    const message = `Base ref "${baseRef}" is not available.`;
    if (allowMissingBase) {
      console.warn(`Changelog guard skipped: ${message}`);
      process.exit(0);
    }
    console.error(`Changelog guard failed: ${message}`);
    process.exit(1);
  }

  changedFiles = changedFilesFromBase(baseRef);
} else {
  changedFiles = changedFilesFromWorkingTree();
}

const files = [...changedFiles].filter((file) => file && !file.endsWith('/'));

if (files.length === 0) {
  console.log('Changelog guard OK (no changed files detected).');
  process.exit(0);
}

const changelogFiles = new Set(['CHANGELOG.md', 'react-frontend/public/changelog.md']);
const changelogChanged = files.some((file) => changelogFiles.has(file));

function isReleaseRelevant(file) {
  if (changelogFiles.has(file)) return false;
  if (file === 'VERSION') return true;

  if (/(\.test\.|\.spec\.)/.test(file)) return false;
  if (file.startsWith('tests/') || file.startsWith('e2e/tests/') || file.startsWith('e2e/reports/')) return false;
  if (file.startsWith('.local-docs-archive/')) return false;

  if (
    file === 'README.md'
    || file === 'AGENTS.md'
    || file === 'CONTRIBUTING.md'
    || file === 'composer.json'
    || file === 'composer.lock'
    || file === 'package.json'
    || file === 'package-lock.json'
    || file === 'Dockerfile'
    || file === 'compose.yml'
    // Was compose.prod.yml until 2026-08-09, when the legacy single-color
    // stack was deleted. compose.bluegreen.yml is now the production compose
    // file, so it inherits the "changing this needs a changelog entry" rule.
    || file === 'compose.bluegreen.yml'
  ) {
    return true;
  }

  return [
    '.github/workflows/',
    'accessible-frontend/',
    'app/',
    'bootstrap/',
    'config/',
    'database/',
    'docs/',
    'docs-public/',
    'httpdocs/',
    'migrations/',
    'react-frontend/package.json',
    'react-frontend/package-lock.json',
    'react-frontend/public/locales/',
    'react-frontend/src/',
    'routes/',
    'scripts/',
  ].some((prefix) => file.startsWith(prefix));
}

const relevantFiles = files.filter(isReleaseRelevant);

if (relevantFiles.length === 0) {
  console.log('Changelog guard OK (no release-relevant files changed).');
  process.exit(0);
}

if (!changelogChanged) {
  console.error('Changelog guard failed: release-relevant files changed without CHANGELOG.md.');
  console.error('');
  console.error('Update CHANGELOG.md under [Unreleased], then refresh react-frontend/public/changelog.md with:');
  console.error('  npm --prefix react-frontend run copy-changelog');
  console.error('');
  console.error('Changed release-relevant files:');
  for (const file of relevantFiles.sort()) {
    console.error(`- ${file}`);
  }
  console.error('');
  console.error('For a genuinely internal/no-release-note change, rerun with NO_CHANGELOG_NEEDED=1 and document that decision.');
  process.exit(1);
}

console.log(`Changelog guard OK (${relevantFiles.length} release-relevant changed file${relevantFiles.length === 1 ? '' : 's'}).`);
