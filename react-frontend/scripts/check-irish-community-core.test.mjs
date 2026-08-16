// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/community.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/community.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('Irish credential and shift-swap journeys have complete translated coverage', () => {
  for (const section of ['credentials', 'swaps']) {
    const englishFlat = flatten(english[section]);
    const irishFlat = flatten(irish[section]);
    for (const [path, englishValue] of englishFlat) {
      assert.ok(irishFlat.has(path), `Missing Irish Community ${section} key: ${path}`);
      assert.notEqual(irishFlat.get(path), englishValue, `${section}.${path}`);
    }
  }
});

test('Irish credential and shift-swap journeys preserve verification, global scope, and failure actions', () => {
  const reviewed = [...flatten(irish.credentials).values(), ...flatten(irish.swaps).values()].join('\n');
  assert.doesNotMatch(reviewed, /dintiúr\(í\)|Seiceáil Gardaí|Gach Ceann|Gan iarratais mhalartaithe|Theip ar luchtú dintiúr/u);
  assert.equal(irish.credentials.heading, 'Fíorú Dintiúr');
  assert.equal(irish.credentials.type_police_check, 'Seiceáil Póilíní/Cúlra');
  assert.match(irish.credentials.expiring_soon_desc, /\{\{count\}\} dintiúr.*laistigh de 30 lá/u);
  assert.match(irish.credentials.load_failed, /Bain triail eile as/u);
  assert.equal(irish.swaps.heading, 'Malartuithe Sealanna');
  assert.match(irish.swaps.no_swaps_desc, /leathanach sonraí an tseala/u);
  assert.match(irish.swaps.accept_failed, /Bain triail eile as/u);
  assert.match(irish.swaps.reject_failed, /Bain triail eile as/u);
});
