// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/settings.json', import.meta.url)));

test('Irish Settings preserves GDPR access, portability, restriction, and deletion rights', () => {
  assert.match(irish.gdpr.info, /Íoslódáil mo shonraí/u);
  assert.match(irish.gdpr.info, /Oifigeach Cosanta Sonraí/u);
  assert.equal(irish.gdpr.deletion_title, 'Scrios do chuntas');
  assert.match(irish.gdpr.deletion_desc, /do chuntas agus do chuid sonraí go léir go buan/u);
  assert.match(irish.gdpr.restriction_modal_desc, /stórálfaimid do shonraí ach ní phróiseálfaimid/u);
  assert.match(irish.delete_modal.aria_label, /scriosadh an chuntais/u);
});

test('Irish Settings reports the real password and destructive-action requirements', () => {
  assert.match(irish.toasts.password_too_short_desc, /12 charachtar/u);
  assert.doesNotMatch(irish.toasts.password_too_short_desc, /8 gcarachtar/u);
  assert.match(irish.toasts.type_delete_to_confirm, /DELETE/u);
  assert.match(irish.toasts.account_deleted_desc, /go buan/u);
  assert.match(irish.toasts.delete_failed_desc, /cuntas a scriosadh/u);
  assert.match(irish.toasts.gdpr_request_submitted_desc, /trí ríomhphost/u);
});
