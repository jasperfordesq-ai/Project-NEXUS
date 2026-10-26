// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * When a community's safeguarding setup is unfinished, Laravel hides matches
 * involving protected members and says so in `meta.degraded_reason`
 * (React d2ba1b237). The accessible matches pages ignored it, so a member saw a
 * generic "no matches" with no explanation.
 *
 * Pinned on both /matches and /matches/board: a banner above the matches that
 * still show, React's explanation in place of the empty state, and no call to
 * action (the member cannot fix it). Without the flag nothing changes.
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
  return { ApiError, ApiOfflineError: class extends Error {}, callMatchesApi: jest.fn(), dismissMatch: jest.fn() };
});

const api = require('../src/lib/api');
const matchesRoutes = require('../src/routes/matches');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const listingMatch = {
  type: 'listing',
  id: 7,
  title: 'Garden help',
  match_score: 0.82,
  listing_type: 'offer',
  user: { id: 4, name: 'Sam' }
};

function respond(matches, meta) {
  api.callMatchesApi.mockResolvedValue({ data: { matches, meta } });
}

const app = () => createApp('/matches', [matchesRoutes]);
const degraded = { degraded_reason: 'safeguarding_policy_unavailable' };

describe.each(['', '/board'])('matches%s safeguarding explanation', (page) => {
  beforeEach(() => jest.clearAllMocks());

  it('explains hidden matches above the matches that still show', async () => {
    respond([listingMatch], degraded);
    const res = await request(app()).get(`${PREFIX}/matches${page}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_members.matches_safeguarding.banner_title'));
    expect(res.text).toContain('Garden help');
  });

  it('replaces the empty state with the explanation and offers no call to action', async () => {
    respond([], degraded);
    const res = await request(app()).get(`${PREFIX}/matches${page}`);

    expect(res.text).toContain(t('govuk_alpha_members.matches_safeguarding.empty_title').replace(/'/g, '&#39;'));
    expect(res.text).not.toContain(t('matches.add_listing'));
    expect(res.text).not.toContain(t('govuk_alpha_connections.matches_empty.browse_listings'));
  });

  it('changes nothing when Laravel reports no degradation', async () => {
    respond([], { degraded_reason: null });
    const res = await request(app()).get(`${PREFIX}/matches${page}`);

    expect(res.text).not.toContain('matches-safeguarding-notice');
  });
});
