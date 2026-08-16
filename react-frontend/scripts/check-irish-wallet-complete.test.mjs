// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/wallet.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/wallet.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('complete Irish Wallet catalogue retains only the numeric donation placeholder', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set(['donate_amount_placeholder']);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Wallet key: ${path}`);
    if (invariants.has(path)) assert.equal(irishFlat.get(path), englishValue, path);
    else assert.notEqual(irishFlat.get(path), englishValue, path);
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }
});

test('Irish Wallet preserves transfer, donation, fund, rating, and venue-pass meaning', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /Triail Arís|uair an aimsir|Mo pas ionad|Cuardaigh de réir ball|Tarraingthe Siar|Scipeáil/u);
  assert.equal(irish.history, 'Stair na nIdirbheart');
  assert.equal(irish.donate, 'Bronn');
  assert.equal(irish.donate_to, 'Bronn ar');
  assert.equal(irish.community_fund_withdrawn, 'Aistarraingthe');
  assert.match(irish.validation.max_transfer, /uasmhéid is féidir a aistriú/u);
  assert.equal(irish.venue_pass, 'Mo phas ionaid');
});
