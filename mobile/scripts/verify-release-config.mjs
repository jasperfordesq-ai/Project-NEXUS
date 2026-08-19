// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';

const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const eas = JSON.parse(fs.readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const network = fs.readFileSync(new URL('../android-network-security-config.xml', import.meta.url), 'utf8');

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
assert(app.version === pkg.version, 'app.json and package.json versions must match');
// 🔴 This proves the code is set and past 1 — NOT that it incremented since the last
// release, which is the failure Play actually rejects. Detecting that needs a committed
// record of the last shipped code; tracked as a journey item rather than faked here.
assert(Number.isInteger(app.android?.versionCode) && app.android.versionCode > 1, 'Android versionCode must be incremented');
assert(app.runtimeVersion?.policy === 'appVersion', 'runtimeVersion must use appVersion policy');
assert(app.updates?.enabled === true && app.updates?.checkAutomatically === 'ON_LOAD', 'OTA checks must be enabled on load');
assert(eas.build?.production?.channel === 'production', 'production build must be pinned to production OTA channel');
assert(eas.build?.staging?.channel === 'staging', 'staging build must be pinned to staging OTA channel');
assert(eas.build?.website?.channel === 'website', 'website build must be pinned to website OTA channel');

// 🔴 Every channel a build can be pinned to must have a way to receive an update.
//
// `website` had one and not the other: the APK that docs/DISTRIBUTION.md designates for
// public download was pinned to a channel `scripts/publish-update.mjs` refused to publish
// to, so the intended first public artefact could never be sent a fix. This assertion is the
// thing that would have caught it — a channel with no publisher is a build with no recall.
//
// `preview` is deliberately excluded: it is for internal testers who reinstall, so it is
// exempt by intent rather than by omission.
const publisher = fs.readFileSync(new URL('./publish-update.mjs', import.meta.url), 'utf8');
const publishableChannels = new Set(
  [...publisher.matchAll(/^\s{2}(\w+):\s*'(?:staging|production)',$/gm)].map((m) => m[1])
);
const pinnedChannels = Object.entries(eas.build ?? {})
  .filter(([name, profile]) => profile?.channel && name !== 'preview')
  .map(([, profile]) => profile.channel);
for (const channel of pinnedChannels) {
  assert(
    publishableChannels.has(channel),
    `build channel "${channel}" has no publish path in scripts/publish-update.mjs — a channel ` +
      'that cannot receive an update is a build that cannot be fixed after release'
  );
}
assert(app.plugins?.includes('./plugins/with-android-network-security'), 'Android network security config plugin is required');
assert(!network.includes('trustkit-config'), 'Android config contains an unsupported TrustKit element');
assert((network.match(/<pin digest="SHA-256">/g) ?? []).length >= 2, 'certificate pin set needs primary and backup pins');
const expiry = network.match(/<pin-set expiration="([0-9-]+)"/)?.[1];
assert(Boolean(expiry) && Date.parse(expiry) > Date.now() + 90 * 86400_000, 'certificate pins must remain valid for at least 90 days');
assert(app.android?.intentFilters?.every((filter) => filter.data?.every((entry) => entry.scheme === 'nexus' || (entry.scheme === 'https' && entry.host === 'app.project-nexus.ie'))), 'Android app links must allow only the trusted host or nexus scheme');

if (failures.length) {
  failures.forEach((failure) => console.error(`release gate: ${failure}`));
  process.exit(1);
}
console.log('mobile release configuration verified');
