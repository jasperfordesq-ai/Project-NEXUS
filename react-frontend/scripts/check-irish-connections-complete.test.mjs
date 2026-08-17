// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/connections.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/connections.json', import.meta.url)));

function flatten(value, prefix = '', result = new Map()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item, path, result);
    else if (typeof item === 'string') result.set(path, item);
  }
  return result;
}

test('the complete 39-value Irish Connections source catalogue is reviewed', () => {
  const englishFlat = flatten(english);
  const irishFlat = flatten(irish);

  assert.equal(englishFlat.size, 39, 'Update the audited Connections source-value total');
  for (const [path, englishValue] of englishFlat) {
    assert.ok(irishFlat.has(path), `Missing Irish Connections key: ${path}`);
    const irishValue = irishFlat.get(path);
    assert.notEqual(irishValue, englishValue, `Unreviewed English value in Irish Connections catalogue: ${path}`);
    assert.equal(irishValue, irishValue.trim(), `Irish Connections value has outer whitespace: ${path}`);
    assert.doesNotMatch(irishValue, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/u, `Irish Connections value has invisible or control characters: ${path}`);
  }
});

test('Irish Connections copy preserves links, requests, decisions, and removal meaning', () => {
  const reviewed = [...flatten(irish).values()].join('\n');
  assert.doesNotMatch(reviewed, /\bCeangail\b|Díscaoil|Díscaoilte|Theip ar ghlacadh le ceangal|ag meaitseáil do chuardach/u);
  assert.equal(irish.title, 'Naisc');
  assert.equal(irish.disconnect, 'Dícheangail');
  assert.match(irish.wants_to_connect, /nasc a dhéanamh leat/u);
  assert.match(irish.empty_no_connections_description, /cuir le do líonra pobail/u);
  assert.match(irish.empty_no_sent_description, /go nglacfar leo nó go ndiúltófar dóibh/u);
  assert.equal(irish.toast_accepted, 'Glacadh leis an nasc!');
  assert.equal(irish.toast_disconnected, 'Baineadh an nasc');
  assert.equal(irish.toast_cancelled, 'Cealaíodh an t-iarratas');
});
