// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/jobs.json') as Record<string, unknown>;
const irish = require('./ga/jobs.json') as Record<string, unknown>;

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

describe('complete mobile Irish Jobs catalogue', () => {
  it('contains every English key with only reviewed functional values unchanged', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const functionalInvariants = new Set([
      'card.salary',
      'analytics.stage_count',
      'analytics.salary_difference',
      'create.contactEmailPlaceholder',
      'create.contactPhonePlaceholder',
      'create.salaryCurrencyPlaceholder',
      'create.videoUrlPlaceholder',
      'create.companySize.1-10',
      'create.companySize.11-50',
      'create.companySize.51-200',
      'create.companySize.201-500',
      'create.companySize.500+',
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
