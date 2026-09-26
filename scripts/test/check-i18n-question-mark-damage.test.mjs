// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// check-i18n-question-mark-damage.test.mjs — pins which values the gate
// treats as characters-replaced-by-"?" and which it must leave alone. Every
// "damaged" sample below is a real value found in this repository on
// 2026-09-26; every "intact" sample is a real, correct translation that an
// over-eager rule would have flagged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDamage } from '../check-i18n-question-mark-damage.mjs';

const damaged = [
  ['ar', '????? ?????? ??????????', 'Email activation'],
  ['ja', '??????', 'Email activation'],
  ['ja', 'JPEG?PNG?GIF?WebP???10 MB', 'JPEG, PNG, GIF, or WebP up to 10 MB'],
  ['de', 'Verlauf f?r {{name}}', 'History for {{name}}'],
  ['fr', "Renvoyer l?e-mail de v?rification", 'Resend verification email'],
  ['pl', 'Obraz wyr??niony', 'Featured image'],
  ['de', 'Seitenhilfe ?ffnen', 'Open page help'],
  ['pl', 'E-mail jest ju? aktywowany', 'Email is already activated'],
  ['fr', 'Activ?', 'Activated'],
  ['es', 'S?', 'Yes'],
  ['it', 'Pubblicit?', 'Advertising'],
  ['de', '{{start}}?{{end}} von {{total}}', '{{start}}–{{end}} of {{total}}'],
  ['de', 'Zertifizierungsdetails ? {{name}}', 'Certification details — {{name}}'],
  ['de', 'Ist Google Places der größte Kostentreiber? Sitzungen werden abgerechnet.',
    'Google Places is the largest cost driver — sessions are billed.'],
  ['ar', 'يمسح ؟{{title}}؟؟ لا يمكن التراجع عن هذا.', 'Delete “{{title}}”? This cannot be undone.'],
];

const intact = [
  // Japanese writes an ASCII "?" in real questions, with no space after it.
  ['ja', '「{{title}}」を削除しますか?これを元に戻すことはできません。', 'Delete “{{title}}”? This cannot be undone.'],
  // …and splits some confirmations so the suffix starts with the "?".
  ['ja', '?これにより、認証済みステータスが付与されます。', ' This will grant verified status.'],
  // Genuine questions where the English is a label, not a question.
  ['de', 'Wer hat geklickt?', 'Who clicked'],
  ['it', 'Cosa succede?', "What's on"],
  ['es', '¿Quién hizo clic?', 'Who clicked'],
  ['fr', 'Et ensuite ?  Votre demande est envoyée.', 'What happens next  Your request is sent.'],
  // URLs, query parameters and code tokens carry "?" legitimately.
  ['ar', 'https://www.youtube.com/watch?v=...', 'https://www.youtube.com/watch?v=...'],
  ['fr', 'Veuillez fournir un code de commune via ?code= ou en définir un.', 'Provide a municipality code via ?code= or set one.'],
  ['ar', 'إضافة ساعات. الجسم: user_id، hours، note?', 'Add hours. Body: user_id, hours, note?'],
  // An untranslated English question in the Arabic file is not "?" damage.
  ['ar', "We've missed you lately — would you like a warmth pass?", "We've missed you lately — would you like a warmth pass?"],
  // Arabic's own question mark.
  ['ar', 'هل تريد حذف «{{title}}»؟ لا يمكن التراجع عن هذا.', 'Delete “{{title}}”? This cannot be undone.'],
  // A dash in the English with a question mark the English also has.
  ['fr', 'Supprimer « {{title}} » ? Cette action est irréversible.', 'Delete “{{title}}”? This cannot be undone.'],
];

for (const [locale, value, english] of damaged) {
  test(`flags damaged ${locale}: ${value}`, () => {
    assert.notDeepEqual(findDamage(value, english, locale), [], `expected damage in ${JSON.stringify(value)}`);
  });
}

for (const [locale, value, english] of intact) {
  test(`leaves intact ${locale}: ${value}`, () => {
    assert.deepEqual(findDamage(value, english, locale), []);
  });
}

test('values without a question mark are never inspected', () => {
  assert.deepEqual(findDamage('Vereinigtes Königreich', 'United Kingdom', 'de'), []);
  assert.deepEqual(findDamage(42, 'x', 'de'), []);
});
