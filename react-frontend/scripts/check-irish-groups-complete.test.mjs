// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/groups.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/groups.json', import.meta.url)));

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

test('complete Irish React Groups catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'detail.tab_section_label',
    'detail.invite_email_placeholder',
    'challenges.xp_reward',
    'challenges.progress_value',
    'files.folder_chip',
    'files.size_value',
    'files.size_b',
    'files.size_kb',
    'files.size_mb',
    'files.size_gb',
    'files.folder_chip_one',
    'files.folder_chip_other',
    'webhooks.url_placeholder',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Groups key: ${path}`);
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

  const allIrish = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(allIrish, /Teachtaireacht failte|Teimplead|Athroga|Sabhail|shabhail/u);
  assert.doesNotMatch(allIrish, /Bhuail tú leis an ngrúpa|bhaint leis an ngrúpa|an cuaille seo/u);
  assert.doesNotMatch(allIrish, /Freagra Post|(?:^|\n)Anailísí(?:\n|$)|Cairt phíchairt/u);
  assert.doesNotMatch(allIrish, /\{\{days\}\}l|\{\{hours\}\}u|\{\{minutes\}\}n/u);
  assert.doesNotMatch(allIrish, /lodail|grupai|Triail Arís|Sciobairín|Baile Átha Cliath/u);
  assert.equal(irish.recommended.joined, 'Tá tú sa ghrúpa');
  assert.equal(irish.webhooks.delete_confirm, 'An bhfuil fonn ort an ghréasánghríog seo a scriosadh? Ní féidir é seo a chur ar ceal.');
});
