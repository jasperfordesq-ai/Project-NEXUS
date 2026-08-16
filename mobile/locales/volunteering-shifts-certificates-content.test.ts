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

describe('mobile Irish volunteering shifts and certificates', () => {
  it('uses Irish except for language-neutral date and time formats', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      path === 'viewOpportunity'
      || path === 'openOpportunityLabel'
      || path === 'applyOpportunityLabel'
      || path === 'hoursValue'
      || path === 'shiftDateUnavailable'
      || path.startsWith('tabs.')
      || path.startsWith('myShifts.')
      || path.startsWith('certificates.'),
    );
    const languageNeutralPaths = new Set([
      'myShifts.date',
      'myShifts.timeRange',
      'certificates.dateRange',
    ]);

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      if (languageNeutralPaths.has(path)) {
        expect(irishFlat.get(path)).toBe(englishFlat.get(path));
      } else {
        expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
      }
    }
  });
});
