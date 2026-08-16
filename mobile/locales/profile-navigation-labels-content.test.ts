// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const english = require('./en/profile.json') as Record<string, unknown>;
const irish = require('./ga/profile.json') as Record<string, unknown>;

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

describe('mobile Irish profile navigation labels and photo states', () => {
  it('does not fall back to English', () => {
    const englishFlat = flatten(english);
    const irishFlat = flatten(irish);
    const excludedPrefixes = ['matches.', 'reviews.', 'support.', 'navDescriptions.'];
    const reviewedPaths = [...englishFlat.keys()].filter((path) =>
      !excludedPrefixes.some((prefix) => path.startsWith(prefix))
      && irishFlat.get(path) !== englishFlat.get(path),
    );

    const expectedPaths = [
      'browseMembers', 'wallet', 'messages', 'notifications', 'activity',
      'menuLabels.activity', 'listings', 'marketplace', 'changePhoto',
      'permissionNeeded', 'permissionMessage', 'uploadFailed',
      'uploadFailedMessage', 'edit.uploadingPhoto', 'events', 'ideation',
      'search', 'jobs', 'marketplaceSection', 'marketplaceBrowse',
      'marketplaceSell', 'marketplaceMyListings', 'marketplaceOrders',
      'marketplaceSales', 'marketplaceOffers', 'marketplaceSaved',
      'marketplacePromotions', 'marketplaceSavedSearches', 'marketplaceTools',
      'marketplacePayments', 'aiChat', 'volunteering', 'organisations', 'blog',
      'skills', 'federation', 'myProfile', 'mySpace', 'discover', 'account',
      'actions',
    ];

    for (const path of expectedPaths) {
      expect(reviewedPaths).toContain(path);
      expect(irishFlat.get(path)).toBeDefined();
      expect(irishFlat.get(path)).not.toBe(englishFlat.get(path));
    }
  });
});
