// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/common.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/common.json', import.meta.url)));

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

test('Irish shared UI has only reviewed functional matches with English', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    '25_34',
    '35_44',
    '45_54',
    '55_64',
    '65_plus',
    'advertise.col_ctr',
    'advertise.stats.ctr',
    'analytics.regional.age_groups.25_34',
    'analytics.regional.age_groups.35_44',
    'analytics.regional.age_groups.45_54',
    'analytics.regional.age_groups.55_64',
    'analytics.regional.age_groups.65_plus',
    'analytics.regional.empty.infinity',
    'analytics.regional.empty_value',
    'caring_community.actions.markt',
    'caring_community.modules.markt',
    'caring_workflow.empty.value',
    'commercial_boundary.empty.value',
    'compose.placeholder_hours',
    'compose.placeholder_url',
    'empty_dash',
    'footer.project_nexus',
    'install.ios_step_2_after',
    'keyboard.command_symbol',
    'keyboard.k_key',
    'markt.meta.title',
    'members.distance_km',
    'members.location_distance',
    'menu_builder.route_faq',
    'municipal_copilot.empty.value',
    'nexus_score.tier_threshold',
    'oauth.provider_facebook',
    'oauth.provider_google',
    'partner_analytics.suppressed_short',
    'providers.filter_spitex',
    'proximity.radius_option',
    'push_campaign.radius_km',
    'radius_5',
    'radius_10',
    'radius_25',
    'radius_50',
    'radius_100',
    'regional_analytics.tiers.pro.label',
    'safeguarding_reports.submit.form.evidence_placeholder',
    'salary.currency_eur',
    'salary_display',
    'verein_import.csv_placeholder',
    'verein_dues.unnamed_verein',
    'verein_federation.char_count',
    'verein_federation.char_count_one',
    'verein_federation.char_count_other',
    'xp_progress',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish common key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }

  const allIrish = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(allIrish, /Ag Treáil|Nascléanúint|Socruití|Miantaí|Just Now|Active Label|Inactive Label/u);
  assert.doesNotMatch(allIrish, /Baill á luchtú|Pobal á luchtú|Luchtaigh|e\.g\.,/u);
  assert.doesNotMatch(allIrish, /Ualach cúramóra ard:\{\{hours\}\}uaireanta|Soláthraí ríomhphoist ag\{\{email\}\}/u);
  assert.doesNotMatch(allIrish, /\{\{count\}\}(?:nóiméad|uair an chloig|lá|m ó shin|h ó shin|d ó shin|Freagra)/u);
  assert.doesNotMatch(allIrish, /The hub is only visible|Is cás le do chomharsana|cuideachta amháin|chothromaíocht folláin/u);
  assert.doesNotMatch(allIrish, /fógraí push|Sliotáin Bhailithe|bailiú in áit|tapú amháin|in trí thapú/u);
  assert.doesNotMatch(allIrish, /sreabhadh bordála|bhformhór na ngrúpaí|painéal admin|Chuinneog chúntóra|Líon coise/u);
  assert.doesNotMatch(allIrish, /hooks gréasáin|comharthaí bearer|críochphointí scóipithe|comhpháirtithe GBM/u);
  assert.doesNotMatch(allIrish, /Sliotán Bailithe|sliotán bailithe|Triail [Aa]rís|Líon coise|buicéadaithe|Uimh dleachtanna/u);
  assert.doesNotMatch(allIrish, /Dúshláin Idéalaithe|Deonaíocht|Forbhreathnú ar do theach pearsanta|atá ag treáil/u);
  assert.doesNotMatch(allIrish, /Ionad Cabhraigh|Lorg Aráin|rudaí a bhriseann|Páirt glactha|sonraí suíomh/u);
  assert.doesNotMatch(allIrish, /air\/uirthi|sé\/sí|An chéad seic eile|Siopadóireacht & Teachtaireachtaí/u);
  assert.doesNotMatch(allIrish, /cúram ar féidir leat glaoch air|An slug don chomharchumann|Bhog mé teach|Stair na n-aistrithe agat/u);
  assert.doesNotMatch(allIrish, /Níl uaireanta go leor|Uaireanta a logáladh|uaireanta logáilte|Cuireadh úsáidte cheana/u);

  assert.equal(irish.aria.remove, 'Bain');
  assert.equal(irish.confirm, 'Deimhnigh');
  assert.equal(irish.delete, 'Scrios');
  assert.equal(irish.user_fallback, 'Úsáideoir');
  assert.equal(irish.theme_picker.title, 'Cuma');
  assert.equal(irish.biometric.label_passkey, 'Paseochair');
  assert.equal(irish.verein_import.csv_placeholder, english.verein_import.csv_placeholder);
  assert.equal(irish.future_care_fund.reciprocity.balanced, 'Tá cothromaíocht mhaith idir an méid a thug tú agus an méid a fuair tú.');
  assert.match(irish.caring_community.modules.subtitle, /tacaíocht chúraim/u);
  assert.match(irish.future_care_fund.intro, /comhluadair/u);
  assert.match(irish.regional_analytics.feature_footfall_title, /cuairteanna/u);
  assert.match(irish.caring_workflow.predictive.helper_churn, /Cúntóirí caillte/u);
  assert.equal(irish.marketplace.pickup.slots_title, 'Tráthanna Bailithe');
  assert.equal(irish.verein_dues.badge_none, 'Gan táillí');
  assert.equal(irish.nav.ideation, 'Smaointe');
  assert.equal(irish.nav.premium, 'Tabhair Síntiús');
  assert.equal(irish.nav.accessibility_alpha, 'Leagan WCAG 2.2 AA');
  assert.equal(irish.nav_desc.premium, 'Tacaigh leis an bpobal seo');
  assert.equal(irish.nav_desc.dashboard, 'Forbhreathnú pearsantaithe ar do leathanach baile');
  assert.equal(irish.footer.project_nexus, 'Project NEXUS');
  assert.match(irish.cookie_consent.description, /tuairiscí anaithnidithe/u);
  assert.equal(irish.members.joined_date, 'Ball ó {{date}}');
  assert.match(irish.biometric.platform_windows_step1, /paseochair/u);
  assert.doesNotMatch(irish.biometric.platform_windows_step1, /pasfhocal/u);
  assert.equal(irish.request_help.voice.transcript_label, 'An méid a chualamar');
  assert.equal(irish.request_help.voice.stop, 'Cuir stop leis an taifeadadh');
  assert.match(irish.hour_gift.send.confirm_body, /sparán an fhaighteora/u);
  assert.equal(irish.hour_gift.send.confirm_button, 'Bronn na huaireanta');
  assert.equal(irish.hour_transfer.form.submitting, 'Iarratas á dhéanamh...');
  assert.equal(irish.my_support_relationships.next_check_in, 'An chéad seiceáil eile');
  assert.equal(irish.future_care_fund.hours_short, 'uaireanta');
  assert.equal(irish.reciprocity.title, 'Do Chomhardú Cómhalartachta');
  assert.equal(irish.offer_favour.form.categories.shopping, 'Siopadóireacht agus Gnóthaí Beaga');
  assert.match(irish.invite.expired.body, /do chomhordaitheoir/u);
});
