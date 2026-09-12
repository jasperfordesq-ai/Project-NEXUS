// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Publish an over-the-air update to one release channel.
 *
 * 🔴 `website` was missing, and it is the channel that matters most. `eas.json` defines four
 * channels — preview, staging, website, production — but this script accepted only staging
 * and production. `website` is the profile behind the APK that
 * `docs/DISTRIBUTION.md` designates for public download, and with Play submission not yet
 * configured it is the ONLY route by which the app can currently reach a member. So the
 * intended first public artefact was the one build that could never be sent a fix.
 *
 * Nothing caught it: `verify-release-config.mjs` checked channel pinning for staging and
 * production only. It now checks website too.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Channel → EAS environment.
 *
 * Declared as a map rather than reusing the channel name, because they are not the same
 * concept and for `website` they genuinely differ: a public download build reads PRODUCTION
 * variables (real API host, real keys) while publishing to its own channel, so that its
 * release cadence stays independent of the Play build.
 *
 * 🔴 `staging` → `staging` is pre-existing behaviour, carried forward unchanged. No EAS
 * profile in eas.json declares an `environment`, so whether a custom environment of that
 * name exists is a property of the EAS project rather than this repo — not verified here,
 * and not changed here either.
 */
const CHANNEL_ENVIRONMENTS = {
  staging: 'staging',
  website: 'production',
  production: 'production',
};

/**
 * Channels whose publication needs a deliberate human act.
 *
 * `website` is gated like production because it reaches the public, not because it is the
 * store build. Its own variable keeps the two decisions separate — approving a store OTA
 * should not silently also approve a public-download OTA.
 */
const APPROVAL_ENV_VARS = {
  production: 'NEXUS_APPROVE_PRODUCTION_OTA',
  website: 'NEXUS_APPROVE_WEBSITE_OTA',
};

const channel = process.argv[2];
const channels = Object.keys(CHANNEL_ENVIRONMENTS);
if (!channels.includes(channel)) {
  console.error(`Usage: node scripts/publish-update.mjs <${channels.join('|')}>`);
  process.exit(64);
}

const approvalVar = APPROVAL_ENV_VARS[channel];
if (approvalVar && process.env[approvalVar] !== 'yes') {
  console.error(
    `Publishing to "${channel}" reaches real members and requires ${approvalVar}=yes ` +
      'after verifying the same commit on staging.'
  );
  process.exit(77);
}

const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
// Public channels must ship from main; staging may ship from a branch under test.
const requiresMain = channel === 'production' || channel === 'website';
if (status.status !== 0 || status.stdout.trim() || (requiresMain && branch.stdout.trim() !== 'main')) {
  console.error(
    'OTA publication requires a clean worktree; production and website also require main.'
  );
  process.exit(1);
}

const sha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

/**
 * 🔴 An update can only replace JavaScript. If anything native differs between the
 * build members have installed and the code about to be published, the update
 * service will still serve it (the runtime version is derived from `expo.version`,
 * which nobody is forced to bump) and the app fails on the next cold start.
 *
 * That very nearly happened on 2026-09-12: the store build was on Expo SDK 54 with
 * expo-av; `main` was on SDK 55 with expo-audio and expo-video, at the same
 * `expo.version`. `live-store-build.json` records the commit the live build came
 * from; the surface of that commit is compared with the working tree here, and a
 * public channel is refused on any difference. The remedy is a new store build —
 * there is deliberately no override.
 */
if (requiresMain) {
  const { nativeSurface, nativeSurfaceDifferences } = await import('./native-surface-lib.cjs');
  const record = JSON.parse(readFileSync(new URL('../live-store-build.json', import.meta.url), 'utf8'));
  const liveCommit = record.android.commit;
  const show = (file) => {
    const out = spawnSync('git', ['show', `${liveCommit}:mobile/${file}`], { encoding: 'utf8' });
    if (out.status !== 0) {
      console.error(`Cannot read mobile/${file} at the live store build's commit ${liveCommit}: ${out.stderr.trim()}`);
      process.exit(1);
    }
    return JSON.parse(out.stdout);
  };
  const live = nativeSurface(show('package.json'), show('app.json'));
  const candidate = nativeSurface(
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
    JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'))
  );
  const differences = nativeSurfaceDifferences(live, candidate);
  if (differences.length > 0) {
    console.error(
      `REFUSED: the native surface differs from the store build members have installed ` +
        `(version code ${record.android.versionCode}, commit ${liveCommit.slice(0, 9)}). ` +
        'An over-the-air update cannot deliver this; ship a new store build, then update live-store-build.json.'
    );
    for (const difference of differences) console.error(`  - ${difference}`);
    process.exit(78);
  }
}

/**
 * 🔴 On Windows this runs through a shell (`npx` is a .cmd), and `spawnSync` with
 * `shell: true` joins the arguments with spaces WITHOUT quoting them. The message
 * `NEXUS <sha>` therefore reached eas-cli as two arguments and the very first
 * production publish (2026-09-10) died with "Unexpected argument: d912a62f8…" before
 * anything was uploaded. Every argument is quoted when a shell is in the way; on a
 * POSIX host there is no shell and the array is passed through untouched.
 */
const useShell = process.platform === 'win32';
const quoteForShell = (value) => (useShell ? `"${String(value).replace(/"/g, '\\"')}"` : value);
const result = spawnSync(
  'npx',
  [
    'eas-cli@latest',
    'update',
    '--channel',
    channel,
    '--message',
    `NEXUS ${sha}`,
    '--environment',
    CHANNEL_ENVIRONMENTS[channel],
    '--non-interactive',
  ].map(quoteForShell),
  {
    stdio: 'inherit',
    shell: useShell,
  }
);
process.exit(result.status ?? 1);
