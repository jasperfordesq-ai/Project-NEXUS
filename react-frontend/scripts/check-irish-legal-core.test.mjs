// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/legal.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/legal.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('Irish Terms and Privacy core has complete translated coverage', () => {
  for (const section of ['terms', 'privacy']) {
    const englishFlat = flatten(english[section]);
    const irishFlat = flatten(irish[section]);
    for (const [path, englishValue] of englishFlat) {
      assert.ok(irishFlat.has(path), `Missing Irish Legal ${section} key: ${path}`);
      assert.notEqual(irishFlat.get(path), englishValue, `${section}.${path}`);
    }
    for (const [path, value] of irishFlat) {
      assert.equal(value, value.trim(), `Whitespace defect: ${section}.${path}`);
      assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${section}.${path}`);
    }
  }
});

test('Irish Terms preserves prohibited conduct, account security, and liability meaning', () => {
  const terms = [...flatten(irish.terms).values()].join('\n');
  assert.doesNotMatch(terms, /Tearmai|Seirbhise|ideallaiocht|Turstail|Pearsantaiocht bhreige|dintiuir logala|Sabhailteacht|Gniomhaiochtai/u);
  assert.equal(irish.terms.prohibited_harassment, 'Ciapadh nó idirdhealú');
  assert.equal(irish.terms.prohibited_impersonation, 'Aithris a dhéanamh ar dhuine eile');
  assert.match(irish.terms.account_security_desc, /dhintiúir logála isteach faoi rún agus slán/u);
  assert.match(irish.terms.liability_hold_harmless, /a shaoradh ó aon éilimh/u);
});

test('Irish Privacy preserves data purposes, GDPR rights, and safeguarding boundaries', () => {
  const privacy = [...flatten(irish.privacy).values()].join('\n');
  assert.doesNotMatch(privacy, /Polasai|Priobhaideachta|Bailiuchdn|dtredhearcarcht|Leas Dilsiuil|Faisneais Ghleo|Coinneiail Sonrai/u);
  assert.equal(irish.privacy.page_title, 'Beartas Príobháideachais');
  assert.equal(irish.privacy.data_device_basis, 'Leas Dlisteanach');
  assert.match(irish.privacy.right_restrict_desc, /fad atá ábhar imní á réiteach/u);
  assert.match(irish.privacy.safeguarding_data_body, /Ní thaifeadann bróicéir údaraithe ach cinneadh an phobail/u);
});
