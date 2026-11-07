// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, Oct 2026, point 6: every image a member uploads
 * should carry the short description they wrote. Members can now describe
 * their profile photo (30 Oct), but another member's profile page still used
 * the decorative avatar partial with alt="", so a screen reader never heard it.
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
    callUserSettingsApi: jest.fn(),
    callUgcTranslateApi: jest.fn(),
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
const { PREFIX, createApp } = require('./react-parity-harness');

const app = createApp('/members', [membersRoutes], {
  before: [(req, res, next) => { req.secret = 'test-cookie-secret'; next(); }]
});

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 1, name: 'Me' } });
  api.getMemberConnectionStatus.mockResolvedValue({ data: { status: 'none' } });
  api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: false, is_blocked_by: false } });
  api.searchMentionUsers.mockResolvedValue({ data: [] });
});

describe('another member\'s profile photo', () => {
  it('is described with the words the member wrote', async () => {
    api.getUser.mockResolvedValue({ data: {
      id: 7, name: 'Ann', first_name: 'Ann',
      avatar_url: '/uploads/avatars/ann.jpg',
      avatar_alt: 'Ann smiling in her garden, holding a basket of apples'
    } });

    const res = await request(app).get(`${PREFIX}/members/7`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('alt="Ann smiling in her garden, holding a basket of apples"');
  });

  it('stays decorative beside the name when the member wrote nothing', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Ann', first_name: 'Ann', avatar_url: '/uploads/avatars/ann.jpg' } });

    const res = await request(app).get(`${PREFIX}/members/7`);

    expect(res.text).toMatch(/<img class="nexus-alpha-avatar nexus-alpha-avatar--large"[^>]*alt=""/);
  });
});

describe('other images the accessible site shows', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

  it('never reads a message photo\'s file name aloud', () => {
    const template = read('views/messages/direct-conversation.njk');
    expect(template).not.toMatch(/<img[^>]*alt="\{\{ attachmentName \}\}"/);
    expect(template).toContain("t('govuk_alpha_messages.attachments.photo_alt')");
  });

  it('describes a listing thumbnail with the member\'s own words where written', () => {
    for (const view of ['views/dashboard/index.njk', 'views/profile/index.njk']) {
      expect(read(view)).toContain("alt=\"{{ listing.imageAlt or t('listings.image_alt', { title: listing.title }) }}\"");
    }
    expect(read('routes/dashboard.js')).toMatch(/imageAlt: String\(\(listing && listing\.image_alt\) \|\| ''\)\.trim\(\)/);
    expect(read('routes/profile.js')).toMatch(/imageAlt: trimmed\(listing\?\.image_alt\)/);
  });
});
