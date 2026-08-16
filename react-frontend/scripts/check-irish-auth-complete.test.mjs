// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/auth.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/auth.json', import.meta.url)));

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

test('complete Irish React Auth catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'forgot_password.email_placeholder',
    'login.email_placeholder',
    'login.twofa_backup_placeholder',
    'login.twofa_code_placeholder',
    'register.email_placeholder',
    'register.password_tip_weak_example',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Auth key: ${path}`);
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
  assert.doesNotMatch(allIrish, /e\.g\.|Acme Corp|(?:^|\n)Doe(?:\n|$)|osclaíonn láthair/u);
  assert.doesNotMatch(allIrish, /Pas-eochair|pas-eochair|Logail|Focal faire|Caillte rochtain/u);
  assert.doesNotMatch(allIrish, /Dramhaíola|r-phost|Seol Nasc Athshocraigh|treoracha athshocrú/u);
  assert.doesNotMatch(allIrish, /dhá-chéim|dháfhachtóir|ní mór do do chuntas|Thart ar 2-5/u);

  assert.equal(irish.register.phone_placeholder, 'm.sh. +1 555 123 4567');
  assert.equal(irish.register.waitlist_body, "Seolfaimid ríomhphost chugat nuair a bheidh áit ar fáil. Go raibh maith agat as d'fhoighne!");
  assert.equal(irish.login.passkey_login, 'Sínigh isteach le paseochair');
  assert.equal(irish.login_meta_title, 'Sínigh Isteach');
  assert.equal(irish.page_meta.verify_identity.title, 'Fíoraigh Aitheantas');
});
