// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/federation.json', import.meta.url)));
const english = JSON.parse(await readFile(new URL('../public/locales/en/federation.json', import.meta.url)));

function flatten(value, prefix = '', result = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, result);
    } else {
      result[path] = child;
    }
  }
  return result;
}

test('Irish Federation hub and partner discovery preserve network and community meaning', () => {
  const journey = JSON.stringify({
    relayUrlBlocked: irish.relay_url_blocked,
    hub: irish.hub,
    partners: irish.partners,
  });

  assert.doesNotMatch(journey, /Cónaidhm faoi Mhíchumas|Ós rud é|Líonra Fás/u);
  assert.doesNotMatch(journey, /Liostaí Cónaidhme|Pobail Chomhpháirtithe|Sonraí Amharc/u);
  assert.doesNotMatch(journey, /baill \{\{count\}\}|Seirbhísí Malartú|comhphobail chomhpháirtíochta/u);

  assert.equal(irish.hub.page_title, 'Mol na Cónaidhme');
  assert.equal(irish.hub.how_it_works_2_title, 'Malartaigh seirbhísí');
  assert.equal(irish.hub.quick_link_3_title, 'Liostuithe na Cónaidhme');
  assert.equal(irish.hub.toast_disabled_title, 'Díchumasaíodh an Chónaidhm');
  assert.equal(irish.hub.member_count_many, '{{count}} mball');
  assert.equal(irish.partners.empty_title, 'Níl aon phobal comhpháirtíochta ann');
  assert.equal(irish.partners.since_date, 'Ó {{date}}');
  assert.equal(irish.partners.permission_listings, 'Liostuithe');
  assert.equal(irish.partners.view_details, 'Féach ar na sonraí');
});

test('Irish Federation connection and onboarding wording preserves consent and status meaning', () => {
  const journey = JSON.stringify({
    connections: irish.connections,
    partnerDetail: irish.partner_detail,
    onboarding: irish.onboarding,
  });

  assert.doesNotMatch(journey, /Uimh Iarratais|\bMeath\b|Ceangal dhiúltaigh/u);
  assert.doesNotMatch(journey, /Sroicheann Seirbhíse|cianda OK|Beidh taisteal/u);
  assert.doesNotMatch(journey, /Faigh Tosaigh|Seirbhísí Malartú|Socrú Cónaidhm/u);

  assert.equal(irish.connections.title, 'Naisc na Cónaidhme');
  assert.equal(irish.connections.decline, 'Diúltaigh');
  assert.equal(irish.connections.rejected_success, 'Diúltaíodh don nasc');
  assert.equal(irish.partner_detail.not_found_heading, 'Níor aimsíodh an comhpháirtí');
  assert.equal(irish.partner_detail.browse_listings, 'Brabhsáil liostuithe');
  assert.equal(irish.onboarding.profile_visibility_description, 'Rialaigh cén fhaisnéis a roinntear le pobail chomhpháirtíochta.');
  assert.equal(irish.onboarding.service_reach, 'Raon seirbhíse');
  assert.equal(irish.onboarding.reach_travel_ok, 'Sásta taisteal');
  assert.equal(irish.onboarding.on, 'Casta air');
  assert.equal(irish.onboarding.off, 'Casta as');
});

test('Irish Federation member and messaging wording preserves opt-in and communication meaning', () => {
  const journey = JSON.stringify({ members: irish.members, messages: irish.messages });

  assert.doesNotMatch(journey, /rogha an diúltaithe|tarraingt isteach|\bCum\b/u);
  assert.doesNotMatch(journey, /cianda OK|Beidh taisteal|Próifíl Amharc/u);
  assert.doesNotMatch(journey, /Cónaidhm Gan Cumasú|Freagra ionchur|\bAthrú\b/u);

  assert.equal(irish.members.title, 'Baill na Cónaidhme');
  assert.equal(irish.members.showing_count, '{{shown}} as {{total}} ball á dtaispeáint');
  assert.equal(irish.members.external_profile_message, 'Tá an ball seo ar ardán comhpháirtíochta seachtrach. Ní féidir a phróifíl a oscailt go díreach.');
  assert.equal(irish.messages.optin_required, 'Ní mór rogha a dhéanamh páirt a ghlacadh sa Chónaidhm');
  assert.match(irish.messages.optin_required_description, /rogha a dhéanamh páirt a ghlacadh/u);
  assert.equal(irish.messages.compose, 'Scríobh');
  assert.equal(irish.messages.auto_translate_tooltip_on, 'Aistriúchán uathoibríoch casta air — cliceáil chun é a mhúchadh');
  assert.equal(irish.messages.aria_delivered, 'Seachadta');
  assert.equal(irish.messages.change, 'Athraigh');
});

test('Irish Federation listings and settings preserve listing, consent, and service-range meaning', () => {
  const journey = JSON.stringify({ listings: irish.listings, settings: irish.settings });

  assert.doesNotMatch(journey, /Liostaí Cónaidhme|Próifíl Amharc|Sroicheann Seirbhíse/u);
  assert.doesNotMatch(journey, /Cónaidhm faoi Mhíchumas|cianda OK|Beidh taisteal/u);
  assert.doesNotMatch(journey, /Cónaidhm Tá|socruithe cónaidhm|Níorbh fhéidir cónaidhm/u);

  assert.equal(irish.listings.title, 'Liostuithe na Cónaidhme');
  assert.equal(irish.listings.no_listings_found, 'Níor aimsíodh aon liostú');
  assert.equal(irish.listings.view_profile, 'Féach ar an bpróifíl');
  assert.equal(irish.settings.heading, 'Socruithe na Cónaidhme');
  assert.equal(irish.settings.federation_disabled, 'Tá an Chónaidhm díchumasaithe');
  assert.equal(irish.settings.service_reach, 'Raon seirbhíse');
  assert.equal(irish.settings.reach_travel_ok, 'Sásta taisteal');
  assert.equal(irish.settings.federation_toggled_description, 'Tá an Chónaidhm {{action}} anois.');
  assert.equal(irish.settings.kilometers_short, 'km');
});

test('Irish Federation events, groups, and member profiles preserve counts and transfer meaning', () => {
  const journey = JSON.stringify({ events: irish.events, groups: irish.groups, profile: irish.member_profile });

  assert.doesNotMatch(journey, /Imeachtaí Cónaidhme|Grúpaí Cónaidhme|ball \{\{count\}\}/u);
  assert.doesNotMatch(journey, /Ball á lódáil|Ball gan aimsiú|Ar ais go Comhaltaí/u);
  assert.doesNotMatch(journey, /hour\(s\) sent|creidmheasa cónasctha|Scileanna & Suimeanna/u);

  assert.equal(irish.events.heading, 'Imeachtaí na Cónaidhme');
  assert.equal(irish.events.attendees_going_other, '{{count}} duine ag dul');
  assert.equal(irish.groups.heading, 'Grúpaí na Cónaidhme');
  assert.equal(irish.groups.member_count_many, '{{count}} mball');
  assert.equal(irish.member_profile.page_title, 'Próifíl baill');
  assert.equal(irish.member_profile.tx_summary, '{{amount}} uair an chloig á seoladh chuig {{name}}');
  assert.equal(irish.member_profile.tx_success_detail, 'Seoladh {{amount}} uair an chloig chuig {{name}}');
  assert.equal(irish.member_profile.transactions_disabled_tooltip, 'Ní ghlacann an ball seo le haistrithe creidmheasa Cónaidhme.');
});

test('Irish Federation reputation, reviews, and opt-in notices preserve trust and consent meaning', () => {
  const journey = JSON.stringify({ reputation: irish.reputation, reviews: irish.reviews, notice: irish.optin_notice });

  assert.doesNotMatch(journey, /comhpháirtíochta \{\{count\}\}|athbhreithnithe \{\{count\}\}/u);
  assert.doesNotMatch(journey, /comhalta cónasctha|Cónaidhm rogha an diúltaithe|rogha an chónaidhm/u);
  assert.doesNotMatch(journey, /Bunú Cónaidhm/u);

  assert.equal(irish.reputation.tooltip_federated_many, 'Clú comhiomlánaithe ó {{count}} bpobal comhpháirtíochta');
  assert.equal(irish.reputation.tooltip_local_one, 'Bunaithe ar {{count}} léirmheas sa phobal seo');
  assert.equal(irish.reputation.aria_label, 'Clú Cónaidhme {{score}}, bunaithe ar {{count}} léirmheas');
  assert.equal(irish.reviews.unavailable, 'Níl léirmheasanna ar fáil don bhall Cónaidhme seo go fóill');
  assert.equal(irish.reviews.rating_label, 'Rátáil {{rating}} as 5');
  assert.equal(irish.optin_notice.cta, 'Socraigh an Chónaidhm');
  assert.match(irish.optin_notice.description, /rogha a dhéanamh páirt a ghlacadh/u);
});

test('the complete Irish Federation catalogue retains only documented functional invariants', () => {
  const englishValues = flatten(english);
  const irishValues = flatten(irish);
  const exactMatches = Object.keys(englishValues)
    .filter((key) => typeof englishValues[key] === 'string' && irishValues[key] === englishValues[key])
    .sort();

  assert.deepEqual(exactMatches, [
    'listings.hours_estimated',
    'onboarding.kilometers_short',
    'reputation.chip_label',
    'reputation.chip_label_one',
    'reputation.chip_label_other',
    'settings.kilometers_short',
  ]);
});
