// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

/**
 * Every list/collection page with an empty state must give that empty state a
 * visible heading, so a screen-reader user landing on an empty list hears a
 * labelled "No results found" region rather than a bare sentence.
 *
 * The heading is:
 *   <h2 class="govuk-heading-m">{{ t("states.empty_title") }}</h2>
 *
 * inserted immediately before the empty-state paragraph. `states.empty_title`
 * ("No results found") is translated in all locales.
 *
 * This is a file-scoped contract: each template below must contain the shared
 * empty-state heading key. Removing a heading fails this test.
 */
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const HEADING_KEY = 'states.empty_title';

const TARGET_FILES = [
  'achievements/collections.njk',
  'achievements/engagement.njk',
  'achievements/shop.njk',
  'achievements/showcase.njk',
  'clubs/index.njk',
  'coupons/index.njk',
  'courses/index.njk',
  'events/check-in.njk',
  'events/people.njk',
  'events/translate.njk',
  'federation/events.njk',
  'federation/groups.njk',
  'federation/listings.njk',
  'federation/partners.njk',
  'goals/index.njk',
  'goals/templates.njk',
  'group-exchanges/index.njk',
  'groups/announcements.njk',
  'groups/discussions.njk',
  'groups/files.njk',
  'groups/index.njk',
  'ideation/campaigns.njk',
  'ideation/index.njk',
  'ideation/outcomes.njk',
  'jobs/applicants.njk',
  'jobs/applications.njk',
  'jobs/index.njk',
  'jobs/mine.njk',
  'jobs/pipeline.njk',
  'jobs/saved.njk',
  'jobs/talent-search.njk',
  'leaderboard/competitive.njk',
  'leaderboard/index.njk',
  'leaderboard/journey.njk',
  'leaderboard/spotlight.njk',
  'marketplace/index.njk',
  'marketplace/listing-list.njk',
  'marketplace/orders.njk',
  'marketplace/search.njk',
  'marketplace/slots.njk',
  'matches/index.njk',
  'notifications/index.njk',
  'organisations-jobs.njk',
  'organisations.njk',
  'podcasts/index.njk',
  'podcasts/studio.njk',
  'polls/index.njk',
  'polls/manage.njk',
  'premium/index.njk',
  'resources/index.njk',
  'saved/index.njk',
  'search/index.njk',
  'volunteering/emergency-alerts.njk',
  'volunteering/group-signups.njk',
  'whats-on/index.njk',
];

describe('empty-state heading contract', () => {
  it.each(TARGET_FILES)('%s has the shared empty-state heading', (rel) => {
    const file = path.join(VIEWS, ...rel.split('/'));
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain(HEADING_KEY);
  });
});
