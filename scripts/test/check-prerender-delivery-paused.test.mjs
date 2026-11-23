// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Regression cover for how scripts/check-prerender-delivery.mjs treats a
 * community that is paused for billing.
 *
 * A paused community deliberately answers a crawler 503 with the "paused" page
 * (CommunityPausedPage emits `prerender-status-code` 503), so a search engine
 * comes back later instead of replacing what it holds. The probe counted that
 * as BLANK, the platform-wide "crawlers get nothing" fault: the 22 Nov 2026
 * deploy reported "FAIL — 1 of 30" for the one community paused the day
 * before, and would have on every deploy while any community stayed paused.
 *
 * The probe now reads which communities are paused from the same plan it takes
 * its addresses from. Both halves must agree before a 503 is excused: the plan
 * says the community is paused AND the response is the paused page itself. A
 * bare 503, or the paused page from a community nobody paused, is still a
 * fault — that is what these tests pin.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { pausedOriginsFromPlan, isPausedNotice, verdictFor, originsFromArgs } = await import(
  '../check-prerender-delivery.mjs'
);

const PLAN = {
  tenants: [
    { tenant_id: 1, slug: 'master', host: 'app.project-nexus.net', prefix: '', paused: false, routes: [] },
    { tenant_id: 2, slug: 'hour-timebank', host: 'hour-timebank.ie', prefix: '', paused: false, routes: [] },
    { tenant_id: 13, slug: 'paused-one', host: 'paused-one.example.org', prefix: '', paused: true, routes: [] },
    { tenant_id: 11, slug: 'hub', host: 'hub.example.org', prefix: '', paused: false, routes: [] },
    { tenant_id: 14, slug: 'paused-branch', host: 'hub.example.org', prefix: '/paused-branch', paused: true, routes: [] },
  ],
};

// What a crawler receives from a paused community (shape as production
// answered on 22 Nov 2026: 11,923 bytes, an <h1>, and this meta tag).
const PAUSED_BODY = '<!doctype html><html><head><title>Example is paused</title>'
  + '<meta name="robots" content="noindex, nofollow">'
  + '<meta name="prerender-status-code" content="503">'
  + '<meta name="prerender-header" content="Retry-After: 86400">'
  + '</head><body><div id="root"><h1>Example is paused</h1></div></body></html>';

/** A probe result as probe() builds it. */
function result(over = {}) {
  return {
    status: 200, bytes: 60000, hasH1: true, hasDescription: true, emptyRoot: false,
    isShell: false, real: true, pausedNotice: false, error: null, ...over,
  };
}

const pausedResponse = () => result({
  status: 503, bytes: 11923, hasDescription: false, isShell: true, real: false,
  pausedNotice: isPausedNotice(503, PAUSED_BODY),
});

test('the plan names the paused communities, at the address the engine renders them under', () => {
  assert.deepEqual(pausedOriginsFromPlan(PLAN), [
    'https://paused-one.example.org',
    'https://hub.example.org/paused-branch',
  ]);
});

test('only a real `true` counts as paused, and an older plan with no flag pauses nobody', () => {
  assert.deepEqual(pausedOriginsFromPlan({
    tenants: [
      { host: 'a.example.org', prefix: '', paused: 'false' },
      { host: 'b.example.org', prefix: '', paused: 1 },
      { host: 'c.example.org', prefix: '', paused: 'true' },
      { host: 'd.example.org', prefix: '' },
    ],
  }), []);
  assert.deepEqual(pausedOriginsFromPlan({}), []);
  assert.deepEqual(pausedOriginsFromPlan(null), []);
});

test('an unsafe host or path is never accepted as a paused address', () => {
  assert.deepEqual(pausedOriginsFromPlan({
    tenants: [
      { host: 'evil.example/x', prefix: '', paused: true },
      { host: 'ok.example.org', prefix: '/../etc', paused: true },
    ],
  }), []);
});

test('the paused page is recognised by its 503 status AND its own marker', () => {
  assert.equal(isPausedNotice(503, PAUSED_BODY), true);
  assert.equal(isPausedNotice(503, PAUSED_BODY.replace(/"/g, "'")), true, 'quote style must not matter');
  // A 503 from the web server or a proxy carries no marker: that is an outage.
  assert.equal(isPausedNotice(503, '<html><body><h1>503 Service Unavailable</h1></body></html>'), false);
  // The marker on a page served 200 means the status was NOT applied: a fault.
  assert.equal(isPausedNotice(200, PAUSED_BODY), false);
  // A missing-page marker is a different answer altogether.
  assert.equal(isPausedNotice(503, PAUSED_BODY.replace('content="503"', 'content="404"')), false);
  assert.equal(isPausedNotice(503, ''), false);
  assert.equal(isPausedNotice(503, null), false);
});

test('a paused community answering with the paused page is expected, not blank', () => {
  assert.equal(verdictFor(pausedResponse(), { paused: true }), 'paused');
});

test('the same paused page from a community nobody paused is still a fault', () => {
  assert.equal(verdictFor(pausedResponse(), { paused: false }), 'blank');
  assert.equal(verdictFor(pausedResponse()), 'blank', 'no plan knowledge must mean no excuse');
});

test('a paused community answering a bare 503 is still a fault', () => {
  const outage = result({ status: 503, bytes: 300, hasH1: true, hasDescription: false, isShell: true, real: false });
  assert.equal(verdictFor(outage, { paused: true }), 'blank');
});

test('a paused community serving the empty shell is still a fault', () => {
  const shell = result({ status: 200, bytes: 1950, hasH1: false, hasDescription: false, emptyRoot: true, isShell: true, real: false });
  assert.equal(verdictFor(shell, { paused: true }), 'blank');
});

test('a paused community still serving an earlier real page is judged like any real page', () => {
  // Production, 22 Nov 2026: `/` answered the paused page while `/about` still
  // answered its snapshot from before the pause. That page goes on to the
  // freshness check as usual.
  assert.equal(verdictFor(result(), { paused: true }), 'real');
});

test('every other answer is classified as before', () => {
  assert.equal(verdictFor(result()), 'real');
  assert.equal(verdictFor(result({ real: false, hasDescription: false })), 'seo');
  assert.equal(verdictFor(result({ status: 0, bytes: 0, real: false, error: 'timeout' }), { paused: true }), 'unavailable');
});

test('--from-plan carries the paused addresses alongside the origins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plan-paused-'));
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(PLAN));
  try {
    const chosen = originsFromArgs([`--from-plan=${file}`]);
    assert.equal(chosen.origins.length, 5);
    assert.deepEqual(chosen.paused, ['https://paused-one.example.org', 'https://hub.example.org/paused-branch']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('addresses given by hand carry no paused knowledge', () => {
  assert.deepEqual(originsFromArgs(['paused-one.example.org']).paused, []);
});
