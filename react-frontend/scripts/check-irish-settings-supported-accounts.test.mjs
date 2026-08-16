// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const irish = JSON.parse(await readFile(new URL('../public/locales/ga/settings.json', import.meta.url)));

test('Irish Settings keeps member-approved support separate from staff-recorded arrangements', () => {
  assert.match(irish.sub_accounts.description, /comhaontaíodh/u);
  assert.match(irish.sub_accounts.scope_note, /a thaifeadann do chomhordaitheoirí ar leithligh/u);
  assert.match(irish.sub_accounts.staff_recorded_label, /arna thaifeadadh ag an bhfoireann/u);
  assert.match(irish.sub_accounts.pending_member_approval, /Ní féidir leo rochtain/u);
  assert.match(irish.sub_accounts.pending_your_approval, /mura gceadaíonn tú/u);
  assert.match(irish.sub_accounts.modal_description, /ní thosóidh an tacaíocht/u);
});

test('Irish Settings preserves consent and audit boundaries for message access', () => {
  assert.match(irish.sub_accounts.messages.explainer, /nuair a deir \{\{name\}\} féin tá/u);
  assert.match(irish.sub_accounts.messages.explainer, /Taifeadtar gach amharc/u);
  assert.match(irish.sub_accounts.messages.explainer, /cead a tharraingt siar am ar bith/u);
  assert.match(irish.sub_accounts.messages.member_reminder, /d’aontaigh tú/u);
});

test('Irish Settings supported actions remain fail-closed until the member approves', () => {
  assert.match(irish.support_actions.waiting_intro, /Ní tharlaíonn tada mura gceadaíonn tú/u);
  assert.match(irish.support_actions.decline_confirm_body, /Tá sé ceart go leor diúltú/u);
  assert.match(irish.support_actions.prepare_explainer_co_decide, /ní théann sé ar aghaidh ach amháin má deir siad tá/u);
  assert.match(irish.support_actions.confirm_error_body, /Níor athraíodh aon rud/u);
  assert.equal(irish.support_actions.type_listing_create, 'Liostú nua');
  assert.equal(irish.support_actions.done_directly_toast, 'Déanta. Cuireadh ar an eolas iad');
  assert.match(irish.safeguarding.guardians.tiers_explainer, /rinne siad é ar do shon/u);
  assert.doesNotMatch(irish.safeguarding.guardians.tiers_explainer, /thar do cheann/u);
});
