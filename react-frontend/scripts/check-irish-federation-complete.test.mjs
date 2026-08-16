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
