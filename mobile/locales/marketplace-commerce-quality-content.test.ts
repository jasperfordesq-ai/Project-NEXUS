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

describe('mobile Irish marketplace commerce terminology', () => {
  it('uses reviewed Irish rather than English or misleading literal translations', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const reviewedPaths = [
      'orders.track',
      'orders.rate',
      'orders.shippingMethod',
      'orders.shippingMethods.express',
      'seller.partnerBadge',
      'seller.avgRating',
      'seller.message',
      'seller.listingsTab',
      'seller.reviewMember',
      'seller.reviewDate',
      'tools.promotions.types.bump',
      'tools.promotions.types.featured',
      'tools.promotions.types.top_of_category',
      'tools.promotions.types.homepage_carousel',
    ];

    for (const path of reviewedPaths) {
      expect(irishFlat.get(path)).toBeDefined();
      expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
    }
    expect(irishFlat.get('orders.track')).toBe('Rianaigh');
    expect(irishFlat.get('seller.avgRating')).toBe('Meánrátáil');
  });
});
