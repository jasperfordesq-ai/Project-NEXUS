// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { spawnSync } from 'node:child_process';

const ALLOWED_ADVISORIES = new Set([
  'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
]);

const ALLOWED_AFFECTED_PACKAGES = new Set([
  '@expo/cli',
  '@expo/metro',
  '@expo/metro-config',
  '@react-native/community-cli-plugin',
  'expo',
  'image-size',
  'metro',
  'metro-config',
  'metro-transform-worker',
  'react-native',
]);

const result = spawnSync('npm audit --omit=dev --json', {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: true,
});

if (!result.stdout) {
  console.error(result.stderr || 'npm audit produced no JSON output.');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('npm audit did not return valid JSON.');
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const packages = new Set(Object.keys(vulnerabilities));
const advisories = new Set();

for (const vulnerability of Object.values(vulnerabilities)) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'object' && via.url) advisories.add(via.url);
  }
}

const unexpectedPackages = [...packages].filter((name) => !ALLOWED_AFFECTED_PACKAGES.has(name));
const unexpectedAdvisories = [...advisories].filter((url) => !ALLOWED_ADVISORIES.has(url));
const missingKnownAdvisories = [...ALLOWED_ADVISORIES].filter((url) => !advisories.has(url));
const criticalCount = report.metadata?.vulnerabilities?.critical ?? 0;

if (criticalCount > 0 || unexpectedPackages.length > 0 || unexpectedAdvisories.length > 0) {
  console.error('Production dependency audit found risk outside the reviewed Metro/image-size exception.');
  if (criticalCount > 0) console.error(`Critical findings: ${criticalCount}`);
  if (unexpectedPackages.length > 0) console.error(`Unexpected packages: ${unexpectedPackages.join(', ')}`);
  if (unexpectedAdvisories.length > 0) console.error(`Unexpected advisories: ${unexpectedAdvisories.join(', ')}`);
  process.exit(1);
}

if (packages.size === 0) {
  console.log('Production dependency audit passed with no vulnerabilities.');
  process.exit(0);
}

if (missingKnownAdvisories.length > 0 || !packages.has('image-size')) {
  console.error('The reviewed exception changed shape; re-triage it instead of silently accepting it.');
  process.exit(1);
}

console.warn(
  'Production dependency audit passed with one reviewed exception: two high-severity image-size denial-of-service advisories inherited through Metro/Expo.',
);
console.warn(
  'They affect build-time parsing of repository-controlled assets, have no patched release, and are not reachable from app user uploads. Re-review by 2026-09-30 or when Expo ships a fix.',
);
