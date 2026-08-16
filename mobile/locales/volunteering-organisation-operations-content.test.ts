// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/volunteering.json') as Record<string, unknown>;
const irish = require('./ga/volunteering.json') as Record<string, unknown>;

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

describe('mobile Irish volunteering organisation operations', () => {
  it('does not fall back to English', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      path.startsWith('org.')
      && !path.startsWith('org.wallet.')
      && !path.startsWith('org.settings.'),
    );

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
    }
  });
});
