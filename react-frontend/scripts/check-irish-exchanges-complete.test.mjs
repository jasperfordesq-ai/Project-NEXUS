// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/exchanges.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/exchanges.json', import.meta.url)));

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

test('complete Irish Exchanges catalogue retains only the numeric preparation placeholder', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set(['request.prep_time_placeholder']);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Exchanges key: ${path}`);
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

test('Irish Exchanges preserves confirmation, time-credit, approval, and cancellation meaning', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /\{\{count\}\}h|Malartú Iarratas|Sonraí Malartú|Uaireanta Dearbhaithe/u);
  assert.match(irish.tabs.needs_confirmation, /Deimhniú/u);
  assert.match(irish.detail.confirmed_hours, /Deimhníodh/u);
  assert.match(irish.request.broker_approval_description, /sula bhféadfaidh .* dul ar aghaidh/u);
  assert.match(irish.modal.cancel_description, /Ní féidir .* a chealú ina dhiaidh sin/u);
  assert.equal(irish.page_meta.request.title, 'Iarr malartú');
});
