// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two reviewed exceptions, and nothing else, may pass this gate.
 *
 * 1. image-size, inherited through Metro/Expo. Build-time parsing of
 *    repository-controlled assets; no patched release; not reachable from member uploads.
 * 2. decode-uri-component, inherited through expo-router -> @react-navigation -> that
 *    query-string@7. 🔴 This one DOES ship in the app bundle and IS attacker-reachable:
 *    Android hands the app every `https://app.project-nexus.ie/*` URL. It is listed here
 *    only because BOTH remedies were tried and refused (audit 2026-09-06, F04):
 *      - npm's own `audit fix --force` proposes expo-router@5.1.11, a DOWNGRADE from the
 *        installed 6.0.24;
 *      - an override to the fixed decode-uri-component@0.5.0 fails because that release is
 *        ESM-only (`"type": "module"`, no `main`) while its consumer query-string@7.1.3 is
 *        CommonJS, so it would break every deep link instead of hardening one. There is no
 *        CJS release of the fix, no query-string 7.1.4, and every @react-navigation/core
 *        7.x up to 7.21.13 still depends on `query-string ^7.1.3`.
 *    What stands in for the patch is a real bound in `app/+native-intent.ts`, which refuses
 *    an over-long path before it can reach the router's query parser. That is why this
 *    script also checks the bound is still there: if the mitigation goes, the exception is
 *    no longer earned and this gate must fail rather than keep waving the advisory through.
 *
 * Re-review both by 2026-09-30, or when Expo ships a major that moves off query-string@7.
 */
const ALLOWED_ADVISORIES = new Set([
  'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq',
  'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
  'https://github.com/advisories/GHSA-vcc3-ghjq-m6fr',
]);

const ALLOWED_AFFECTED_PACKAGES = new Set([
  '@expo/cli',
  '@expo/metro',
  '@expo/metro-config',
  '@react-native/community-cli-plugin',
  '@react-navigation/core',
  '@react-navigation/native',
  'decode-uri-component',
  'expo',
  'expo-router',
  'image-size',
  'metro',
  'metro-config',
  'metro-transform-worker',
  'query-string',
  'react-native',
]);

/** The mitigation the decode-uri-component exception rests on. */
const DEEP_LINK_BOUND_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'app',
  '+native-intent.ts',
);

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

if (missingKnownAdvisories.length > 0 || !packages.has('image-size') || !packages.has('decode-uri-component')) {
  console.error('A reviewed exception changed shape; re-triage it instead of silently accepting it.');
  process.exit(1);
}

// The decode-uri-component exception is only defensible while its mitigation is in place.
let deepLinkSource = '';
try {
  deepLinkSource = fs.readFileSync(DEEP_LINK_BOUND_FILE, 'utf8');
} catch {
  console.error(`Could not read ${DEEP_LINK_BOUND_FILE} to confirm the deep-link bound.`);
  process.exit(1);
}

if (!/MAX_DEEP_LINK_LENGTH/.test(deepLinkSource) || !/path\.length > MAX_DEEP_LINK_LENGTH/.test(deepLinkSource)) {
  console.error(
    'The deep-link length bound in app/+native-intent.ts is gone, so the reachable '
    + 'decode-uri-component advisory (GHSA-vcc3-ghjq-m6fr) is no longer mitigated.',
  );
  process.exit(1);
}

console.warn('Production dependency audit passed with two reviewed exceptions:');
console.warn(
  '  1. Two high-severity image-size denial-of-service advisories inherited through Metro/Expo. '
  + 'Build-time parsing of repository-controlled assets, no patched release, not reachable from member uploads.',
);
console.warn(
  '  2. decode-uri-component (GHSA-vcc3-ghjq-m6fr) via expo-router -> @react-navigation -> query-string@7. '
  + 'This one ships and is deep-link reachable; the only patched release is ESM-only and its consumer is CommonJS, '
  + 'so it is held by the length bound in app/+native-intent.ts, checked above.',
);
console.warn('Re-review both by 2026-09-30, or when Expo ships a major that moves off query-string@7.');
