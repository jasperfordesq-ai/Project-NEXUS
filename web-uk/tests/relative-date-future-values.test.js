// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The shared `formatDate` filter is RELATIVE ("3 days ago"). Every "ago"
 * bucket compares `now - date`, so a FUTURE date made every bucket negative and
 * the first one match: an upcoming event's start, a listing's expiry and an
 * open poll's close date all rendered as "just now". Browser-confirmed on the
 * dashboard against the disposable environment (audit #6, 2026-08-19).
 *
 * The filter now sends future values to the absolute localised date instead.
 * This exercises it end-to-end through one member-visible surface (an open
 * poll's "Closes on" line) and pins the past-value behaviour unchanged.
 */

const request = require('supertest');
const signature = require('cookie-signature');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
  login: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  validateToken: jest.fn(),
  getPolls: jest.fn(),
  getPollCategories: jest.fn(),
  getUnreadCount: jest.fn(),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn()
}));

const COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.COOKIE_SECRET = COOKIE_SECRET;
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

function signedTokenCookie(value = 'token:test') {
  return 'token=' + encodeURIComponent('s:' + signature.sign(value, COOKIE_SECRET));
}

describe('formatDate never says "just now" about the future', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({
      data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }]
    });
    api.getTenantBootstrap.mockResolvedValue({
      data: { id: 2, name: 'Acme Timebank', slug: 'acme', modules: {}, features: {} }
    });
    api.getUnreadCount.mockResolvedValue({ data: { count: 0 } });
    api.getPollCategories.mockResolvedValue({ data: [] });
  });

  it('renders an open poll closing in the future with the absolute date, not "just now"', async () => {
    // Fixed far-future close date so the assertion is deterministic.
    const futureClose = '2030-03-05T12:00:00Z';
    api.getPolls.mockResolvedValue({
      data: [{
        id: 9,
        question: 'Future close poll',
        status: 'open',
        expires_at: futureClose,
        creator: { id: 4, name: 'Poll Creator' },
        total_votes: 0
      }]
    });

    const response = await request(app)
      .get('/polls')
      .set('Cookie', signedTokenCookie());

    expect(response.status).toBe(200);
    expect(response.text).toContain('Future close poll');
    expect(response.text).toContain('5 Mar 2030');
    expect(response.text).not.toContain('just now');
  });

  it('keeps relative wording for past dates', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    api.getPolls.mockResolvedValue({
      data: [{
        id: 10,
        question: 'Recently closed poll',
        status: 'closed',
        expires_at: twoDaysAgo,
        creator: { id: 4, name: 'Poll Creator' },
        total_votes: 3
      }]
    });

    const response = await request(app)
      .get('/polls')
      .set('Cookie', signedTokenCookie());

    expect(response.status).toBe(200);
    expect(response.text).toContain('2 days ago');
  });
});
