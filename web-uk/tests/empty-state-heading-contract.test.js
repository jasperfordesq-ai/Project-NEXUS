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
// Two shared headings, chosen by what the empty space MEANS:
//   states.empty_title       "No results found"  — search/browse surfaces, where
//                             the member asked a question and got nothing back;
//   states.nothing_yet_title  "Nothing here yet"  — personal surfaces (your inbox,
//                             your orders, your applications), where nothing was
//                             searched and "No results found" read as an error.
const RESULTS_KEY = 'states.empty_title';
const NOTHING_YET_KEY = 'states.nothing_yet_title';

const RESULTS_FILES = [
  'achievements/engagement.njk',
  'clubs/index.njk',
  'courses/index.njk',
  'events/check-in.njk',
  'events/people.njk',
  'events/translate.njk',
  'federation/events.njk',
  'federation/groups.njk',
  'federation/listings.njk',
  'groups/files.njk',
  'groups/index.njk',
  'ideation/campaigns.njk',
  'ideation/index.njk',
  'ideation/outcomes.njk',
  'jobs/applicants.njk',
  'jobs/index.njk',
  'jobs/pipeline.njk',
  'jobs/talent-search.njk',
  'leaderboard/index.njk',
  'leaderboard/journey.njk',
  'marketplace/index.njk',
  'marketplace/listing-list.njk',
  'marketplace/search.njk',
  'matches/index.njk',
  'organisations-jobs.njk',
  'organisations.njk',
  'podcasts/index.njk',
  'polls/index.njk',
  'resources/index.njk',
  'search/index.njk',
  'whats-on/index.njk',
];

const NOTHING_YET_FILES = [
  'achievements/collections.njk',
  'achievements/shop.njk',
  'achievements/showcase.njk',
  'coupons/index.njk',
  'exchanges/index.njk',
  'federation/partners.njk',
  'feed/index.njk',
  'goals/index.njk',
  'goals/templates.njk',
  'group-exchanges/index.njk',
  'groups/announcements.njk',
  'groups/discussions.njk',
  'jobs/applications.njk',
  'jobs/mine.njk',
  'jobs/saved.njk',
  'leaderboard/competitive.njk',
  'leaderboard/spotlight.njk',
  'marketplace/orders.njk',
  'marketplace/slots.njk',
  'messages/index.njk',
  'notifications/index.njk',
  'podcasts/studio.njk',
  'polls/manage.njk',
  'premium/index.njk',
  'saved/index.njk',
  'volunteering/emergency-alerts.njk',
  'volunteering/group-signups.njk',
];



describe('empty-state heading contract', () => {
  it.each(RESULTS_FILES)('%s uses the search-empty heading', (rel) => {
    const file = path.join(VIEWS, ...rel.split('/'));
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain(RESULTS_KEY);
  });

  it.each(NOTHING_YET_FILES)('%s uses the nothing-here-yet heading', (rel) => {
    const file = path.join(VIEWS, ...rel.split('/'));
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain(NOTHING_YET_KEY);
    // and it must not ALSO fall back to search wording for the same state
    // (files legitimately using both keys in different sections are listed in
    // RESULTS_FILES too and asserted there).
  });
});

/**
 * Conversation threads are the exception to the "No results found" heading: an
 * empty chat is not a failed search, so it uses a conversation-appropriate
 * heading (`states.no_messages_title`, "No messages yet") above its own empty
 * message. These two live templates must carry that heading.
 */
const CONVERSATION_FILES = [
  'messages/direct-conversation.njk',
  'messages/group-conversation.njk',
];
const CONVERSATION_HEADING_KEY = 'states.no_messages_title';

describe('empty conversation heading contract', () => {
  it.each(CONVERSATION_FILES)('%s has the no-messages-yet heading', (rel) => {
    const file = path.join(VIEWS, ...rel.split('/'));
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain(CONVERSATION_HEADING_KEY);
  });
});
