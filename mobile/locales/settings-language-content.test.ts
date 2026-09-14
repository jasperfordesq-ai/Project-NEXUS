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

describe('mobile Irish settings language preferences', () => {
  it('does not fall back to English', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const topLevelPaths = new Set([
      'account', 'accountHint', 'notifications', 'editProfile',
      'editProfileHint', 'changePasswordHint',
    ]);
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      topLevelPaths.has(path) || path.startsWith('translation.'),
    );

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
    }
  });
});

describe('mobile password guidance', () => {
  const catalogues = ['de', 'en', 'es', 'fr', 'ga', 'it', 'pt'].map((locale) => ({
    locale,
    settings: require(`./${locale}/settings.json`) as {
      password: Record<string, string>;
    },
  }));

  it.each(catalogues)('$locale states the enforced 12-character minimum', ({ settings }) => {
    expect(settings.password.newHint).toContain('12');
    expect(settings.password.newHint).not.toMatch(/\b8\b/);
  });

  it.each(catalogues)('$locale has clean password action and recovery copy', ({ settings }) => {
    for (const key of ['save', 'successSignIn', 'unconfirmedTitle', 'unconfirmedMessage']) {
      expect(settings.password[key]).toEqual(expect.any(String));
      expect(settings.password[key].trim()).not.toBe('');
      expect(settings.password[key]).not.toMatch(/<|id=/i);
    }
  });
});
