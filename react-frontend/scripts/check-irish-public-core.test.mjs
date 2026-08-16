// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/public.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/public.json', import.meta.url)));

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

test('reviewed Irish public journeys stay context-aware', () => {
  const text = JSON.stringify(irish);

  assert.doesNotMatch(text, /polasaí iomlán um nochtadh|Aon leathanach cóirithe|póirseáil/u);
  assert.doesNotMatch(text, /Logáil Isteach Dhá-Fhachtóir agus Pasfhocail|eochracha pasanna WebAuthn/u);
  assert.doesNotMatch(text, /Preab postmharc|ritheann jabanna|Sleamhnáil trí liostaí/u);
  assert.doesNotMatch(text, /páirtnéireacht, comhpháirtíochta|suiteáil aon sconna|app shábháil/u);
  assert.doesNotMatch(text, /níos réidh le scrollú agus sconna|agus sconna "Cuir le Scáileán Baile"/u);

  assert.equal(irish.home.stats.active_listings, 'Liostálacha Gníomhacha');
  assert.equal(irish.home.audience_cards.defaults.exchange.cta, 'Brabhsáil Liostálacha');
  assert.equal(irish.faq.categories.getting_started.q3.step4_bold, 'Cruthaigh iarraidh');
  assert.equal(
    irish.features_page.groups.trust_reputation_and_safety.items.two_factor_and_passkeys.title,
    'Fíordheimhniú Dhá Fhachtóir agus Paseochracha',
  );
  assert.match(irish.features_page.groups.built_for_production.items.email_webhook_processing.description, /Postmark/u);
});

test('every non-feature Public value is reviewed, translated or language-neutral', () => {
  const { features_page: _englishFeatures, ...englishJourneys } = english;
  const { features_page: _irishFeatures, ...irishJourneys } = irish;
  const englishFlat = flatten(englishJourneys);
  const irishFlat = flatten(irishJourneys);
  const invariants = new Set([
    'contact.form.email_placeholder',
    'faq.categories.account_privacy.q2.answer_link_after',
    'install_app.steps_tab_android',
    'install_app.steps_tab_windows',
    'install_app.steps_tab_mac',
  ]);
  const spacedFragments = new Set([
    'faq.categories.time_credits.q3.answer_link_before',
    'faq.categories.time_credits.q3.answer_link_after',
    'faq.categories.badges_rewards.q3.answer_before_link',
    'faq.categories.account_privacy.q1.answer_before_link',
    'faq.categories.account_privacy.q1.answer_after_link',
    'faq.categories.account_privacy.q2.answer_link_before',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Public journey key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    if (!spacedFragments.has(path)) {
      assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    }
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }

  const journeyText = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(journeyText, /uair amháin cabhrach|uair amháin seirbhíse|uair amháin san am/u);
  assert.doesNotMatch(journeyText, /Loga athrú|tar éis Leagan Séimeantach|stór foinsí poiblí/u);
  assert.doesNotMatch(journeyText, /rogha an diúltaithe|Liostaí a chruthú|Uaireanta deonacha a logáil/u);
  assert.doesNotMatch(journeyText, /Bunathóirí|app shábháil|awkward ar Apple|Fós bhfostú|siúlfaimid tríd tú/u);
  assert.doesNotMatch(journeyText, /Beartaíonn|sconna|"Add"|Suiteáil app|siopa app/u);
});

test('the complete Public feature inventory is reviewed', () => {
  const featureSlice = (catalogue) => catalogue.features_page;
  const englishFlat = flatten(featureSlice(english));
  const irishFlat = flatten(featureSlice(irish));
  const invariants = new Set([
    'security_email',
    'tech_stack.backend_value',
    'tech_stack.database_value',
    'tech_stack.realtime_value',
    'tech_stack.search_value',
    'groups.trust_reputation_and_safety.items.crm.title',
  ]);
  const spacedFragments = new Set(['security_body_before', 'security_body_after']);

  assert.equal(englishFlat.size, 316);
  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Public feature key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    if (!spacedFragments.has(path)) {
      assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    }
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }

  const text = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(text, /Téacs-leabú OpenAI-3-beag|Android-réidh le scaoileadh|ag caint leis an API/u);
  assert.doesNotMatch(text, /próifílí a thógáil|iompar ar iompar|prótacal sreangach|ar bhonn rogha/u);
  assert.doesNotMatch(text, /comhtháthú nithiúil ar an tábla|cónascadh a dhéanamh linn|níl aon rud ar siúl/u);
  assert.doesNotMatch(text, /Tógtha, tástáladh|casta air do do chomhphobal|Ná taispeáin ach/u);
  assert.doesNotMatch(text, /Eispéireas baill|Fógraí seirbhísí|Modúl aicmithe|Mórmhalartuithe/u);
  assert.doesNotMatch(text, /foláirimh phost sábháilte|foghníomhartha|Foghníomhartha|Cúpóin Cheannaithe/u);
  assert.doesNotMatch(text, /clárú do cheann|á gcruthú in aghaidh an chomhphobail|cruthú státchiste/u);
  assert.doesNotMatch(text, /Cóipchirt|Cothú leads|Dromchla poiblí|Sraitheanna Iontaoibhe/u);
  assert.doesNotMatch(text, /sraithe Iontaofa|uaireanta logáilte|imní chosanta a ardú|fuascailte/u);
  assert.doesNotMatch(text, /Síntiúis, síntiúis|Iarratais sonraí|Pictiúir Playwright|bot amháin/u);
  assert.doesNotMatch(text, /monatóireacht poist cron|cíocrach ar chuimhne|cruth na ceiste|scuabtar/u);
  assert.doesNotMatch(text, /API Páirtí|do cibé duine|sa Eilvéis|a chur ar a chosa/u);
  assert.doesNotMatch(text, /Oideas Sóisialta|Cosán bainistithe|tarchur foirmiúil|Creat Oidis/u);
  assert.doesNotMatch(text, /NexusScór|ábhair fhógartha|caoinfhulaingt clóscríofa|per tionónta/u);
});
