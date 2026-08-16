// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/ideation.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/ideation.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('complete Irish Ideation catalogue retains only URL input invariants', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set(['media.url_label', 'media.url_placeholder']);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Ideation key: ${path}`);
    if (invariants.has(path)) assert.equal(irishFlat.get(path), englishValue, path);
    else assert.notEqual(irishFlat.get(path), englishValue, path);
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Ideation preserves challenges, voting, comments, teams, and outcomes', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /Dushsh|dushsh|Votail|votail|Measunu|Dunta|Ceanain|spriocdhata|Uasmheid|Trachtanna|Postail|Cumadóireacht Smaointe|Smaoineamh Buach/u);
  assert.equal(irish.title, 'Dúshláin Smaointeoireachta');
  assert.equal(irish.ideas.unvote, 'Bain an Vóta');
  assert.equal(irish.comments.add_label, 'Cuir trácht leis');
  assert.match(irish.convert_to_group.description, /smaoineamh buaiteach/u);
  assert.equal(irish.campaigns.feature_not_available, 'Níl Smaointeoireacht ar Fáil');
  assert.equal(irish.outcomes.winning_idea, 'Smaoineamh Buaiteach');
});
