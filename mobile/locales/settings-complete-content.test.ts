// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/settings.json') as Record<string, unknown>;
const irish = require('./ga/settings.json') as Record<string, unknown>;

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [nestedPath, nestedValue] of flatten(item as Record<string, unknown>, path)) {
        result.set(nestedPath, nestedValue);
      }
    } else if (typeof item === 'string') {
      result.set(path, item);
    }
  }
  return result;
}

describe('complete mobile Irish Settings catalogue', () => {
  it('contains every English key with only reviewed technical values unchanged', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const functionalInvariants = new Set([
      'identity.dob_placeholder',
      'dataExport.format.json',
      'linkedAccounts.emailPlaceholder',
      // The account-deletion confirmation keyword is deliberately NOT translated, in this
      // app and in the web app's eleven locales. Translating it in one place and not the
      // other is how the web app once locked members out of deleting their own accounts:
      // the screen said "type ELIMINAR" while the code compared against "DELETE".
      // `app/accountDeletionParity.test.ts` asserts it stays "DELETE" everywhere, and the
      // gate accepts the localized keyword too, so a future decision to translate it
      // would need both places changed together.
      'deleteAccount.keyword',
    ]);

    expect(irishFlat.size).toBe(englishFlat.size);
    for (const [path, englishValue] of englishFlat) {
      expect(irishFlat.get(path)).toBeDefined();
      if (functionalInvariants.has(path)) {
        expect(irishFlat.get(path)).toBe(englishValue);
      } else {
        expect(irishFlat.get(path)).not.toBe(englishValue);
      }
    }
  });
});
