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

test('Irish platform-provider Legal documents have complete translated coverage', () => {
  for (const section of ['platform', 'platform_disclaimer', 'platform_privacy', 'platform_terms']) {
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

test('Irish platform-provider Legal documents preserve authority and policy boundaries', () => {
  assert.match(irish.platform.provider_notice_body, /ar leith ó aon téarmaí.*\{\{tenant\}\}/u);
  assert.match(irish.platform.authoritative_notice_body, /is é an téacs Béarla atá i réim/u);
  assert.match(irish.platform.cta_body, /faoi bheartais do phobail/u);
  assert.equal(irish.platform_disclaimer.sections['no-advice'], 'Gan Comhairle Dlí, Airgeadais ná Rialála');
  assert.equal(irish.platform_privacy.sections['controller-processor'], 'Rialaitheoir Sonraí agus Próiseálaí Sonraí');
  assert.equal(irish.platform_privacy.sections['your-rights'], 'Do Chearta faoi RGCS');
  assert.equal(irish.platform_terms.sections['operator-responsibilities'], 'Freagrachtaí an Oibreora');
  assert.equal(irish.platform_terms.sections['governing-law'], 'An Dlí is Infheidhme');
});

test('Irish Legal consent, custom-document, FADP, and page metadata have complete translated coverage', () => {
  for (const section of ['gate', 'custom', 'fadp', 'page_meta']) {
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

test('Irish Legal consent and metadata preserve acceptance, data-rights, and safeguarding meaning', () => {
  assert.match(irish.gate.consent_text, /‘Glac’ a chliceáil.*go n-aontaíonn tú leo/u);
  assert.match(irish.gate.subtitle_other_one, /athbhreithniú air agus glac leis/u);
  assert.match(irish.gate.subtitle_other_two, /\{\{count\}\} dhoiciméad.*orthu agus glac leo/u);
  assert.match(irish.fadp.fadp_banner_body, /do thoiliú sainráite.*intleacht shaorga/u);
  assert.equal(irish.fadp.fadp_decline, 'Bain úsáid as bunghnéithe amháin');
  assert.equal(irish.page_meta.platform_privacy.title, 'Beartas Príobháideachais an Ardáin');
  assert.match(irish.page_meta.trust_safety.description, /Treoir shoiléir faoi iontaobhas agus cosaint/u);
});

test('Irish Community Guidelines and Acceptable Use have complete translated coverage', () => {
  for (const section of ['community_guidelines', 'acceptable_use']) {
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

test('Irish conduct policies preserve privacy, safeguarding, fraud, and enforcement meaning', () => {
  const reviewed = [...flatten(irish.community_guidelines).values(), ...flatten(irish.acceptable_use).values()].join('\n');
  assert.doesNotMatch(reviewed, /i mBéarla simplí|Polasaí|Muinín agus Sábháilteacht|maitheasanna|iontráil aisiompaithe|cuntais bhladhrach|chúblálú|seáfála|séideáin fógraíochta|Sláinteachas cuntais|ná ná/u);
  assert.match(irish.community_guidelines.sections.privacy.items['0'], /gan cead soiléir an bhaill sin/u);
  assert.match(irish.community_guidelines.sections.in_person.items['4'], /seirbhísí éigeandála áitiúla ar dtús/u);
  assert.match(irish.community_guidelines.sections.report.body_after, /Ní roinnimid d'aitheantas/u);
  assert.match(irish.acceptable_use.sections.fraud.items['3'], /Ná cúbláil iarmhéideanna creidmheasanna ama/u);
  assert.match(irish.acceptable_use.sections.harm.items['4'], /ábhar gnéasach neamhthoiliúil/u);
  assert.match(irish.acceptable_use.sections.interference.items['4'], /innealtóireacht droim ar ais/u);
  assert.match(irish.acceptable_use.sections.enforcement.appeal, /nach raibh baint aige nó aici leis an mbunchinneadh/u);
});
