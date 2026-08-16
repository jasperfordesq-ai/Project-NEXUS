// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/volunteering.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/volunteering.json', import.meta.url)));

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

test('Irish React Volunteering retains only reviewed language-neutral values', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'hours_abbrev',
    'distance_m',
    'distance_km',
    'date_range_separator',
    'expenses.form.currency_placeholder',
    'donations.payment_methods.paypal',
    'donations.currencies.EUR',
    'donations.currencies.GBP',
    'donations.currencies.USD',
    'org_settings.website_placeholder',
    'group_signup.email_placeholder',
    'group_signup.reserve_opportunity_option',
    'group_signup.reserve_shift_option',
    'certificates.organization_hours',
    'wellbeing.score_out_of_100',
  ]);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Volunteering key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }
});

test('Irish React Volunteering core journeys reject known semantic failures', () => {
  const irishFlat = flatten(irish);
  const allIrish = [...irishFlat.values()].join('\n');

  for (const [path, value] of irishFlat) {
    if (path !== 'date_range_separator') {
      assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    }
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }

  assert.doesNotMatch(allIrish, /feidhmchlár|feidhmchláir|Curtha i bhfeidhm/u);
  assert.doesNotMatch(allIrish, /\bshift\b|\bShifts\b|roimh an laghdú/u);
  assert.doesNotMatch(allIrish, /Ni |Nil |Brabhsail|Feidir/u);
  assert.equal(irish.org_hours_declined, 'Uaireanta diúltaithe.');
  assert.equal(irish.applications.cancel, 'Cealaigh');
  assert.equal(irish.expenses.form.receipt, 'Admháil');
});
