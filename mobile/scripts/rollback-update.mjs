// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Take back an over-the-air update.
 *
 * 🔴 Why this exists. Publishing had careful guards (`scripts/publish-update.mjs`);
 * UNDOING a publish had none. `eas update:rollback` existed as a raw CLI command, so the
 * one action you reach for while something is actively broken was the one with no
 * protection against aiming it at the wrong channel. That is exactly backwards: the
 * emergency lever should be the best-labelled control in the room.
 *
 * 🔴 Two DELIBERATE differences from the publisher, both of which look like omissions
 * until you think about when this runs.
 *
 *  1. **No clean-worktree requirement, and no "must be on main".** The publisher demands
 *     both, because it ships YOUR CODE and a dirty tree means shipping something
 *     unreviewed. A rollback ships nothing: it tells EAS to re-point a channel at an
 *     update it already has. Meanwhile the person running it is, by definition, mid-
 *     emergency — quite possibly with a half-written fix in the tree and on a branch.
 *     Refusing them then would be friction with no safety behind it.
 *
 *  2. **Approval is still required for public channels.** A rollback is itself a publish:
 *     it changes what every member's app runs. The friction is one environment variable on
 *     the command line — seconds — and it is what stops a rollback meant for staging
 *     landing on production while someone is under pressure.
 *
 * Usage:
 *   node scripts/rollback-update.mjs staging
 *   NEXUS_APPROVE_PRODUCTION_ROLLBACK=yes node scripts/rollback-update.mjs production
 *   NEXUS_APPROVE_WEBSITE_ROLLBACK=yes node scripts/rollback-update.mjs website
 *
 * Extra arguments are passed through to eas-cli, so `--private-key-path` and friends work.
 */

import { spawnSync } from 'node:child_process';

/**
 * Channels that can be rolled back.
 *
 * 🔴 Kept in step with `CHANNEL_ENVIRONMENTS` in `scripts/publish-update.mjs` by an
 * assertion in `scripts/verify-release-config.mjs`, NOT by importing it. The publisher is
 * a script with top-level side effects — importing it would run a publish — and the
 * verifier reads its source with a regex, so moving the map into a shared module would
 * silently defeat the existing "every channel has a publish path" check. Duplication that
 * is checked is safer here than sharing that breaks a gate.
 *
 * A channel with a publish path and no rollback path is a channel you can break and not
 * unbreak, which is the whole failure this file exists to prevent.
 */
const ROLLBACKABLE_CHANNELS = ['staging', 'website', 'production'];

/**
 * Channels whose rollback needs a deliberate human act, and the variable that says so.
 * Separate variables per channel: approving one is not approving the other.
 */
const APPROVAL_ENV_VARS = {
  production: 'NEXUS_APPROVE_PRODUCTION_ROLLBACK',
  website: 'NEXUS_APPROVE_WEBSITE_ROLLBACK',
};

const [channel, ...passThrough] = process.argv.slice(2);

if (!ROLLBACKABLE_CHANNELS.includes(channel)) {
  console.error(`Usage: node scripts/rollback-update.mjs <${ROLLBACKABLE_CHANNELS.join('|')}> [eas args…]`);
  console.error('');
  console.error('Rolls a channel back to its previous over-the-air update. Ships no code from');
  console.error('this machine, so a dirty worktree and a side branch are both fine — see the');
  console.error('note at the top of this file.');
  process.exit(64);
}

const approvalVar = APPROVAL_ENV_VARS[channel];
if (approvalVar && process.env[approvalVar] !== 'yes') {
  console.error(`Rolling back "${channel}" changes what every member's app runs.`);
  console.error(`Set ${approvalVar}=yes to confirm you mean this channel and not another.`);
  console.error('');
  console.error('If members are on a broken update right now, that is the correct thing to do —');
  console.error('this asks only that the channel is named twice, not that you wait for anything.');
  process.exit(77);
}

console.log(`Rolling back the "${channel}" channel to its previous update…`);
console.log('');
console.log('🔴 A rollback does not delete the bad update; it re-points the channel at the');
console.log('   previous one. Members receive it the same way they received the bad one —');
console.log('   on their next check, applied on the next cold start (or immediately, if they');
console.log('   accept the "Update ready" prompt). It is not instant.');
console.log('');

// Left INTERACTIVE on purpose: eas-cli prints which update it is about to roll back to and
// asks for confirmation. That is a second pair of eyes on the destination at the moment it
// matters, and this is a hand-run emergency tool, not something a pipeline calls.
const result = spawnSync(
  'npx',
  ['eas-cli@latest', 'update:rollback', '--channel', channel, ...passThrough],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);

if (result.status !== 0) {
  console.error('');
  console.error('Rollback did NOT complete. The channel is unchanged — members are still on the');
  console.error('update you were trying to undo. Check the output above before retrying.');
}

process.exit(result.status ?? 1);
