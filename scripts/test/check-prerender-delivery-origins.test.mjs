// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Regression cover for where scripts/check-prerender-delivery.mjs gets its
 * addresses. Until 2026-10-22 deploy.sh probed only a hand-kept list in
 * deploy.env. When Minehead's custom domain was removed the community moved to
 * uk.timebank.global/west-somerset, but the list still named
 * minehead-and-coast.timebank.global, so the deploy reported it BLANK; the same
 * list had never contained bridgwater.timebank.global. The probe now reads the
 * prerender engine's own plan (`prerender:plan-routes`), which reads the
 * tenants table.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { originsFromPlan, compareOriginLists, originsFromArgs } = await import('../check-prerender-delivery.mjs');

// Shape and values as production answered on 2026-10-22 (routes omitted).
const PLAN = {
  tenants: [
    { tenant_id: 1, slug: 'master', host: 'app.project-nexus.ie', prefix: '', routes: [] },
    { tenant_id: 2, slug: 'hour-timebank', host: 'hour-timebank.ie', prefix: '', routes: [] },
    { tenant_id: 11, slug: 'timebanking-org', host: 'uk.timebank.global', prefix: '', routes: [] },
    { tenant_id: 14, slug: 'west-somerset', host: 'uk.timebank.global', prefix: '/west-somerset', routes: [] },
    { tenant_id: 17, slug: 'bridgwater-time-bank', host: 'bridgwater.timebank.global', prefix: '', routes: [] },
  ],
};

test('every community is probed at the host and path the engine renders it under', () => {
  assert.deepEqual(originsFromPlan(PLAN), [
    'https://app.project-nexus.ie',
    'https://hour-timebank.ie',
    'https://uk.timebank.global',
    'https://uk.timebank.global/west-somerset',
    'https://bridgwater.timebank.global',
  ]);
});

test('a removed custom domain is not probed, because the plan no longer has it', () => {
  assert.ok(!originsFromPlan(PLAN).some((o) => o.includes('minehead-and-coast')));
});

test('duplicates collapse and unsafe hosts or paths are dropped, never turned into URLs', () => {
  const origins = originsFromPlan({
    tenants: [
      { host: 'hour-timebank.ie', prefix: '' },
      { host: 'HOUR-TIMEBANK.IE', prefix: '/' },
      { host: 'evil.example/x', prefix: '' },
      { host: 'localhost', prefix: '' },
      { host: 'ok.example.org', prefix: '/a b' },
      { host: 'ok.example.org', prefix: '/../etc' },
      { host: '', prefix: '/x' },
    ],
  });
  assert.deepEqual(origins, ['https://hour-timebank.ie']);
});

test('a plan with no tenants array yields no origins (the caller then reports UNAVAILABLE)', () => {
  assert.deepEqual(originsFromPlan({}), []);
  assert.deepEqual(originsFromPlan(null), []);
});

test('the stale hand-kept list is named, both ways', () => {
  const hand = ['https://hour-timebank.ie', 'https://minehead-and-coast.timebank.global'];
  const { noLongerLive, missingFromList } = compareOriginLists(hand, originsFromPlan(PLAN));
  assert.deepEqual(noLongerLive, ['https://minehead-and-coast.timebank.global']);
  assert.ok(missingFromList.includes('https://bridgwater.timebank.global'));
  assert.ok(missingFromList.includes('https://uk.timebank.global/west-somerset'));
});

test('--from-plan reads artisan output even with noise around the JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-plan-'));
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, `\r\nWARN something\r\n${JSON.stringify(PLAN)}\r\nConnection closed.\r\n`);
  try {
    const chosen = originsFromArgs([`--from-plan=${file}`]);
    assert.equal(chosen.source, 'plan');
    assert.equal(chosen.origins.length, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit origins still win over the hand-kept list', () => {
  const chosen = originsFromArgs(['bridgwater.timebank.global']);
  assert.equal(chosen.source, 'args');
  assert.deepEqual(chosen.origins, ['https://bridgwater.timebank.global']);
});
