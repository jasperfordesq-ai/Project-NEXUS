// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const parity = JSON.parse(read('parity-map.json'));
const problems = [];

const guardian = parity.routes?.['events/:id/guardian-consent'];
if (guardian?.status !== 'out-of-scope') {
  problems.push('events/:id/guardian-consent must remain out-of-scope in both native apps');
}

const careRoutes = Object.entries(parity.routes ?? {})
  .filter(([route]) => route.startsWith('caring-community/'));
if (careRoutes.length === 0) problems.push('no Care in Community route decisions were found');
for (const [route, decision] of careRoutes) {
  if (decision.status !== 'out-of-scope') {
    problems.push(`${route} must remain out-of-scope (found ${decision.status})`);
  }
}
const careAliases = ['wallet/regional-points', 'me/verein-dues', 'me/verein-invitations', 'join/:code'];
for (const route of careAliases) {
  const decision = parity.routes?.[route];
  if (decision?.status !== 'out-of-scope' || !String(decision.reason ?? '').includes('Care in Community')) {
    problems.push(`${route} must remain out-of-scope as part of Care in Community`);
  }
}

const nativeIntent = read('app/+native-intent.ts');
for (const forbidden of ['guardian-consent', 'caring-community']) {
  if (nativeIntent.includes(forbidden)) {
    problems.push(`app/+native-intent.ts must not route ${forbidden}`);
  }
}

const policy = read('docs/STORE_AUDIENCE_POLICY.md');
const requiredPolicyText = [
  '18 and over',
  'Restrict minor access',
  'Override to Higher Age Rating: 18+',
  'Care in Community is not part',
  'service and skill matching',
  'https://support.google.com/googleplay/android-developer/answer/9867159',
  'https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/',
];
for (const text of requiredPolicyText) {
  if (!policy.includes(text)) problems.push(`STORE_AUDIENCE_POLICY.md is missing: ${text}`);
}

const play = read('docs/PLAY_SUBMISSION.md');
if (!play.includes('Target audience: **18 and over**')) {
  problems.push('PLAY_SUBMISSION.md must keep the 18-and-over target-audience answer');
}

const appleAge = read('store-listing/apple/age-rating.md');
for (const text of ['Do not select Made for Kids', 'Override to Higher Age Rating: 18+']) {
  if (!appleAge.includes(text)) problems.push(`Apple age-rating worksheet is missing: ${text}`);
}

if (problems.length > 0) {
  console.error('adults-only native boundary: FAILED');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`adults-only native boundary: OK — guardian consent and ${careRoutes.length} Care in Community routes stay outside native scope.`);
