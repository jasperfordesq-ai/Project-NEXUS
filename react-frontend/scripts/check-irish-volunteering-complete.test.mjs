// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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

test('remaining Irish React Volunteering feature sections use contextual language', () => {
  const allIrish = [...flatten(irish).values()].join('\n');

  assert.doesNotMatch(allIrish, /NACH bhfuil|0\. 00|laethanta tabhartha ná tabhartais/u);
  assert.doesNotMatch(allIrish, /\boiriúintí\b|\bBurnout\b|\bshifts?\b/iu);
  assert.doesNotMatch(allIrish, /Uimh idirbhearta|Deonaigh a íoc|Creidmheasanna Taisce/u);
  assert.doesNotMatch(allIrish, /Íoslódáil an Dearbhú|Uaslódáil Creidmheasa|Ticeáilte/u);

  assert.equal(irish.donations.donate, 'Geall Síntiús trí Aistriú Bainc');
  assert.equal(irish.donations.modal_title, 'Taifead Gealltanas As Líne');
  assert.equal(irish.safeguarding.submit_training, 'Sábháil an Taifead');
  assert.equal(irish.accessibility.accommodations_label, 'Oiriúnuithe Riachtanacha');
  assert.equal(irish.wellbeing.burnout_warning, 'Rabhadh faoi Ídiú');
  assert.equal(irish.org_wallet.deposit_button, 'Taisc');
});
