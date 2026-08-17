// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/reviews.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/reviews.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('the complete 24-value Irish Reviews source catalogue is reviewed', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);

  assert.equal(englishFlat.size, 24, 'Update the audited Reviews source-value total');
  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Reviews key: ${path}`);
    const irishValue = irishFlat.get(path);
    assert.notEqual(irishValue, englishValue, `Unreviewed English value in Irish Reviews catalogue: ${path}`);
    assert.equal(irishValue, irishValue.trim(), `Irish Reviews value has outer whitespace: ${path}`);
    assert.doesNotMatch(irishValue, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/u, `Irish Reviews value has invisible or control characters: ${path}`);
  }
});

test('Irish Reviews copy preserves ratings, anonymity, recipients, and outcomes', () => {
  const reviewed = [...flatten(irish).values()].join('\n');
  assert.doesNotMatch(reviewed, /Meánmharcáil|\bAnaithnid\b|a thuilleadh|d'earcaigh eile|Níor faigheadh|Luchtaigh níos mó/u);
  assert.equal(irish.stats.average, 'Meánrátáil');
  assert.equal(irish.review_card.anonymous, 'Gan ainm');
  assert.equal(irish.review_card.delete_success, 'Scriosadh an léirmheas');
  assert.match(irish.pending.empty_subtitle, /Beidh léirmheasanna ar do mhalartuithe críochnaithe/u);
  assert.match(irish.received.empty_subtitle, /tosú ar léirmheasanna a fháil/u);
  assert.match(irish.given.empty_subtitle, /do bhaill eile/u);
  assert.match(irish.load_error, /Bain triail eile as/u);
  assert.equal(irish.rating_aria, '{{n}} réalta as 5');
});
