// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/broker.json', import.meta.url)));
const english = JSON.parse(await readFile(new URL('../public/locales/en/broker.json', import.meta.url)));

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

test('Irish Broker message review distinguishes flags, review decisions, and archived records', () => {
  const messages = JSON.stringify(irish.messages);

  assert.doesNotMatch(messages, /comhráite marcáilte|Cúis mharcála|Liostáil ardriosca/u);
  assert.doesNotMatch(messages, /Cartlannaigh taifead|Formheas agus cartlannaigh|Teachtaireacht formheasta/u);
  assert.doesNotMatch(messages, /Rónna marcáilte|Níl aon chóipeanna teachtaireachtaí/u);

  assert.equal(irish.messages.flag_action, 'Cuir bratach uirthi');
  assert.equal(irish.messages.flag_success, 'Cuireadh bratach ar an teachtaireacht.');
  assert.equal(irish.messages.detail_reviewed_at, 'Athbhreithnithe ar');
  assert.equal(irish.messages.detail_archive_record, 'Taifead cartlainne');
  assert.equal(irish.messages.detail_approve_archive, 'Faomh agus cuir sa chartlann');
  assert.equal(irish.messages.copy_reason_high_risk_listing, 'Liostú ardriosca');
  assert.equal(irish.messages.detail_none, '—');
});

test('Irish Broker monitoring wording identifies tracked members and messaging restrictions clearly', () => {
  const monitoring = JSON.stringify(irish.monitoring);

  assert.doesNotMatch(monitoring, /úsáideoirí monatóireachta|a g\(h\)níomhaíocht/u);
  assert.doesNotMatch(monitoring, /Níl aon úsáideoirí|Chuaigh rud éigin mícheart|Triail arís/u);

  assert.equal(irish.monitoring.page_description, 'Coinnigh súil ar bhaill atá faoi mhaoirseacht an bhróicéara.');
  assert.equal(irish.monitoring.current_expiry, 'Dáta éaga reatha: {{date}}');
  assert.equal(irish.monitoring.empty_description, 'Cuir ball leis chun tosú ag déanamh monatóireachta ar ghníomhaíocht an bhaill.');
  assert.equal(irish.monitoring.status_messaging_off, 'Tá teachtaireachtaí díchumasaithe');
  assert.equal(irish.monitoring.retry_button, 'Bain triail eile as');
});

test('Irish Broker risk tags apply fail-closed controls to listings with accurate terminology', () => {
  const riskTags = JSON.stringify(irish.risk_tags);

  assert.doesNotMatch(riskTags, /Clibigh liosta|"Liosta"|iar-ghrinnfhiosrúcháin/u);
  assert.doesNotMatch(riskTags, /fianú an teagmhálaí teachtaireachtaí|Airgeadúil|vetáil/u);
  assert.doesNotMatch(riskTags, /Níl aon liostaí marcáilte|Chuaigh rud éigin mícheart/u);

  assert.equal(irish.risk_tags.tag_listing, 'Cuir clib ar liostú');
  assert.equal(irish.risk_tags.col_approval_req, 'Faomhadh');
  assert.match(irish.risk_tags.legacy_role_vetting_unavailable_description, /fanann sé dúnta go sábháilte/u);
  assert.equal(irish.risk_tags.requires_approval_description, 'Ní mór do bhróicéir malartuithe don liostú seo a fhaomhadh sula leanfar ar aghaidh.');
  assert.equal(irish.risk_tags.level_critical, 'Tromchúiseach');
  assert.equal(irish.risk_tags.id_label, 'ID');
});

test('Irish Broker insurance controls distinguish verification dates, rejection, and expiry', () => {
  const insurance = JSON.stringify(irish.insurance);

  assert.doesNotMatch(insurance, /Teastas árachais (?:cruthaithe|nuashonraithe|scriosta|fíoraithe|diúltaithe)/u);
  assert.doesNotMatch(insurance, /Ag éag go luath|Fíoraithe ag","label_verified_by/u);
  assert.doesNotMatch(insurance, /\{\{days\}\}l|Triail arís/u);

  assert.equal(irish.insurance.create_success, 'Cruthaíodh an teastas árachais.');
  assert.equal(irish.insurance.reject_success, 'Diúltaíodh don teastas árachais.');
  assert.equal(irish.insurance.empty_title, 'Níl aon teastas árachais ann');
  assert.equal(irish.insurance.label_verified_at, 'Fíoraithe ar');
  assert.equal(irish.insurance.label_verified_by, 'Fíoraithe ag');
  assert.equal(irish.insurance.expiry_days_left, '{{days}} lá fágtha');
});

test('Irish Broker archive wording preserves immutable read-only compliance records', () => {
  const archives = JSON.stringify(irish.archives);

  assert.doesNotMatch(archives, /Taifid chomhlíonta léite amháin|Grianghraf/u);
  assert.doesNotMatch(archives, /Cinneadh ag|Nótaí cinneadh|Úsáideoir bratach/u);
  assert.doesNotMatch(archives, /Athbhreithnigh an scagaire cartlainne|Chuaigh rud éigin mícheart/u);

  assert.equal(irish.archives.description, 'Taifid chomhlíontachta inléite amháin de chóipeanna teachtaireachtaí bróicéara a ndearnadh athbhreithniú orthu.');
  assert.equal(irish.archives.read_only_badge, 'Inléite amháin');
  assert.equal(irish.archives.section_conversation_snapshot, 'Léargas ar an gcomhrá');
  assert.equal(irish.archives.label_decided_by, 'Cinneadh déanta ag');
  assert.equal(irish.archives.frozen_note, 'Coinnítear an taifead seo díreach mar a bhí sé nuair a rinneadh athbhreithniú air agus ní féidir é a athrú.');
});

test('Irish Broker configuration preserves tenant policy, thresholds, and fail-closed enforcement', () => {
  const configuration = JSON.stringify(irish.configuration);

  assert.doesNotMatch(configuration, /ar fud an tenant|liostaí ardriosca|Iarr malartú do liostaí/u);
  assert.doesNotMatch(configuration, /Léim faomhadh|Lorgú vetála|Coinnigh lorg/u);
  assert.doesNotMatch(configuration, /Coimeád cartlainne|Riarthóir amháin|Triail arís/u);

  assert.equal(irish.configuration.save_success, 'Sábháladh cumraíocht an bhróicéara.');
  assert.match(irish.configuration.limited_access_body, /don tionónta ar fad/u);
  assert.equal(irish.configuration.field_require_exchange_for_listings_label, 'Éiligh malartú le haghaidh liostuithe');
  assert.equal(irish.configuration.field_auto_approve_low_risk_help, 'Ná héiligh faomhadh bróicéara do mhalartuithe a aicmítear mar ísealriosca.');
  assert.equal(irish.configuration.field_expiry_hours_label, 'Tréimhse bailíochta an fhaofa (uaireanta)');
  assert.equal(irish.configuration.section_compliance_safeguarding_desc, 'Rianú grinnfhiosrúcháin agus árachais, forfheidhmiú agus rabhaidh éaga.');
  assert.equal(irish.configuration.field_broker_contact_email_placeholder, 'broker@example.com');
});

test('Irish Broker matching distinguishes proposals, approvals, listings, and review dates', () => {
  const matching = JSON.stringify(irish.matching);

  assert.doesNotMatch(matching, /Faomhaí Meaitseála|cliste-meaitseála|"Liosta"/u);
  assert.doesNotMatch(matching, /Níl aon mheaitseálacha|Meaitseáil íseal|Meaitseáil gan aimsiú/u);

  assert.equal(irish.matching.title, 'Faomhadh meaitseálacha');
  assert.equal(irish.matching.approved_toast, 'Faomhadh an mheaitseáil — cuirfear an ball ar an eolas');
  assert.equal(irish.matching.rejected_toast, 'Diúltaíodh don mheaitseáil');
  assert.equal(irish.matching.score_low, 'Meaitseáil lag');
  assert.equal(irish.matching.reviewed_at, 'Athbhreithnithe ar');
  assert.equal(irish.matching.distance_km, '{{km}} km');
});

test('Irish Broker status and moderation wording describes published content actions accurately', () => {
  const moderation = JSON.stringify({
    queue: irish.moderation_queue,
    feed: irish.moderation_feed,
    comments: irish.moderation_comments,
    reviews: irish.moderation_reviews,
    reports: irish.moderation_reports,
    safeguarding: irish.safeguarding_options,
  });

  assert.doesNotMatch(moderation, /sula dtéann sé beo|maolú ar thuairimí/u);
  assert.doesNotMatch(moderation, /Léirmheas, bratach|Triage agus réiteach/u);
  assert.doesNotMatch(moderation, /Roghanna coimirce|dearbhaithe coimirce/u);

  assert.equal(irish.status.approved, 'Faofa');
  assert.equal(irish.status.critical, 'Tromchúiseach');
  assert.equal(irish.status.pending_broker, 'Faomhadh bróicéara ar feitheamh');
  assert.equal(irish.moderation_queue.description, 'Déan athbhreithniú ar ábhar atá ar feitheamh le modhnóireacht sula bhfoilsítear é.');
  assert.match(irish.moderation_reviews.description, /cuir bratach orthu agus déan iad a mhodhnú/u);
  assert.equal(irish.safeguarding_options.title, 'Roghanna cosanta');
});

test('Irish Broker help preserves safeguarding privacy, jurisdiction, and fail-closed boundaries', () => {
  const help = JSON.stringify(irish.help);

  assert.doesNotMatch(help, /Gabhann taifead fíoraithe|Contact Fianuithe/u);
  assert.doesNotMatch(help, /<code>dearbhaithe<\/code>|<code>cúlghairm<\/code>|Teiptear ar shonraí/u);
  assert.doesNotMatch(help, /Scóip reatha|stampa ama gar|forfheidhmiú dlí/u);

  assert.match(irish.help.vetting.intro, /Ní stórálann an leathanach seo ach cinneadh cosanta an phobail/u);
  assert.match(irish.help.vetting.intro, /Ná huaslódáil ná cóipeáil teastais/u);
  assert.match(irish.help.vetting.workflow_confirm, /<code>confirmed<\/code>/u);
  assert.match(irish.help.vetting.workflow_revoke, /<code>revoked<\/code>/u);
  assert.match(irish.help.vetting.messaging, /Fanann an geata dúnta/u);
  assert.match(irish.help.legal.data_minimisation, /Ní ceadmhach teastais/u);
  assert.match(irish.help.data.guardian_assignments, /Cúlghairm bhog atá ann/u);
  assert.match(irish.help.contacts.criminality, /déan teagmháil leis na póilíní/u);
});

test('the complete Irish Broker catalogue retains only documented functional invariants', () => {
  const englishValues = flatten(english);
  const irishValues = flatten(irish);
  const exactMatches = Object.keys(englishValues)
    .filter((key) => typeof englishValues[key] === 'string' && irishValues[key] === englishValues[key])
    .sort();

  assert.deepEqual(exactMatches, [
    'configuration.field_broker_contact_email_placeholder',
    'header.search_shortcut',
    'matching.distance_km',
    'messages.detail_none',
    'palette.close_key',
    'risk_tags.id_label',
    'vetting.attestation_access_ni',
  ]);
});
