// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/chat.json') as Record<string, unknown>;
const locales = {
  de: require('./de/chat.json'),
  es: require('./es/chat.json'),
  fr: require('./fr/chat.json'),
  ga: require('./ga/chat.json'),
  it: require('./it/chat.json'),
  pt: require('./pt/chat.json'),
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

describe('mobile AI chat locale content', () => {
  const englishFlat = flatten(english);
  const guardedPaths = [...englishFlat.keys()].filter((path) => (
    path === 'disclaimer' || path.startsWith('tool_results.') || path.startsWith('feedback.')
  ));

  it.each(Object.entries(locales))('%s does not fall back to English for results or feedback', (_locale, catalog) => {
    const localized = flatten(catalog as Record<string, unknown>);
    for (const path of guardedPaths) {
      expect(localized.get(path)).toBeDefined();
      expect(localized.get(path)).not.toBe(englishFlat.get(path));
    }
  });
});
