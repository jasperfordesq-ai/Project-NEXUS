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

test('Irish waitlist and volunteer-wellbeing journeys have complete translated coverage', () => {
  for (const section of ['waitlist', 'wellbeing']) {
    const englishFlat = flatten(english[section]);
    const irishFlat = flatten(irish[section]);
    for (const [path, englishValue] of englishFlat) {
      assert.ok(irishFlat.has(path), `Missing Irish Community ${section} key: ${path}`);
      assert.notEqual(irishFlat.get(path), englishValue, `${section}.${path}`);
    }
  }
});

test('Irish waitlist and wellbeing copy preserves queue position, burnout, and self-care meaning', () => {
  const reviewed = [...flatten(irish.waitlist).values(), ...flatten(irish.wellbeing).values()].join('\n');
  assert.doesNotMatch(reviewed, /Gan iontrálacha liosta feithimh|Folláine Oibrí Dheonaigh|Féinchuirim|Rabhadh Tuirse|Cláraigh Conas Atá Mé|má tá tú sáraithe/u);
  assert.match(irish.waitlist.no_entries_desc, /cuirfear ar an eolas thú nuair a bheidh áit ar fáil/u);
  assert.match(irish.waitlist.leave_confirm, /Caillfidh tú d'áit/u);
  assert.match(irish.waitlist.leave_failed, /Bain triail eile as/u);
  assert.equal(irish.wellbeing.burnout_warning, 'Rabhadh Ídithe');
  assert.match(irish.wellbeing.checkin_desc, /sos a bheith de dhíth ort/u);
  assert.equal(irish.wellbeing.hide_tips, 'Folaigh Leideanna Féinchúraim');
  assert.match(irish.wellbeing.tip_reduce, /má bhraitheann tú faoi léigear/u);
});

test('Irish organisation discovery, registration, and detail journeys have complete translated coverage', () => {
  const invariants = new Map([
    ['organisations.form_email_placeholder', 'contact@yourorg.com'],
    ['organisations.form_website_placeholder', 'https://yourorg.com'],
  ]);

  for (const section of ['organisations', 'organisation_detail']) {
    const englishFlat = flatten(english[section]);
    const irishFlat = flatten(irish[section]);
    for (const [path, englishValue] of englishFlat) {
      const fullPath = `${section}.${path}`;
      assert.ok(irishFlat.has(path), `Missing Irish Community ${fullPath}`);
      if (invariants.has(fullPath)) assert.equal(irishFlat.get(path), englishValue, fullPath);
      else assert.notEqual(irishFlat.get(path), englishValue, fullPath);
    }
  }
});

test('Irish organisation journeys preserve registration, approval, opportunity, and review meaning', () => {
  const reviewed = [...flatten(irish.organisations).values(), ...flatten(irish.organisation_detail).values()].join('\n');
  assert.doesNotMatch(reviewed, /\b(?:Eagras|Eagrais|eagras|eagrais|Rating|Comment)\b|Ni Feidir|Ni bhfuarthas|Nil aon|Téarmaí Cláraithe/u);
  assert.equal(irish.organisations.heading, 'Eagraíochtaí');
  assert.match(irish.organisations.form_success_message, /Faomhfaidh riarthóir í/u);
  assert.match(irish.organisations.pending_approval_notice, /ag fanacht le faomhadh riarthóra/u);
  assert.match(irish.organisations.terms_item_3, /sula gcuirfear ar an liosta poiblí í/u);
  assert.equal(irish.organisations.opportunity_count_many, '{{count}} deis');
  assert.equal(irish.organisation_detail.rating_label, 'Rátáil');
  assert.equal(irish.organisation_detail.comment_label, 'Trácht');
  assert.equal(irish.organisation_detail.review_modal_title, 'Déan léirmheas ar an eagraíocht seo');
  assert.match(irish.organisation_detail.error_load_retry, /Bain triail eile as/u);
});

test('Irish emergency alerts and group sign-ups have complete translated coverage', () => {
  const invariants = new Map([['group_signups.email_placeholder', 'member@example.com']]);
  for (const section of ['emergency_alerts', 'group_signups']) {
    const englishFlat = flatten(english[section]);
    const irishFlat = flatten(irish[section]);
    for (const [path, englishValue] of englishFlat) {
      const fullPath = `${section}.${path}`;
      assert.ok(irishFlat.has(path), `Missing Irish Community ${fullPath}`);
      if (invariants.has(fullPath)) assert.equal(irishFlat.get(path), englishValue, fullPath);
      else assert.notEqual(irishFlat.get(path), englishValue, fullPath);
    }
  }
});

test('Irish emergency and group journeys preserve urgency, invitation, and retry meaning', () => {
  const reviewed = [...flatten(irish.emergency_alerts).values(), ...flatten(irish.group_signups).values()].join('\n');
  assert.doesNotMatch(reviewed, /Bain Triail Eile As|iarratais sealta|CRITICIÚIL|PRÁINNEACH|GNÁTH|Theip ar áirithintí|Gheobhaidh siad/u);
  assert.equal(irish.emergency_alerts.no_alerts_title, 'Níl aon fholáireamh éigeandála ann');
  assert.match(irish.emergency_alerts.load_failed, /Bain triail eile as/u);
  assert.equal(irish.emergency_alerts.expires, 'Dáta éaga: {{date}}');
  assert.match(irish.group_signups.no_signups_desc, /in éineacht le cairde nó baill foirne/u);
  assert.match(irish.group_signups.add_member_desc, /Gheobhaidh an duine cuireadh/u);
  assert.match(irish.group_signups.add_member_failed, /seoladh ríomhphoist a bheith neamhbhailí/u);
});
