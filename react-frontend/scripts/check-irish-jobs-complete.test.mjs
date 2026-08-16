// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/jobs.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/jobs.json', import.meta.url)));

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

test('complete Irish React Jobs catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'analytics.versus',
    'salary.range',
    'salary.currency_eur',
    'salary.currency_gbp',
    'salary.currency_usd',
    'geo.radius_5',
    'geo.radius_10',
    'geo.radius_25',
    'geo.radius_50',
    'geo.radius_100',
    'kanban.ai_score',
    'kanban.interview_location_placeholder',
    'apply.cv_size_kb',
    'apply.cv_size_kb_one',
    'apply.cv_size_kb_other',
    'interview.calendar_google',
    'interview.calendar_outlook',
    'interview.calendar_ics',
    'branding.video_placeholder',
    'saved_profile.inline_cv',
    'form.contact_email_placeholder',
    'form.contact_phone_placeholder',
    'onboarding.org_website_placeholder',
    'salary_display',
    'jobs.category_value',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Jobs key: ${path}`);
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
  assert.doesNotMatch(allIrish, /Folunta|folunta|catago|de reir/u);
  assert.doesNotMatch(allIrish, /\{\{count\}\}l/u);
  assert.doesNotMatch(allIrish, /\b(?:Measúnú|Tuartha|Léargais|Rangú) IS\b/u);
  assert.doesNotMatch(allIrish, /aimsíthe|feidhmchláir|Post a Post|Cuardach Talent/u);
  assert.doesNotMatch(allIrish, /inshocraithe|iarratasóir\(í\)|fostú dall/u);
  assert.equal(irish.detail.confirm_close, 'Ní ghlacfar le hiarratais nua nuair a dhúnfar an folúntas. Is féidir leat é a athoscailt am ar bith.');
  assert.equal(irish.page_meta.create.title, 'Foilsigh Post');
});
