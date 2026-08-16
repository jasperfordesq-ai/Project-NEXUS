// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/settings.json', import.meta.url)));

test('Irish Settings distinguishes passkeys from passwords on every supported platform', () => {
  assert.equal(irish.biometric.label_passkey, 'Pas-eochair');
  assert.equal(irish.twofa_app_authy, 'Authy');

  for (const platform of ['windows', 'mac', 'iphone', 'ipad', 'android', 'linux', 'unknown']) {
    const instructions = Object.entries(irish.biometric)
      .filter(([key]) => key.startsWith(`platform_${platform}_`))
      .map(([, value]) => value)
      .join('\n');
    assert.match(instructions, /(?:pas|phas)-eoch(?:air|racha)/u, `${platform} instructions must name a passkey`);
  }

  assert.doesNotMatch(irish.biometric.platform_windows_step1, /pasfhocal/u);
  assert.doesNotMatch(irish.biometric.platform_windows_step4, /pasfhocail/u);
  assert.doesNotMatch(irish.biometric.platform_iphone_step1, /pasfhocal/u);
  assert.doesNotMatch(irish.biometric.platform_ipad_step1, /pasfhocal/u);
  assert.doesNotMatch(irish.biometric.platform_android_step1, /pasfhocal/u);
  assert.match(irish.biometric.platform_mac_step1, /phasfhocal Mac/u);
});

test('Irish Settings passkey controls preserve domain, limit, and registration meaning', () => {
  assert.match(irish.passkey_limit_reached, /teorainn \{\{count\}\} pas-eochair/u);
  assert.match(irish.passkey_rp_unknown, /scáileán sínithe isteach/u);
  assert.equal(irish.biometric_registered, 'Cláraíodh an phas-eochair.');
  assert.match(irish.passkey_rp_mismatch, /ní oibreoidh sí ar \{\{currentRpId\}\}/u);
});
