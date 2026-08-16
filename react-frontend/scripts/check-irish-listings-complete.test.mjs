// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/listings.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/listings.json', import.meta.url)));

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

test('complete Irish React Listings catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'distance_kilometers',
    'distance_meters',
    'form.character_count',
    'form.character_count_one',
    'form.character_count_other',
    'form.hours_placeholder',
    'radius_5',
    'radius_10',
    'radius_25',
    'radius_50',
    'radius_100',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Listings key: ${path}`);
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
  assert.doesNotMatch(allIrish, /e\.g\.,|Baile Átha Cliath|Corcaigh/u);
  assert.doesNotMatch(allIrish, /Cruthaigh Liosta|Liosta Nua|Postáil Liosta|Liosta Gan Aimsiú|Liosta á luchtú/u);
  assert.doesNotMatch(allIrish, /Luchtaigh|luchtú|lodail|liostalacha|seirbhisi|Anailisiocht|In eag/u);
  assert.doesNotMatch(allIrish, /Cleachtóir taithíoch|Bíodh sé saor agat|Roinnt rudaí de dhíth uait/u);
  assert.doesNotMatch(allIrish, /\{\{hours\}\}h|Faoi 1h|1–3h|3-6h/u);

  assert.equal(irish.form.title_placeholder, 'm.sh., Cabhair le garraíodóireacht, Ceachtanna ríomhaireachta...');
  assert.equal(irish.detail_unlike_aria, 'Bain do thaitneamh den liostáil: {{title}}');
  assert.equal(irish.detail_expired_on, "D'imigh sí in éag ar {{date}}");
  assert.equal(irish.featured, 'Faoi Thrácht');
  assert.equal(irish.report_success, 'Tuairisc seolta. Go raibh maith agat as cabhrú lenár bpobal a choinneáil sábháilte.');
});
