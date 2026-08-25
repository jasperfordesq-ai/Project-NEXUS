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

// 🔴 Crash reports are unreadable without source maps, and the release build FAILS without
// the credentials to upload them. Both halves were once true at the same time: every profile
// set SENTRY_DISABLE_AUTO_UPLOAD, production included, so a shipped app would have reported
// minified stack traces — and nobody would have noticed until the first real crash.
//
// Proven on 2026-08-25, on this machine: with the `nexus-mobile` project created and a token
// present, `:app:bundleRelease` uploads ("Upload type: artifact bundle") and the bundle
// appears in Sentry against release `ie.project.nexus@1.2.0+2`. Without a token it fails at
// `createBundleReleaseJsAndAssets_SentryUpload`.
//
// So: production uploads, and every other profile must NOT — they have no token and would
// fail. If a production build ever fails at that step, the EAS secret SENTRY_AUTH_TOKEN is
// missing; create it rather than re-adding the flag, or crash reports go back to gibberish.
assert(
  eas.build?.production?.env?.SENTRY_DISABLE_AUTO_UPLOAD === undefined,
  'production must upload Sentry source maps — without them crash reports are minified and useless',
);
for (const [name, profile] of Object.entries(eas.build ?? {})) {
  if (name === 'production') continue;
  assert(
    profile?.env?.SENTRY_DISABLE_AUTO_UPLOAD === 'true',
    `build profile "${name}" must disable Sentry source-map upload — it has no credentials and the build fails without them`,
  );
}
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

// 🔴 …and a way to TAKE IT BACK. Publishing had guards; undoing a publish had none, so the
// one control you reach for while something is actively broken was the only one that could
// be aimed at the wrong channel unchecked. A channel you can break and cannot unbreak is
// worse than one you cannot publish to at all, because the damage is already live.
//
// The rollback list is DUPLICATED rather than shared: `publish-update.mjs` is a script with
// top-level side effects (importing it would publish), and this file reads its source with
// the regex above, so moving the map into a shared module would silently defeat the check
// immediately preceding this one. Duplication that is asserted beats sharing that breaks a
// gate — so the assertion is that the two lists agree.
const rollbacker = fs.readFileSync(new URL('./rollback-update.mjs', import.meta.url), 'utf8');
const rollbackableChannels = new Set(
  (rollbacker.match(/const ROLLBACKABLE_CHANNELS = \[([^\]]*)\]/)?.[1] ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
);
for (const channel of pinnedChannels) {
  assert(
    rollbackableChannels.has(channel),
    `build channel "${channel}" has no rollback path in scripts/rollback-update.mjs — a bad ` +
      'update on that channel could not be taken back'
  );
}
for (const channel of publishableChannels) {
  assert(
    rollbackableChannels.has(channel),
    `channel "${channel}" can be published to but not rolled back — the two scripts have ` +
      'drifted apart'
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
