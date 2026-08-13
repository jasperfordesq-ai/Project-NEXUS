// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/resources.json') as Record<string, unknown>;
const locales = {
  de: require('./de/resources.json'),
  es: require('./es/resources.json'),
  fr: require('./fr/resources.json'),
  ga: require('./ga/resources.json'),
  it: require('./it/resources.json'),
  pt: require('./pt/resources.json'),
} as const;

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

describe('mobile resources locale content', () => {
  const englishFlat = flatten(english);
  const validIdenticalValues: Partial<Record<keyof typeof locales, Set<string>>> = {
    es: new Set(['uncategorized']),
    fr: new Set(['articleTitle']),
  };

  it.each(Object.entries(locales))('%s does not fall back to English', (locale, catalog) => {
    const localized = flatten(catalog as Record<string, unknown>);
    for (const [path, englishValue] of englishFlat) {
      expect(localized.get(path)).toBeDefined();
      if (!validIdenticalValues[locale as keyof typeof locales]?.has(path)) {
        expect(localized.get(path)).not.toBe(englishValue);
      }
    }
  });
});
