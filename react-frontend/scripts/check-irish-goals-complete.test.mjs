// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/goals.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/goals.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('complete Irish Goals catalogue retains only percentage displays', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'checkin.progress_value',
    'insights.milestone_target',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Goals key: ${path}`);
    if (invariants.has(path)) assert.equal(irishFlat.get(path), englishValue, path);
    else assert.notEqual(irishFlat.get(path), englishValue, path);
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Goals consistently describes goals, check-ins, reminders, and cadence', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /cuspóir|cadence|Seiceail|seiceail|meabhruchan|teimplead|uair an aimsir/u);
  assert.match(irish.detail.private_description, /úinéir na sprice/u);
  assert.equal(irish.checkin_recorded, 'Taifeadadh an clárú isteach!');
  assert.equal(irish.frequency.none, 'Gan mhinicíocht');
  assert.match(irish.checkin.progress_help, /barra na sprice agus an amlíne/u);
  assert.equal(irish.insights.action_nudge, 'Seol spreagadh beag');
});
