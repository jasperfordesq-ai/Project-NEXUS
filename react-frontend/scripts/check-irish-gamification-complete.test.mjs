// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/gamification.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/gamification.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      flatten(item, path, result);
    } else if (typeof item === 'string') {
      result.set(path, item);
    }
  }
  return result;
}

test('complete Irish React Gamification catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'achievements.xp_value',
    'achievements.badge_detail.threshold_value',
    'achievements.badge_detail.xp_value',
    'goals.modal.target_value_placeholder',
    'leaderboard.type.xp',
    'leaderboard.season.xp_reward',
    'leaderboard.score_unit.hours',
    'leaderboard.score_unit.credits',
    'leaderboard.score_unit.nexus_score',
    'leaderboard.score_unit.xp',
    'journey.xp_value',
    'nexus_score.tier_threshold',
    'nexus_score.max_score_label',
  ]);
  const intentionalSuffixSpaces = new Set(['goals.overdue', 'goals.due']);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Gamification key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    if (intentionalSuffixSpaces.has(path)) {
      assert.match(value, /: $/u, `Missing concatenation space: ${path}`);
      assert.equal(value.trimStart(), value, `Leading whitespace defect: ${path}`);
    } else {
      assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    }
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }

  const allIrish = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(allIrish, /Ni Feidir|Lodo|Gnothachtaithe|Leibheal|Dushláin|Bailiucháin/u);
  assert.doesNotMatch(allIrish, /chomáin tú gníomhaíocht|5-Star|(?:^|\n)Poist(?:\n|$)|Sruthanna/u);
  assert.doesNotMatch(allIrish, /Seiceáil ar ais|Gan fáil|Ceannach Iomlán|Marcáil Iomlán|Nudaigh/u);
  assert.doesNotMatch(allIrish, /Discover|Cadence|Gan deireadh|go míosúil|\{\{days\}\}l/u);
  assert.doesNotMatch(allIrish, /Spotsholas|Is Gníomhaí|Ceangail Nua|Poist Nua|Amlíne Suaitheantas/u);
  assert.doesNotMatch(allIrish, /points to| of \{\{max\}\}|Díríonn \{\{count\}\}|Nuaí|(?:^|\n)Casta(?:\n|$)/u);

  assert.equal(irish.achievements.badge_detail.rarity_epic, 'Eipiciúil');
  assert.equal(irish.frequency.none, 'Gan mhinicíocht');
  assert.equal(irish.goals.action_nudge, 'Tabhair Spreagadh');
  assert.equal(irish.nexus_score.points_to_next, '{{count}} pointe go dtí {{tier}}');
  assert.equal(irish.nexus_score.category_progress_aria, '{{category}}: {{score}} as {{max}}');
});
