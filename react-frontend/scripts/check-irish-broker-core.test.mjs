// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/broker.json', import.meta.url)));

test('Irish Broker navigation uses safeguarding, moderation, and approval terminology accurately', () => {
  const shell = JSON.stringify({ sidebar: irish.sidebar, nav: irish.nav, breadcrumbs: irish.breadcrumbs });

  assert.doesNotMatch(shell, /Moderation|Faomhaí Meaitseála|Roghanna coimirce/u);
  assert.equal(irish.sidebar.section_moderation, 'Modhnóireacht');
  assert.equal(irish.nav.match_approvals, 'Faomhadh meaitseálacha');
  assert.equal(irish.nav.safeguarding_options, 'Roghanna cosanta');
  assert.equal(irish.breadcrumbs.monitoring, 'Monatóireacht úsáideoirí');
});

test('Irish Broker dashboard describes pending work, failures, and activity naturally', () => {
  const dashboard = JSON.stringify(irish.dashboard);

  assert.doesNotMatch(dashboard, /iarratais ar athbhreithniú a chosaint|úsáideoirí monatóireacht/u);
  assert.doesNotMatch(dashboard, /Síniú Isteach Nua|Tiocfaidh faomhaí|\bdais\b/u);
  assert.doesNotMatch(dashboard, /a chuireadh|cliste-meaitseála|\{\{count\}\}[nul] ó shin/u);

  assert.equal(irish.dashboard.new_signups_today, 'Clárúcháin nua inniu');
  assert.equal(irish.dashboard.partial_body, 'Tá fleasc á taispeáint ag cuntar amháin nó níos mó thuas toisc gur theip ar an iarratas bunúsach. Athnuaigh chun triail eile a bhaint as; má fhanann an fhleasc ann, seiceáil logaí an bhróicéara.');
  assert.equal(irish.dashboard.open_items_other, "míreanna ag fanacht le d'athbhreithniú");
  assert.equal(irish.dashboard.links.match_approvals_desc, 'Déan athbhreithniú ar mholtaí meaitseála cliste idir baill agus liostuithe.');
  assert.equal(irish.dashboard.links.messages_desc, 'Déan athbhreithniú ar chóipeanna bróicéara de chomhráite ar cuireadh bratach orthu.');
  assert.equal(irish.dashboard.time_hours_ago_other, '{{count}} uair ó shin');
});

test('Irish Broker member controls preserve approval, suspension, and onboarding meaning', () => {
  const members = JSON.stringify(irish.members);

  assert.doesNotMatch(members, /Ná logáil isteach riamh|Sár-riarachán|Ball\(í\)/u);
  assert.doesNotMatch(members, /Faomhadh roghnaithe|Roghnú soiléir|Gheobhaidh siad/u);
  assert.doesNotMatch(members, /Inbhordáil|\{\{count\}\} [nul] ó shin/u);

  assert.equal(irish.members.tab_never_logged_in, 'Níor logáil isteach riamh');
  assert.equal(irish.members.bulk_approve, 'Faomh na cinn roghnaithe');
  assert.equal(irish.members.confirm_approve_message, 'An bhfuil tú cinnte gur mhaith leat an ball seo a fhaomhadh? Gheobhaidh an ball rochtain iomlán ar an ardán.');
  assert.equal(irish.members.approved_success, 'Faomhadh an ball.');
  assert.equal(irish.members.stat_total, 'Líon iomlán na mball');
  assert.equal(irish.members.empty_onboarding_incomplete_title, 'Chríochnaigh gach duine an t-ionduchtú');
});

test('Irish Broker onboarding and safeguarding wording preserves member progress and recorded arrangements', () => {
  const journey = JSON.stringify({ onboarding: irish.onboarding, safeguarding: irish.safeguarding });

  assert.doesNotMatch(journey, /Inbhordáil|Liostú Ar an gcéad uair|Úsáideoir Athfhillte/u);
  assert.doesNotMatch(journey, /Ceaduithe ar feitheamh|An titim is mó|Gan titim/u);
  assert.doesNotMatch(journey, /Teachtaireachtaí le Bratach|Sannadh Caomhnóirí|logs an bhróicéara/u);

  assert.equal(irish.onboarding.title, 'Ionduchtú');
  assert.equal(irish.onboarding.stage_first_listing, 'An chéad liostú');
  assert.equal(irish.onboarding.pending_approvals, 'Faomhuithe ar feitheamh');
  assert.equal(irish.safeguarding.tab_guardians, 'Sannacháin caomhnóra');
  assert.equal(irish.safeguarding.mark_reviewed, 'Marcáil mar athbhreithnithe');
  assert.equal(irish.safeguarding.no_assignments, 'Níl aon sannachán caomhnóra ann.');
});
