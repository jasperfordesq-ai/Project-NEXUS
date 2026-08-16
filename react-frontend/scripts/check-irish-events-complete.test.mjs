// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/events.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/events.json', import.meta.url)));

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

test('complete Irish React Events catalogue has only reviewed functional matches', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set([
    'detail.attendee_rsvp',
    'form.recurrence_count_placeholder',
    'form.recurrence_preview_empty',
    'manage.agenda.speaker_with_role',
    'radius_5',
    'radius_10',
    'radius_25',
    'radius_50',
    'radius_100',
    'calendar_actions.outlook',
  ]);

  assert.equal(englishFlat.size, 847);
  assert.equal(irishFlat.size, 883);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Events key: ${path}`);
    if (invariants.has(path)) {
      assert.equal(irishFlat.get(path), englishValue, path);
    } else {
      assert.notEqual(irishFlat.get(path), englishValue, path);
    }
  }

  for (const [path, value] of irishFlat) {
    if (!englishFlat.has(path)) {
      assert.match(path, /_(few|many|two)$/u, `Unexpected Irish-only Events key: ${path}`);
      assert.ok(englishFlat.has(path.replace(/_(few|many|two)$/u, '_other')), `Plural key has no English base: ${path}`);
    }
    assert.equal(value, value.trim(), `Whitespace defect: ${path}`);
    assert.doesNotMatch(value, /[\u200B-\u200D\uFEFF]/u, `Invisible character: ${path}`);
  }

  const allIrish = [...irishFlat.values()].join('\n');
  assert.doesNotMatch(allIrish, /Near me|Recurring|\{\{title\}\} on \{\{date\}\}|RIAL:/u);
  assert.doesNotMatch(allIrish, /Freastalaitheoirí|freastalaitheoirí|Roghchlár|As l\?thair/u);
  assert.doesNotMatch(allIrish, /\{\{from\}\}go\{\{to\}\}|Roghnaigh\{\{name\}\}|cuireadh\(í\)|taifead\(í\)/u);
  assert.doesNotMatch(allIrish, /tascanna róil|Tascanna foirne|do-aistrithe|do-athluaite|neamh-luaineach/u);
  assert.doesNotMatch(allIrish, /gan seó|clipboard|People CSV|spás oibre People|Cealaigh Imeacht/u);

  assert.equal(irish.form.recurrence_preview_empty, 'RRULE:...');
  assert.equal(irish.form.essentials_section, 'Bunsonraí an imeachta');
  assert.equal(irish.manage.people.metrics.no_show, 'Níor tháinig');
  assert.equal(irish.manage.people.pagination_summary, '{{start}}–{{end}} as {{total}}');
  assert.match(irish.manage.team.description, /sannacháin róil/u);
  assert.match(irish.manage.team.description, /do-athraithe/u);
  assert.match(irish.calendar_subscriptions.personal_description, /aon duine/u);
  assert.match(irish.calendar_subscriptions.personal_description, /léamh/u);
});
