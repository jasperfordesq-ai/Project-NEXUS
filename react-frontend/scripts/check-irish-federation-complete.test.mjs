// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/federation.json', import.meta.url)));

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
