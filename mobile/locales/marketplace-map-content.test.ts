// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/marketplace.json') as Record<string, unknown>;
const irish = require('./ga/marketplace.json') as Record<string, unknown>;

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

describe('mobile Irish marketplace map', () => {
  it('contains reviewed Irish with only coordinate and distance formats unchanged', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const functionalInvariants = new Set([
      'map.previewCoordinates',
      'map.latitudePlaceholder',
      'map.longitudePlaceholder',
      'map.radiusOption',
      'map.coordinatesLabel',
    ]);
    const reviewedPaths = [...englishFlat.keys()].filter((path) => path.startsWith('map.'));

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      if (functionalInvariants.has(path)) {
        expect(irishFlat.get(path)).toBe(englishFlat.get(path));
      } else {
        expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
      }
    }
    expect(irishFlat.get('map.useCurrentLocation')).not.toContain('Sexusitem');
    expect(irishFlat.get('map.startTitle')).not.toContain('Placeholder');
  });
});
