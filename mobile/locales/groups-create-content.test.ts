// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/groups.json') as Record<string, unknown>;
const irish = require('./ga/groups.json') as Record<string, unknown>;

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

describe('mobile Irish group creation locale content', () => {
  it('does not fall back to English except for coordinate examples', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const invariantPaths = new Set([
      'create.latitudePlaceholder',
      'create.longitudePlaceholder',
    ]);
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      path.startsWith('create.')
      || path.startsWith('stats.')
      || ['subtitle', 'heroEyebrow', 'posts', 'posts_other'].includes(path),
    );

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      if (!invariantPaths.has(path)) {
        expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
      }
    }
  });
});
