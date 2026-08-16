// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/messages.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/messages.json', import.meta.url)));

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

test('complete Irish Messages catalogue retains only the character counter', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);
  const invariants = new Set(['character_count']);

  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Messages key: ${path}`);
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

test('Irish Messages preserves safeguarding confirmation and data-minimisation boundaries', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /Ta seiceail|Ta an comhra|Dean teagmhail|Dibir fogra|Nil an comhalta/u);
  assert.match(irish.safeguarding_vetting_required.body, /Níor dheimhnigh do phobal/u);
  assert.match(irish.safeguarding_vetting_required.body, /Enhanced DBS/u);
  assert.match(irish.safeguarding_vetting_required.contact_broker, /Ná seol teastas DBS/u);
  assert.match(irish.safeguarding_vetting_required.contact_broker, /faisnéis faoi thaifead coiriúil/u);
  assert.match(irish.safeguarding_policy_unavailable.body, /Cuirtear teachtaireachtaí díreacha ar sos/u);
});

test('Irish Messages distinguishes read, sent, archive, and destructive states', () => {
  assert.equal(irish.aria_read_receipt_read, 'Léite');
  assert.equal(irish.aria_read_receipt_sent, 'Seolta');
  assert.match(irish.archive_confirm_body, /Folófar .* bhosca isteach/u);
  assert.match(irish.delete_conversation_everyone_prompt, /go buan/u);
  assert.match(irish.delete_conversation_everyone_prompt, /Ní féidir é seo a chur ar ceal/u);
  assert.equal(irish.conversation_deleted_everyone_desc, 'Baineadh an comhrá don dá pháirtí.');
});
