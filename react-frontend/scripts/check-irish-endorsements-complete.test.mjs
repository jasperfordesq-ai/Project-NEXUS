// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const english = JSON.parse(await readFile(new URL('../public/locales/en/endorsements.json', import.meta.url)));
const irish = JSON.parse(await readFile(new URL('../public/locales/ga/endorsements.json', import.meta.url)));

test('the complete Irish Endorsements catalogue uses endorsement language', () => {
  assert.deepEqual(Object.keys(english), ['most_endorsed']);
  assert.notEqual(irish.most_endorsed, english.most_endorsed);
  assert.equal(irish.most_endorsed, 'Is mó a formhuiníodh');
  assert.doesNotMatch(irish.most_endorsed, /d’aontaigh/u);
});
