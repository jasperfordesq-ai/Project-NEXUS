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
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);
process.exit(result.status ?? 1);
