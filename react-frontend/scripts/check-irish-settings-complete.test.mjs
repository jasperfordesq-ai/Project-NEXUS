// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/settings.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/settings.json', import.meta.url)));

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

test('complete Irish Settings catalogue retains only reviewed product names and input literals', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'twofa_app_google',
    'twofa_app_authy',
    'profile.phone_placeholder',
    'delete_modal.placeholder',
    'sub_accounts.email_placeholder',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Settings key: ${path}`);
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

test('complete Irish Settings catalogue excludes reviewed machine-translation defects', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /8 gcarachtar|Údar|thar do cheann|Mona|Iompaigh ceamara/u);
  assert.doesNotMatch(allIrish, /Uaslod|sabh|Proifil|Cod neamhbhaili|Ni feidir|amhain/u);
  assert.doesNotMatch(allIrish, /Match Preferences|Méid Clófhoirne|imeallíní|scrollaigh ar fud/u);
  assert.equal(irish.appearance_prefs.font_small, 'Beag');
  assert.equal(irish.appearance_prefs.font_medium, 'Meánach');
  assert.equal(irish.appearance_prefs.font_large, 'Mór');
  assert.equal(irish.password.show_current, 'Taispeáin an pasfhocal reatha');
});
