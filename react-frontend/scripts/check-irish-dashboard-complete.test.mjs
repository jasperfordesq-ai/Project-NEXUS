// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/dashboard.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/dashboard.json', import.meta.url)));

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

test('complete Irish Dashboard catalogue retains only reviewed display invariants', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'suggestions.score_chip',
    'suggestions.distance_chip',
    'gamification.xp_value',
    'gamification.xp_value_one',
    'gamification.xp_value_other',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Dashboard key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Dashboard preserves listings, matching, activity, and engagement meaning', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /na cluichí go léir|roinnt liosta|roinnt postáil|Tacaíochtaí/u);
  assert.doesNotMatch(allIrish, /Is maith \{\{count\}\}|\{\{count\}\} tuairimí/u);

  assert.equal(irish.meta.title, 'Deais');
  assert.equal(irish.new_listing, 'Liostú nua');
  assert.equal(irish.suggestions.see_all_matches, 'Féach ar na meaitseálacha go léir');
  assert.equal(irish.sections.endorsements, 'Formhuinithe');
  assert.equal(irish.activity.action_listing, '— roinn siad liostú');
  assert.equal(irish.reviews.sent, 'Sheol tú {{amount}}u');
  assert.match(irish.likes_count_one, /Thaitin sé seo/u);
  assert.match(irish.comments_count_one, /trácht/u);
});
