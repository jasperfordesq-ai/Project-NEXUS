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

test('Irish Cookie Policy retains only reviewed third-party and browser product names', () => {
  const englishFlat = flatten(english.cookies);
  const irishFlat = flatten(irish.cookies);
  const invariants = new Set([
    'provider_sentry',
    'third_party_sentry_label',
    'third_party_pusher_label',
    'browser_chrome',
    'browser_firefox',
    'browser_safari',
    'browser_edge',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Cookie Policy key: ${path}`);
    if (invariants.has(path)) assert.equal(irishFlat.get(path), englishValue, path);
    else assert.notEqual(irishFlat.get(path), englishValue, path);
  }

  const cookies = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(cookies, /Polasai Fianain|Fianain Riiachtanacha|Triiiu Pairtithe|Brúiteoir|browser_edge.*Imeall/u);
  assert.equal(irish.cookies.third_party_pusher_label, 'Pusher');
  assert.equal(irish.cookies.browser_edge, 'Edge');
  assert.match(irish.cookies.manage_warning, /ní bheidh tú in ann logáil isteach/u);
  assert.match(irish.cookies.cookie_sentry_purpose, /Ní sheoltar tomhais luais ná athsheinm seisiúin ach amháin/u);
});

test('Irish Accessibility Statement has complete translated coverage', () => {
  const englishFlat = flatten(english.accessibility);
  const irishFlat = flatten(irish.accessibility);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Accessibility key: ${path}`);
    assert.notEqual(irishFlat.get(path), englishValue, `accessibility.${path}`);
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: accessibility.${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: accessibility.${path}`);
  }
});

test('Irish Accessibility Statement preserves conformance and assistive-technology meaning', () => {
  const accessibility = [...flatten(irish.accessibility).values()].join('\n');
  assert.doesNotMatch(accessibility, /Raitis|Nascleaniiint|Mearclair|Dearadh Freagrach|comhliontach go pairteiach|Sonraiochtai Teicniuila|5 la gno/u);
  assert.equal(irish.accessibility.heading, 'Ráiteas Inrochtaineachta');
  assert.equal(irish.accessibility.feature_keyboard_title, 'Nascleanúint Méarchláir');
  assert.equal(irish.accessibility.conformance_body_2_emphasis, 'comhlíontach go páirteach');
  assert.match(irish.accessibility.conformance_body_2_after, /nach gcomhlíonann roinnt codanna den ábhar/u);
  assert.match(irish.accessibility.feature_responsive_desc, /súmáil suas le 200% gan feidhmiúlacht a chailleadh/u);
  assert.match(irish.accessibility.tech_recommendation, /teicneolaíocht chúnta atá cothrom le dáta/u);
});

test('Irish Legal hub and version history have complete translated coverage', () => {
  for (const section of ['hub', 'version_history']) {
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

test('Irish Legal hub and version history preserve policy and revision meaning', () => {
  const reviewed = [...flatten(irish.hub).values(), ...flatten(irish.version_history).values()].join('\n');
  assert.doesNotMatch(reviewed, /Dli|Comhliontacht|caipeis|Polasai|Tearmai|Leigh|Athrutie|d-athraigh o|athru$/mu);
  assert.equal(irish.hub.doc_privacy_title, 'Beartas Príobháideachais');
  assert.equal(irish.hub.doc_acceptable_use_title, 'Beartas um Úsáid Inghlactha');
  assert.match(irish.hub.doc_trust_safety_desc, /ar an méid nach ndéanaimid/u);
  assert.match(irish.hub.platform_section_desc, /ar leith ó bheartais do phobail/u);
  assert.equal(irish.version_history.summary_of_changes, 'Achoimre ar na hAthruithe');
  assert.equal(irish.version_history.changes_count_one, '{{count}} athrú');
  assert.equal(irish.version_history.changes_count_many, '{{count}} athrú');
});
