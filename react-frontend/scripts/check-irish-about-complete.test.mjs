// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/about.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/about.json', import.meta.url)));

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

test('complete Irish React About catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'partner.tbuk_heading',
    'social_prescribing.testimonial_name',
    'impact_report.case_study_monica_name',
    'impact_report.case_study_elaine_name',
    'impact_report.activity_value_0',
    'impact_report.activity_value_1',
    'impact_report.activity_value_2',
    'impact_report.activity_value_3',
    'impact_report.sroi_result_value',
    'impact_report.sroi_total_investment_value',
    'impact_report.sroi_total_present_value_amount',
    'impact_report.sroi_net_social_value_amount',
    'impact_report.sroi_ratio_value',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish About key: ${path}`);
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
  assert.doesNotMatch(allIrish, /ama-bhaincireacht|Ama-bhaincireacht|tuill creidí|cabháir|muinin|Tuileann/u);
  assert.doesNotMatch(allIrish, /ag cabhair|go raibh teastáil liom|bhainistiúil|Maoínigh|soláthair saineolas/u);
  assert.doesNotMatch(allIrish, /HOUR Tá Timebank|Polasaí Náisiúnta|Chreatlach|Leanuint|Uair Banc - 2023/u);
  assert.doesNotMatch(allIrish, /2\.340|an roinnt inscne|deiteán|eisceachtúil ard|méideanna móra malartaithe/u);
  assert.doesNotMatch(allIrish, /faoi sheirbhís|caibidil phobail|bunús ball|Éagsúlú maoiniúcháin teoranta/u);
  assert.doesNotMatch(allIrish, /Iarratais mhaoiniúcháin|urra corparáideacha|gnólachtaí teic airdhearcacha/u);

  assert.equal(irish.timebanking_guide.page_title, 'Treoir don Bhaincéireacht Ama');
  assert.equal(irish.social_prescribing.referral_pathway_heading, 'An Chonair Atreoraithe Bhainistithe');
  assert.equal(irish.impact_report.activity_value_3, '2,340');
  assert.match(irish.impact_report.sroi_description, /marbhualach/u);
  assert.match(irish.strategic_plan.goal_1_text, /gcraobh/u);
});
