// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/eventSafety.json') as Record<string, unknown>;
const irish = require('./ga/eventSafety.json') as Record<string, unknown>;

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

describe('mobile Irish event-safety locale content', () => {
  it('does not fall back to English or contain invisible zero-width characters', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);

    for (const [path, englishValue] of englishFlat) {
      const localizedValue = irishFlat.get(path);
      expect(localizedValue).toBeDefined();
      expect(localizedValue).not.toBe(englishValue);
      expect(localizedValue).not.toMatch(/[\u200B-\u200D\uFEFF]/u);
    }
  });
});
