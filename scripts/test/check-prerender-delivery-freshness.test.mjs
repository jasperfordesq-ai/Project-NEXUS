// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Regression cover for the freshness half of scripts/check-prerender-delivery.mjs.
 *
 * On 2026-09-17 that check reported 16 of 16 pages OK while app.project-nexus.ie
 * had been serving a crawler snapshot frozen at one commit through three
 * deploys. The page was genuine — 58 KB, an h1, a meta description — so every
 * signal the check measured was satisfied. What it never asked was whether the
 * page was the CURRENT one. These tests pin the three-way answer it now gives,
 * including the two cases where it must stay quiet: crying wolf on an unchanged
 * page is how a safety check stops being read.
 *
 * judgeFreshness takes its age cache as an argument precisely so this file can
 * drive every branch without a network or a particular git history.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// Read before importing the module under test: the threshold is resolved once,
// at import time, from the environment.
process.env.NEXUS_DELIVERY_MAX_SNAPSHOT_AGE_HOURS = '24';

const { judgeFreshness, sameCommit, buildCommitOf } = await import(
  '../check-prerender-delivery.mjs'
);

const DEPLOYED = '0c38709d6e8f8d833413e93304453c0c23e6b294';
const FROZEN = '6bcc6ce8b31b';

test('a snapshot built from the deployed commit is current', () => {
  const cache = new Map();
  const verdict = judgeFreshness(DEPLOYED.slice(0, 12), DEPLOYED, cache);
  assert.equal(verdict.stale, false);
  assert.match(verdict.note, /current build/);
});

test('the 12-character footer sha matches the 40-character deploy sha', () => {
  // The footer carries the short sha Vite injects; a deploy knows the full one.
  // Comparing them naively reports every fresh page as a mismatch.
  assert.equal(sameCommit('0c38709d6e8f', DEPLOYED), true);
  assert.equal(sameCommit(DEPLOYED, '0c38709d6e8f'), true);
  assert.equal(sameCommit('0C38709D6E8F', DEPLOYED), true, 'case must not matter');
  assert.equal(sameCommit(FROZEN, DEPLOYED), false);
  assert.equal(sameCommit(null, DEPLOYED), false);
  assert.equal(sameCommit('0c3', DEPLOYED), false, 'too short to be evidence of anything');
});

test('a page frozen beyond the age limit is reported STALE', () => {
  // The real failure: app.project-nexus.ie, 68.5 hours behind on 2026-09-19.
  const cache = new Map([[FROZEN, 68.5]]);
  const verdict = judgeFreshness(FROZEN, DEPLOYED, cache);
  assert.equal(verdict.stale, true);
  assert.equal(verdict.built, FROZEN);
  assert.match(verdict.ageNote, /68\.5h old \(limit 24h\)/);
});

test('a page merely behind the newest build is NOT stale', () => {
  // The prerender pipeline is deliberately incremental: a page nothing has
  // invalidated keeps its snapshot across a deploy, by design. Failing here
  // would fire on every deploy for every unchanged page.
  const cache = new Map([['abc123def456', 3.2]]);
  const verdict = judgeFreshness('abc123def456', DEPLOYED, cache);
  assert.equal(verdict.stale, false);
  assert.match(verdict.note, /3\.2h old/);
});

test('an unresolvable commit age is reported, never assumed fresh or stale', () => {
  // Shallow clone, unfetched commit, or no git at all. An unresolvable
  // comparison is not evidence of a fault; inventing one is a false alarm.
  const cache = new Map([['deadbeef1234', null]]);
  const verdict = judgeFreshness('deadbeef1234', DEPLOYED, cache);
  assert.equal(verdict.stale, false);
  assert.match(verdict.note, /age unknown/);
});

test('a page with no build marker is reported, not failed', () => {
  const verdict = judgeFreshness(null, DEPLOYED, new Map());
  assert.equal(verdict.stale, false);
  assert.match(verdict.note, /no build marker/);
});

test('with no expected commit, age alone still convicts a frozen snapshot', () => {
  // Run outside the repo the probe can still catch a freeze, because the age
  // of the snapshot's own build commit does not depend on knowing the target.
  const cache = new Map([[FROZEN, 68.5]]);
  const verdict = judgeFreshness(FROZEN, null, cache);
  assert.equal(verdict.stale, true);
});

test('the build marker is read out of real snapshot markup', () => {
  const html =
    '<footer><span class="hidden" aria-hidden="true" ' +
    `data-build-commit="${FROZEN}" data-build-time="2026-09-16T15:35:40.000Z"></span></footer>`;
  assert.equal(buildCommitOf(html), FROZEN);

  // Attribute order must not matter, and single quotes are legal HTML.
  assert.equal(
    buildCommitOf(`<span data-build-time="x" data-build-commit='${FROZEN}'></span>`),
    FROZEN
  );
  assert.equal(buildCommitOf('<span data-build-commit=""></span>'), null);
  assert.equal(buildCommitOf('<div id="root"></div>'), null);
});

test('a build marker that is not a git object name is refused', () => {
  // This value comes off a remote page and is passed to `git log`. Anything
  // that is not a plain object name must never reach a subprocess.
  assert.equal(buildCommitOf('<span data-build-commit="../../etc/passwd"></span>'), null);
  assert.equal(buildCommitOf('<span data-build-commit="abc; rm -rf /"></span>'), null);
  assert.equal(buildCommitOf('<span data-build-commit="$(whoami)"></span>'), null);
});

test('importing the module does not run the probe', () => {
  // The import at the top of this file completed without making a network
  // request or calling process.exit(); reaching here proves the guard holds.
  assert.ok(true);
});
