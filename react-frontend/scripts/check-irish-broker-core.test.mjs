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

test('Irish Broker vetting wording keeps evidence out of NEXUS and records only community decisions', () => {
  const vetting = JSON.stringify(irish.vetting);

  assert.doesNotMatch(vetting, /staitisticí vetála|Pacáiste polasaí|Sonra\?/u);
  assert.doesNotMatch(vetting, /Scéim\(í\)|Nótaí bróicéir príobháideach|torthaí nochta(?:,|")/u);
  assert.doesNotMatch(vetting, /\bClose\b|Athbhreithnigh an toradh|Chuaigh ball i dteagmháil/u);

  assert.equal(irish.vetting.privacy_title, 'Ná uaslódáil doiciméid ghrinnfhiosrúcháin');
  assert.match(irish.vetting.privacy_body, /Ná taifead ach an raon feidhme oibríochtúil agus an cinneadh inmheánach/u);
  assert.match(irish.vetting.privacy_body, /Ná huaslódáil ná greamaigh deimhnithe/u);
  assert.equal(irish.vetting.private_notes_label, 'Nótaí príobháideacha bróicéara');
  assert.match(irish.vetting.private_notes_help, /Ná cuir isteach uimhreacha deimhnithe/u);
  assert.equal(irish.vetting.details_title, 'Sonraí deimhniúcháin — {{name}}');
  assert.equal(irish.vetting.resolution_member_contacted, 'Rinneadh teagmháil leis an mball');
  assert.equal(irish.vetting.attestation_access_ni, 'AccessNI');
});

test('Irish Broker member details describe security actions and balance adjustments accurately', () => {
  const detail = JSON.stringify(irish.member_detail);

  assert.doesNotMatch(detail, /Inbhordáil|Athsheol deimhniú|Ball ceadaithe/u);
  assert.doesNotMatch(detail, /chun creidiúint, uimhir dhiúltach chun dochar|Iarmhéid coigeartaithe/u);

  assert.equal(irish.member_detail.load_failed, 'Níorbh fhéidir an ball a luchtú.');
  assert.equal(irish.member_detail.label_onboarding, 'Ionduchtú');
  assert.equal(irish.member_detail.action_resend_verification, 'Athsheol an ríomhphost deimhnithe');
  assert.equal(irish.member_detail.reset_2fa_success, 'Athshocraíodh an fíordheimhniú défhachtóireach.');
  assert.equal(irish.member_detail.balance_amount_help, 'Úsáid uimhir dhearfach chun creidmheas a chur leis agus uimhir dhiúltach chun é a bhaint.');
  assert.equal(irish.member_detail.timeline_approved, 'Faofa');
});

test('Irish Broker exchange controls preserve approval, rejection, status, and time-credit meaning', () => {
  const exchanges = JSON.stringify(irish.exchanges);

  assert.doesNotMatch(exchanges, /Malartú ceadaithe|Níor aimsíodh aon mhalartuithe/u);
  assert.doesNotMatch(exchanges, /Sonraí Malartaithe|Clib Riosca|Trasna gach stádais/u);
  assert.doesNotMatch(exchanges, /ag teastáil athbhreithniú bróicéara|scuaine malartaithe/u);

  assert.equal(irish.exchanges.title, 'Bainistíocht malartuithe');
  assert.equal(irish.exchanges.approve, 'Faomh');
  assert.equal(irish.exchanges.approved_success, 'Faomhadh an malartú.');
  assert.equal(irish.exchanges.rejected_success, 'Diúltaíodh don mhalartú.');
  assert.equal(irish.exchanges.detail_hours_value, '{{hours}} uair an chloig');
  assert.equal(irish.exchanges.empty_pending_hint, 'Láimhseáladh gach malartú a raibh athbhreithniú bróicéara de dhíth air.');
});
