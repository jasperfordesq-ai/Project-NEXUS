// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

const appDir = __dirname;
const projectDir = path.resolve(appDir, '..');

const groupedRouteCoverage = {
  'app/(modals)/clubs.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/donation-receipt.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/achievements.tsx': 'app/(modals)/gamification.test.tsx',
  'app/(modals)/edit-event.tsx': 'app/(modals)/new-event.test.tsx',
  'app/(modals)/edit-group.tsx': 'app/(modals)/new-group.test.tsx',
  'app/(modals)/edit-job.tsx': 'app/(modals)/new-job.test.tsx',
  'app/(modals)/edit-marketplace-listing.tsx': 'app/(modals)/new-marketplace-listing.test.tsx',
  'app/(modals)/edit-volunteering.tsx': 'app/(modals)/new-volunteering.test.tsx',
  'app/(modals)/federation-events.tsx': 'app/(modals)/federation-groups-events.test.tsx',
  'app/(modals)/federation-groups.tsx': 'app/(modals)/federation-groups-events.test.tsx',
  'app/(modals)/federation-member.tsx': 'app/(modals)/member-profile.test.tsx',
  'app/(modals)/federation-partners.tsx': 'app/(modals)/federation-groups-events.test.tsx',
  'app/(modals)/groups.tsx': 'app/(tabs)/groups.test.tsx',
  'app/(modals)/group-invite.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/ideation-campaign-detail.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/ideation-campaigns.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/ideation-idea.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/ideation-outcomes.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/leaderboard.tsx': 'app/(modals)/gamification.test.tsx',
  'app/(modals)/marketplace-become-partner.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/marketplace-coupon-detail.tsx': 'app/(modals)/marketplace-public-routes.test.tsx',
  'app/(modals)/marketplace-coupons.tsx': 'app/(modals)/marketplace-public-routes.test.tsx',
  'app/(modals)/marketplace-free.tsx': 'app/(modals)/marketplace-public-routes.test.tsx',
  'app/(modals)/marketplace-pickup-scan.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/marketplace-pickup-slots.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/marketplace-promotions.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/marketplace-sales-orders.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/marketplace-saved-searches.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/marketplace-seller-onboarding.tsx': 'app/(modals)/marketplace-tool-routes.test.tsx',
  'app/(modals)/nexus-score.tsx': 'app/(modals)/gamification.test.tsx',
  'app/(modals)/search.tsx': 'app/(tabs)/search.test.tsx',
  'app/(modals)/venue-checkin.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/venue-pass.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/venues.tsx': 'app/(modals)/member-module-routes.test.tsx',
  'app/(modals)/volunteer-checkin.tsx': 'app/(modals)/member-module-routes.test.tsx',
};

function toProjectPath(filePath) {
  return path.relative(projectDir, filePath).replace(/\\/g, '/');
}

function walkRoutes(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkRoutes(fullPath);
    if (!entry.name.endsWith('.tsx')) return [];
    if (entry.name.endsWith('.test.tsx')) return [];
    if (entry.name === '_layout.tsx') return [];
    return [fullPath];
  });
}

function siblingTestFor(routePath) {
  const parsed = path.parse(routePath);
  return path.join(parsed.dir, `${parsed.name}.test.tsx`);
}

describe('route smoke coverage inventory', () => {
  it('keeps every app route covered by a sibling or grouped route test', () => {
    const routeFiles = walkRoutes(appDir);
    const uncovered = routeFiles
      .map((routePath) => {
        const route = toProjectPath(routePath);
        if (fs.existsSync(siblingTestFor(routePath))) return null;
        const groupedTest = groupedRouteCoverage[route];
        if (groupedTest && fs.existsSync(path.join(projectDir, groupedTest))) return null;
        return route;
      })
      .filter(Boolean)
      .sort();

    expect(uncovered).toEqual([]);
  });
});
