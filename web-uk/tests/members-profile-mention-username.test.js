// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * @mentions were unusable on the accessible site (deep parity audit 27 Oct 2026, table
 * #37 / F13): the server reads "@username" from plain text, but no web-uk page showed
 * anyone's username, so a member could not know what to type.
 *
 * GET /api/v2/users/{id} does not return a username. The one API that gives a member
 * another member's username is the mention search React's picker uses
 * (GET /api/v2/mentions/search), and it applies its own rules: never the searcher,
 * only members who allow member search, no one either side has blocked. The profile
 * therefore shows the username only when that search returns this exact member, and
 * shows nothing otherwise — it never guesses.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getUser: jest.fn(),
    getProfile: jest.fn(),
    searchMentionUsers: jest.fn(),
    getMemberConnectionStatus: jest.fn(),
    getUserBlockStatus: jest.fn()
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const membersRoutes = require('../src/routes/members');
const { PREFIX, createApp, t } = require('./react-parity-harness');

function prepare(req, res, next) {
  req.secret = 'test-cookie-secret';
  next();
}

const app = createApp('/members', [membersRoutes], { before: [prepare] });

beforeEach(() => {
  jest.clearAllMocks();
  api.getUser.mockResolvedValue({ data: { id: 7, name: 'Ann', first_name: 'Ann' } });
  api.getProfile.mockResolvedValue({ data: { id: 1, name: 'Me' } });
  api.getMemberConnectionStatus.mockResolvedValue({ data: { status: 'none' } });
  api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: false, is_blocked_by: false } });
  api.searchMentionUsers.mockResolvedValue({ data: [] });
});

describe('a member profile shows the username to @mention them', () => {
  it('shows the username the mention search returns for this exact member', async () => {
    api.searchMentionUsers.mockResolvedValue({
      data: [
        { id: 70, name: 'Ann Other', username: 'ann_other' },
        { id: 7, name: 'Ann', username: 'ann.lee' }
      ]
    });
    const res = await request(app).get(`${PREFIX}/members/7`);

    expect(res.status).toBe(200);
    expect(api.searchMentionUsers).toHaveBeenCalledWith('test-token', 'Ann');
    expect(res.text).toContain(t('govuk_alpha_members.mention.label'));
    expect(res.text).toContain('@ann.lee');
    expect(res.text).toContain(t('govuk_alpha_members.mention.hint', { mention: '@ann.lee' }));
    expect(res.text).not.toContain('@ann_other');
  });

  it('shows no username line when the search does not return this member', async () => {
    api.searchMentionUsers.mockResolvedValue({ data: [{ id: 70, name: 'Ann Other', username: 'ann_other' }] });
    const res = await request(app).get(`${PREFIX}/members/7`);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_members.mention.label'));
    expect(res.text).not.toContain('@ann_other');
  });

  it('does not offer a username the server could not read back from "@"', async () => {
    api.searchMentionUsers.mockResolvedValue({ data: [{ id: 7, name: 'Ann', username: 'ann lee' }] });
    const res = await request(app).get(`${PREFIX}/members/7`);
    expect(res.text).not.toContain(t('govuk_alpha_members.mention.label'));
  });

  it('still shows the profile when the search fails', async () => {
    api.searchMentionUsers.mockRejectedValue(new api.ApiError('boom', 500));
    const res = await request(app).get(`${PREFIX}/members/7`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_members.mention.label'));
  });

  it('does not search on the member\'s own profile (the API never returns the searcher)', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Ann' } });
    await request(app).get(`${PREFIX}/members/7`);
    expect(api.searchMentionUsers).not.toHaveBeenCalled();
  });
});
