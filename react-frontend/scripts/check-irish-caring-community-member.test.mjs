// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/caring_community.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/caring_community.json', import.meta.url)));

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

test('Irish Caring Community exact matches are reviewed functional identities', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'admin.civic_digest.includes.sources.vereine',
    'admin.common.empty_dash',
    'admin.feedback.table.id',
    'admin.loyalty.ledger.empty_value',
    'admin.loyalty.table.empty_value',
    'admin.providers.duplicates.vs',
    'admin.providers.types.spitex',
    'admin.regional_points.ledger.user_fallback',
    'admin.safeguarding_reports.actor_id',
    'admin.safeguarding_reports.empty_dash',
    'admin.safeguarding_reports.table.sla_abbr',
    'admin.surveys.actions.csv',
    'admin.surveys.analytics.option_percentage_aria',
    'providers.filter_spitex',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Caring Community key: ${path}`);
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
});

test('Irish member-facing care, cover, provider and trust journeys reject known semantic failures', () => {
  const memberSections = [
    irish.trust_tier,
    irish.caregiver,
    irish.cover,
    irish.providers,
    irish.onboarding,
    irish.relationships,
    irish.data_export,
    irish.warmth_pass,
  ];
  const memberIrish = memberSections.flatMap(section => [...flatten(section).values()]).join('\n');

  assert.doesNotMatch(memberIrish, /Painéal Cúraimí|Reach ciseal|Mionteagasc Handoff|Scileanna meaitseála\{\{count\}\}/u);
  assert.doesNotMatch(memberIrish, /ag\{\{phone\}\}|ag\{\{email\}\}|soláthraí\{\{url\}\}|le\{\{name\}\}/u);
  assert.doesNotMatch(memberIrish, /cúram logála|Ball ó shin|Pas gníomhach ó shin|ag\{\{tenant\}\}trí/u);
  assert.doesNotMatch(memberIrish, /Briseadh do shraith|an chéad chiseal|sraithe muiníne|Ualach cúramóra ard:/u);

  assert.equal(irish.caregiver.dashboard_title, 'Painéal Cúraim');
  assert.equal(irish.cover.fields.trust_tier, 'Íosleibhéal iontaobhais');
  assert.equal(irish.warmth_pass.not_eligible_hint, 'Bain an leibhéal Iontaofa amach chun do Phas Teasa a dhíghlasáil');
  assert.equal(irish.panel.sidebar.search_placeholder, 'Cuardaigh an nascleanúint...');
});
