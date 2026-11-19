// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The accessible matches pages against Laravel's GET /api/v2/matches/all
 * contract (17 Nov 2026 audit).
 *
 * What was wrong, each pinned below on BOTH /matches and /matches/board:
 *
 *  - `meta.paused` and `meta.disabled` were ignored, so a member who had paused
 *    matching (or whose community had switched it off) was told to "add a
 *    listing", which would never bring a match back.
 *  - the board had no "no location" or "no offers yet" explanation at all.
 *  - group, volunteering and event cards printed "by Unknown member": only a
 *    listing match has a member behind it.
 *  - a volunteering match is an OPPORTUNITY, and linked to the organisation.
 *  - a cold-start suggestion was shown as an "N% match".
 *  - a group that approves its members answered "pending" and the page said
 *    "joined".
 *  - notification links (`?type=mutual`, `?highlight=listing-7`) did nothing.
 */

const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({ requireAuth: (req, res, next) => next() }));
jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class extends Error {},
    callMatchesApi: jest.fn(),
    dismissMatch: jest.fn(),
    toggleBookmark: jest.fn(),
    joinGroup: jest.fn()
  };
});

const api = require('../src/lib/api');
const matchesRoutes = require('../src/routes/matches');
const { formatLocaleDate } = require('../src/lib/localization');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const listingMatch = {
  module: 'listing',
  listing_id: 7,
  title: 'Garden help',
  type: 'offer',
  category_name: 'Gardening',
  user_id: 4,
  user_name: 'Sam',
  match_score: 0.82,
  match_type: 'one_way',
  match_reasons: ['Close to you']
};
const groupMatch = {
  module: 'group',
  group_id: 12,
  title: 'Allotment growers',
  member_count: 14,
  visibility: 'public',
  match_score: 0.7,
  match_reasons: []
};
const volunteeringMatch = {
  module: 'volunteering',
  opportunity_id: 31,
  organization_id: 5,
  organization_name: 'Riverside Food Bank',
  title: 'Sort donations',
  location: 'Cork',
  match_score: 0.66,
  match_reasons: []
};
const eventMatch = {
  module: 'event',
  event_id: 44,
  title: 'Repair evening',
  // As Laravel sends it: UTC, with the event's own time zone alongside.
  event_date: '2026-12-05T18:30:00.000000Z',
  timezone: 'Europe/Dublin',
  all_day: false,
  location: 'Town Hall',
  attendee_count: 9,
  match_score: 0.61,
  match_reasons: []
};
const allKinds = [listingMatch, groupMatch, volunteeringMatch, eventMatch];
const fullMeta = {
  total: 0,
  modules: [],
  min_score: 40,
  needs_location: false,
  degraded: false,
  degraded_reason: null,
  has_active_listings: true,
  paused: false,
  disabled: false
};

function respond(matches, meta = {}) {
  api.callMatchesApi.mockResolvedValue({ data: { matches, meta: { ...fullMeta, ...meta } } });
}

const app = () => createApp('/matches', [matchesRoutes]);
const get = (path) => request(app()).get(`${PREFIX}/matches${path}`);

beforeEach(() => jest.clearAllMocks());

describe.each(['', '/board'])('matches%s: why there is nothing to show', (page) => {
  it('says matching is paused and links to the setting, instead of asking for a listing', async () => {
    respond([], { paused: true, has_active_listings: false });
    const res = await get(page);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_connections.matches_shared.paused_title'));
    expect(res.text).toContain(`href="${PREFIX}/profile/settings#match-preferences"`);
    expect(res.text).not.toContain(t('matches.add_listing'));
    expect(res.text).not.toContain(t('matches.no_listings_title'));
    expect(res.text).not.toContain(t('govuk_alpha_connections.matches_empty.browse_listings'));
  });

  it('says plainly when the community is not using matching, and offers nothing to do', async () => {
    respond([], { disabled: true, has_active_listings: false });
    const res = await get(page);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_connections.matches_shared.disabled_body'));
    expect(res.text).not.toContain('matches-paused-notice');
    expect(res.text).not.toContain(t('matches.add_listing'));
    expect(res.text).not.toContain(t('govuk_alpha_connections.matches_empty.browse_listings'));
    // Nothing to count or filter when matching is off.
    expect(res.text).not.toContain('nexus-alpha-filter-nav');
  });

  it('explains that a location is needed, with a link to set one', async () => {
    respond([listingMatch], { needs_location: true, degraded: true, degraded_reason: 'no_coordinates' });
    const res = await get(page);

    expect(res.text).toContain('id="matches-location-notice"');
    expect(res.text).toContain(t('matches.no_location_title'));
    expect(res.text).toContain(`href="${PREFIX}/profile/settings#location"`);
    expect(res.text).toContain('Garden help');
  });

  it('explains that matching works from offers and requests when the member has none', async () => {
    respond([], { has_active_listings: false });
    const res = await get(page);

    expect(res.text).toContain(t('matches.no_listings_title'));
    expect(res.text).toContain(`href="${PREFIX}/listings/new"`);
  });

  it('shows none of these notices when Laravel reports nothing unusual', async () => {
    respond([listingMatch]);
    const res = await get(page);

    expect(res.text).not.toContain('matches-paused-notice');
    expect(res.text).not.toContain('matches-disabled-notice');
    expect(res.text).not.toContain('matches-location-notice');
    expect(res.text).not.toContain('matches-no-listings-notice');
  });
});

describe.each([
  ['', 'matches.by_label', 'members.unknown_member'],
  ['/board', 'govuk_alpha_connections.matches.by_label', 'govuk_alpha_connections.common.unknown_member']
])('matches%s: each kind of match says the right thing', (page, byKey, unknownKey) => {
  it('names the member only on a listing match', async () => {
    respond(allKinds);
    const res = await get(page);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`${t(byKey, { name: 'Sam' })} - Gardening`);
    // No "by Unknown member" on the group, the opportunity or the event.
    expect(res.text).not.toContain(t(byKey, { name: t(unknownKey) }));
    expect(res.text).not.toContain(t(unknownKey));
  });

  it('shows the member count for a group', async () => {
    respond([groupMatch]);
    const res = await get(page);

    expect(res.text).toContain('14 members');
    expect(res.text).not.toContain(t(unknownKey));
  });

  it('shows the organisation and place for a volunteering opportunity, and links to the opportunity', async () => {
    respond([volunteeringMatch]);
    const res = await get(page);

    expect(res.text).toContain('Riverside Food Bank - Cork');
    expect(res.text).toContain(`href="${PREFIX}/volunteering/opportunities/31"`);
    expect(res.text).not.toContain(`${PREFIX}/organisations/5`);
    expect(res.text).not.toContain(t(unknownKey));
  });

  it('still shows a volunteering opportunity that names no organisation', async () => {
    respond([{ ...volunteeringMatch, organization_id: null, organization_name: null, location: '' }]);
    const res = await get(page);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${PREFIX}/volunteering/opportunities/31"`);
    expect(res.text).not.toContain(t(unknownKey));
  });

  it('shows the date and place for an event, and links to the event', async () => {
    respond([eventMatch]);
    const res = await get(page);

    // Date AND time, in the event's own time zone (Dublin is on UTC in December).
    const expectedDate = formatLocaleDate(new Date('2026-12-05T18:30:00Z'), 'en', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Dublin'
    });
    expect(expectedDate).toContain('5 December 2026');
    expect(expectedDate).toMatch(/6:30|18:30/);
    expect(res.text).toContain(`${expectedDate} - Town Hall`);
    expect(res.text).toContain(`href="${PREFIX}/events/44"`);
    expect(res.text).not.toContain(t(unknownKey));
  });

  it('shows an event on the day the organiser meant, not the UTC day', async () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in Dublin (summer time).
    respond([{ ...eventMatch, event_date: '2026-06-30T23:30:00.000000Z' }]);
    const res = await get(page);

    expect(res.text).toContain('1 July 2026');
    expect(res.text).not.toContain('30 June 2026');
  });

  it('shows an all-day event without a time, and survives an unknown time zone', async () => {
    respond([{ ...eventMatch, all_day: true, timezone: 'Not/AZone' }]);
    const res = await get(page);

    expect(res.status).toBe(200);
    expect(res.text).toContain('5 December 2026 - Town Hall');
  });

  it('offers to hide every kind of match', async () => {
    // Volunteering and event matches could not be hidden until 19 Nov 2026.
    respond(allKinds);
    const res = await get(page);

    expect(res.text).toContain(`action="${PREFIX}/matches${page}/7/dismiss"`);
    expect(res.text).toContain(`action="${PREFIX}/matches${page}/group/12/dismiss"`);
    expect(res.text).toContain(`action="${PREFIX}/matches${page}/volunteering/31/dismiss"`);
    expect(res.text).toContain(`action="${PREFIX}/matches${page}/event/44/dismiss"`);
    expect(res.text.split('/dismiss"').length - 1).toBe(4);
  });

  it('labels a cold-start match as a suggestion, not as a percentage', async () => {
    respond([
      listingMatch,
      { ...listingMatch, listing_id: 9, title: 'Lift to the shops', user_name: 'Ola', match_type: 'cold_start', match_score: 0.3 }
    ]);
    const res = await get(page);

    expect(res.text).toContain(t('govuk_alpha_connections.matches_shared.suggestion_tag'));
    expect(res.text).not.toContain('30%');
    // The scored match keeps its percentage, and the average ignores the suggestion.
    expect(res.text).toContain('82%');
    expect(res.text).not.toContain('56%');
  });
});

describe('joining a group from a match card', () => {
  it('says the request was sent when the group answers "pending"', async () => {
    api.joinGroup.mockResolvedValue({ data: { status: 'pending', action: 'requested' } });
    const res = await request(app()).post(`${PREFIX}/matches/group/12/join`).type('form').send({});

    expect(api.joinGroup).toHaveBeenCalledWith('test-token', 12);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/matches?status=match-join-requested`);

    respond([groupMatch]);
    const page = await get('?status=match-join-requested');
    expect(page.text).toContain(t('groups.states.group-requested'));
    expect(page.text).not.toContain(t('groups.states.group-joined'));
  });

  it('still says "joined" when the member really was added', async () => {
    api.joinGroup.mockResolvedValue({ data: { status: 'active', action: 'joined' } });
    const res = await request(app()).post(`${PREFIX}/matches/group/12/join`).type('form').send({});

    expect(res.headers.location).toBe(`${PREFIX}/matches?status=match-joined`);
  });

  it('reports a failure honestly', async () => {
    api.joinGroup.mockRejectedValue(new api.ApiError('nope', 500));
    const res = await request(app()).post(`${PREFIX}/matches/group/12/join`).type('form').send({});

    expect(res.headers.location).toBe(`${PREFIX}/matches?status=match-join-failed`);
  });
});

describe('links from a match notification', () => {
  const mutualListing = { ...listingMatch, listing_id: 21, title: 'Bike repair', user_name: 'Noor', is_mutual: true, match_type: 'mutual' };

  it('asks Laravel for the matches without a minimum score of its own', async () => {
    respond([listingMatch]);
    await get('');

    expect(api.callMatchesApi).toHaveBeenCalledWith('test-token', 'GET', '/all?limit=50');
  });

  it('shows mutual matches only for type=mutual, as it does for mutual=1', async () => {
    respond([listingMatch, mutualListing, groupMatch]);

    for (const query of ['?type=mutual', '?mutual=1']) {
      const res = await get(query);
      expect(res.text).toContain('Bike repair');
      expect(res.text).not.toContain('Garden help');
      expect(res.text).not.toContain('Allotment growers');
    }
  });

  it('puts the highlighted match first, marks it and links to it', async () => {
    respond([groupMatch, mutualListing, listingMatch]);
    const res = await get('?highlight=listing-7');

    expect(res.status).toBe(200);
    const highlighted = res.text.indexOf('id="match-listing-7"');
    expect(highlighted).toBeGreaterThan(-1);
    expect(highlighted).toBeLessThan(res.text.indexOf('id="match-group-12"'));
    expect(highlighted).toBeLessThan(res.text.indexOf('id="match-listing-21"'));
    expect(res.text).toContain('id="match-listing-7" tabindex="-1"');
    expect(res.text).toContain(t('govuk_alpha_connections.matches_shared.from_notification'));
    // A link above the list moves straight to the card, with no script.
    expect(res.text).toContain('href="#match-listing-7"');
  });

  it('handles the mutual notification link, which carries both', async () => {
    respond([listingMatch, { ...mutualListing, listing_id: 7 }]);
    const res = await get('?type=mutual&highlight=listing-7');

    expect(res.text).toContain('id="match-listing-7" tabindex="-1"');
    expect(res.text).toContain('Bike repair');
    expect(res.text).not.toContain('Garden help');
  });

  it.each(['?highlight=listing-999', '?highlight=%3Cscript%3E', '?highlight=listing-7&highlight=group-12'])(
    'marks nothing for %s',
    async (query) => {
      respond([groupMatch, { ...listingMatch, listing_id: 8 }]);
      const res = await get(query);

      expect(res.status).toBe(200);
      expect(res.text).not.toContain(t('govuk_alpha_connections.matches_shared.from_notification'));
      expect(res.text).not.toMatch(/id="match-[a-z]+-\d+" tabindex/);
      expect(res.text).toContain('id="match-group-12"');
      expect(res.text).toContain('Allotment growers');
    }
  );
});
