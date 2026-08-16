// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/matches.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/matches.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('complete Irish Matches catalogue retains only distance and percentage displays', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'card.distance_km',
    'preferences.thresholds.distance_value',
    'preferences.thresholds.quality_value',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Matches key: ${path}`);
    if (invariants.has(path)) assert.equal(irishFlat.get(path), englishValue, path);
    else assert.notEqual(irishFlat.get(path), englishValue, path);
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Matches never confuses a match with a game or changes the dismissing person', () => {
  const allIrish = [...flatten(irish).values()].join('\n');
  assert.doesNotMatch(allIrish, /Cluiche|cluiche|Cluichí|cluichí|Meaitseanna|meaitseanna/u);
  assert.doesNotMatch(allIrish, /Níl suim acu ann/u);
  assert.equal(irish.card.dismiss, 'Níl suim agam ann');
  assert.equal(irish.card.mutual, 'Meaitseáil chómhalartach');
  assert.match(irish.preferences.thresholds.quality_label, /meaitseála/u);
});
