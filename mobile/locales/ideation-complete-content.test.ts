// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/ideation.json') as Record<string, unknown>;
const irish = require('./ga/ideation.json') as Record<string, unknown>;

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

describe('complete mobile Irish Ideation catalogue', () => {
  it('contains every English key with only the reviewed date-time example unchanged', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);

    const languageNeutralPaths = new Set([
      'media.url_label',
      'media.url_placeholder',
      'create.deadlinePlaceholder',
    ]);

    expect(irishFlat.size).toBeGreaterThanOrEqual(englishFlat.size);
    for (const [path, englishValue] of englishFlat) {
      expect(irishFlat.get(path)).toBeDefined();
      if (languageNeutralPaths.has(path)) {
        expect(irishFlat.get(path)).toBe(englishValue);
      } else {
        expect(irishFlat.get(path)).not.toBe(englishValue);
      }
    }
  });
});
