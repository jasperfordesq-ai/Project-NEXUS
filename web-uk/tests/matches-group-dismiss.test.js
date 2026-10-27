// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Dismissing GROUP matches (27 Oct 2026).
 *
 * React's MatchCard lets a member hide a listing OR a group match
 * (`POST /v2/matches/{listing|group}/{id}/dismiss`). The accessible pages offered the
 * dismiss button on listing matches only, so a group suggestion could never be hidden.
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
const { PREFIX, createApp } = require('./react-parity-harness');

const groupMatch = { module: 'group', group_id: 12, title: 'Allotment growers', match_score: 0.7, match_reasons: ['Shares your interests'] };
const listingMatch = { module: 'listing', listing_id: 7, title: 'Garden help', match_score: 0.82 };

const app = () => createApp('/matches', [matchesRoutes]);

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each([
  ['', `/matches/group/12/dismiss`],
  ['/board', `/matches/board/group/12/dismiss`]
])('matches%s page offers to dismiss a group match', (page, action) => {
  it('renders a dismiss form for the group match as well as the listing match', async () => {
    api.callMatchesApi.mockResolvedValue({ data: { matches: [groupMatch, listingMatch] } });
    const res = await request(app()).get(`${PREFIX}/matches${page}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`action="${PREFIX}${action}"`);
    expect(res.text).toContain(`action="${PREFIX}/matches${page}/7/dismiss"`);
  });
});

describe('dismissing a group match', () => {
  it('posts to the typed group dismiss endpoint with the chosen reason', async () => {
    api.callMatchesApi.mockResolvedValue({ data: {} });
    const res = await request(app())
      .post(`${PREFIX}/matches/group/12/dismiss`)
      .type('form')
      .send({ reason: 'not_relevant' });
    expect(api.callMatchesApi).toHaveBeenCalledWith(expect.anything(), 'POST', '/group/12/dismiss', { reason: 'not_relevant' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/matches?status=match-dismissed`);
  });

  it('returns to the board with its filter, and reports a failure honestly', async () => {
    api.callMatchesApi.mockRejectedValue(new api.ApiError('nope', 500));
    const res = await request(app())
      .post(`${PREFIX}/matches/board/group/12/dismiss`)
      .type('form')
      .send({ reason: 'too_far', source: 'group' });
    expect(api.callMatchesApi).toHaveBeenCalledWith(expect.anything(), 'POST', '/group/12/dismiss', { reason: 'too_far' });
    expect(res.headers.location).toBe(`${PREFIX}/matches/board?source=group&status=match-dismiss-failed#matches-top`);
  });
});
