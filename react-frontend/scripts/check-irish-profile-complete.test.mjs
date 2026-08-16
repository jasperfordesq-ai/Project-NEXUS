// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/profile.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/profile.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('complete Irish Profile catalogue retains only reviewed product and functional values', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'aria.listing_card',
    'review_modal.rating_required',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Profile key: ${path}`);
    if (invariants.has(path)) assert.equal(irishFlat.get(path), englishValue, path);
    else assert.notEqual(irishFlat.get(path), englishValue, path);
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Profile preserves identity, connection, availability, blocking, and listing meaning', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /bitheolaíocht|Infáilteacht|Triail Arís|lodail|proifile|Éachtai|a bhalbhú|Ní bheidh sé in ann|Mo pas ionad/u);
  assert.equal(irish.about.no_bio, 'Níl aon chur síos curtha leis go fóill.');
  assert.equal(irish.connect, 'Ceangail');
  assert.match(irish.block_modal_description, /an duine seo/u);
  assert.match(irish.identity_verified_lock, /fíoraíodh d’aitheantas/u);
  assert.equal(irish.aria.user_availability, 'Infhaighteacht an úsáideora');
  assert.equal(irish.unblock_user, 'Bain an Cosc den Úsáideoir');
});
