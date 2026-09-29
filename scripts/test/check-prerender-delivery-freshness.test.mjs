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

const { judgeFreshness, sameCommit, buildCommitOf, renderAgeHoursFrom } = await import(
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

// ---------------------------------------------------------------------------
// 🔴 2026-09-29: the age that matters is the RENDER age, not the commit age.
//
// The 10:47 deploy of 0225fd5f8 reported 15 of 18 pages FROZEN, "built from
// 0c92f062c4f9, that commit is 25h old". Every one of those snapshots had been
// re-rendered between 4 and 11 hours earlier (home pages ~06:25 on their 6-hour
// TTL, /about ~00:05 in the nightly sweep) — from 0c92f062c, because that was
// the build that was live at the time. Commit age over-states how long a page
// has gone without a refresh by the whole interval between deploys.
// ---------------------------------------------------------------------------

const PREVIOUS_DEPLOY = '0c92f062c4f9';

test('29 Sep false alarm: re-rendered hours ago from a day-old commit is NOT stale', () => {
  // Commit 0c92f062c was 25.2h old at probe time; the page was re-rendered 4.4h ago.
  const cache = new Map([[PREVIOUS_DEPLOY, 25.2]]);
  const verdict = judgeFreshness(PREVIOUS_DEPLOY, DEPLOYED, cache, 4.4);
  assert.equal(verdict.stale, false);
  assert.match(verdict.note, /re-rendered 4\.4h ago/);
});

test('a page nothing has re-rendered beyond the limit is STALE, whatever its commit', () => {
  const cache = new Map([[FROZEN, 68.5]]);
  const verdict = judgeFreshness(FROZEN, DEPLOYED, cache, 68.5);
  assert.equal(verdict.stale, true);
  assert.match(verdict.ageNote, /last re-rendered 68\.5h ago \(limit 24h\)/);
});

test('render age decides even when the commit age is unknown in this checkout', () => {
  // A shallow CI clone cannot resolve an old commit; the render time still can.
  const cache = new Map([['deadbeef1234', null]]);
  assert.equal(judgeFreshness('deadbeef1234', DEPLOYED, cache, 40).stale, true);
  assert.equal(judgeFreshness('deadbeef1234', DEPLOYED, cache, 2).stale, false);
});

test('the deployed build is current regardless of render age', () => {
  const verdict = judgeFreshness(DEPLOYED.slice(0, 12), DEPLOYED, new Map(), 500);
  assert.equal(verdict.stale, false);
  assert.match(verdict.note, /current build/);
});

test('without a usable render time, commit age is still the fallback and says so', () => {
  const cache = new Map([[FROZEN, 68.5]]);
  for (const unknown of [null, undefined, Number.NaN, -1]) {
    const verdict = judgeFreshness(FROZEN, DEPLOYED, cache, unknown);
    assert.equal(verdict.stale, true, `render age ${unknown} must fall back to commit age`);
    assert.match(verdict.ageNote, /judged by commit age/);
  }
});

test('Last-Modified is read as hours since the snapshot was rendered', () => {
  const now = Date.parse('2026-09-29T11:05:00Z');
  const age = renderAgeHoursFrom('Tue, 29 Sep 2026 06:26:17 GMT', now);
  assert.ok(Math.abs(age - 4.645) < 0.01, String(age));
  assert.equal(renderAgeHoursFrom('Tue, 29 Sep 2026 11:05:00 GMT', now), 0);
  // A few minutes of clock skew is tolerated as "just now".
  assert.equal(renderAgeHoursFrom('Tue, 29 Sep 2026 11:08:00 GMT', now), 0);
});

test('an absent, garbled or far-future Last-Modified is unknown, never fresh', () => {
  const now = Date.parse('2026-09-29T11:05:00Z');
  assert.equal(renderAgeHoursFrom(null, now), null);
  assert.equal(renderAgeHoursFrom(undefined, now), null);
  assert.equal(renderAgeHoursFrom('', now), null);
  assert.equal(renderAgeHoursFrom('not a date', now), null);
  assert.equal(renderAgeHoursFrom('Wed, 30 Sep 2026 11:05:00 GMT', now), null);
});

test('importing the module does not run the probe', () => {
  // The import at the top of this file completed without making a network
  // request or calling process.exit(); reaching here proves the guard holds.
  assert.ok(true);
});
