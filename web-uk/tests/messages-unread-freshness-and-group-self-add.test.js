// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Three defects found by WALKING the messaging journey on 2026-08-24.
 *
 * 1. THE INBOX CONTRADICTED ITSELF ABOUT UNREAD MESSAGES. The page summary comes
 *    from a count cached for 15 seconds; the per-conversation row badge comes
 *    from the live conversation list. Both render the identical words "1 unread
 *    message", and they disagreed in BOTH directions — the summary kept claiming
 *    an unread message for up to 15s after it had been read, and missed one that
 *    had just arrived while the row beside it showed it. Measured against the
 *    API at each step.
 *
 *    Reading a conversation is what marks it read: GET /api/v2/messages/{id}
 *    takes the count 1 -> 0 as a side effect, with no explicit call. So the
 *    conversation page now drops the cached count, and the inbox reads its own
 *    subject matter fresh.
 *
 * 2. THE GROUP-CREATE PAGE OFFERED THE CREATOR AS A MEMBER TO ADD. Taking that
 *    offer listed them twice — as "You (administrator)" and again as a nameless
 *    "Community member" — counted towards the page's own "at least two other
 *    members" rule, so the page said the group could be created, and the API
 *    then refused it with an unexplained "We could not create the group".
 *
 * 3. AN UNCONFIGURED TRANSLATION PROVIDER WAS REPORTED AS A FAILURE. The API now
 *    answers TRANSLATION_UNAVAILABLE, so the member is told it is not available
 *    here instead of being told to try again — which could never work.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getConversations: jest.fn(),
    getUnreadCount: jest.fn(),
    invalidateMessageUnreadCount: jest.fn(),
    callMessageApi: jest.fn(),
    callConversationApi: jest.fn(),
    searchUsers: jest.fn(),
    getUser: jest.fn(),
    getProfile: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const messagesRoutes = require('../src/routes/messages');

const ME = 900014;

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'messages-freshness-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '24 August 2026',
    });
    next();
  }, messagesRoutes);
  return app;
}

const app = mount();

describe('the inbox and the conversation page agree about unread messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: ME, name: 'E2E UserA' } });
    api.getConversations.mockResolvedValue({ data: [], meta: {} });
    api.getUnreadCount.mockResolvedValue({ data: { count: 0 } });
    api.callMessageApi.mockResolvedValue({ data: { messages: [] } });
  });

  it('reads its own unread count FRESH on the inbox, not from the 15s cache', async () => {
    await request(app).get('/');
    // Without `fresh`, a count cached before a message arrived made the page
    // summary say nothing while the row beside it said "1 unread message".
    expect(api.getUnreadCount).toHaveBeenCalledWith('token:test', { fresh: true });
  });

  it('drops the cached count when a conversation is opened', async () => {
    const res = await request(app).get(`/${900015}`);
    expect(res.status).toBe(200);
    // The GET above IS the read event — the API marks the conversation read as a
    // side effect. Without this the inbox keeps announcing an unread message.
    expect(api.invalidateMessageUnreadCount).toHaveBeenCalledWith('token:test');
  });

  it('drops it before rendering, so a redirect straight back to the inbox is correct too', async () => {
    await request(app).get(`/${900015}`);
    const invalidateOrder = api.invalidateMessageUnreadCount.mock.invocationCallOrder[0];
    const fetchOrder = api.callMessageApi.mock.invocationCallOrder[0];
    expect(invalidateOrder).toBeGreaterThan(fetchOrder);
  });
});

describe('the group-create page never offers the creator as a member', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: ME, name: 'E2E UserA' } });
    api.callMessageApi.mockResolvedValue({ data: {} });
    api.getUser.mockResolvedValue({ data: { id: 900015, name: 'E2E UserB' } });
  });

  it('filters the creator out of the search results', async () => {
    api.searchUsers.mockResolvedValue({
      data: [
        { id: ME, name: 'E2E UserA' },
        { id: 900015, name: 'E2E UserB' },
        { id: 900016, name: 'E2E Admin' },
      ],
    });
    const res = await request(app).get('/groups/new?q=e2e');
    expect(res.status).toBe(200);
    // "Add to group" is a GET form carrying members[]=<id>.
    expect(res.text).toContain(`value="${900015}"`);
    expect(res.text).toContain(`value="${900016}"`);
    expect(res.text).not.toContain(`name="members[]" value="${ME}"`);
  });

  it('ignores the creator if a hand-edited URL selects them', async () => {
    api.searchUsers.mockResolvedValue({ data: [] });
    const res = await request(app).get(`/groups/new?members[]=${ME}&members[]=900015`);
    expect(res.status).toBe(200);
    // One genuine other member selected => the page must still say two are needed.
    expect(res.text).toContain('at least two other members');
  });

  it('counts two genuine members as enough', async () => {
    api.searchUsers.mockResolvedValue({ data: [] });
    api.getUser
      .mockResolvedValueOnce({ data: { id: 900015, name: 'E2E UserB' } })
      .mockResolvedValueOnce({ data: { id: 900016, name: 'E2E Admin' } });
    const res = await request(app).get('/groups/new?members[]=900015&members[]=900016');
    // The warning belongs to the empty/short state, not to a valid selection.
    expect(res.text).not.toContain('You need to add at least two other members');
  });

  it('drops the creator from a submitted member list rather than failing opaquely', async () => {
    api.callConversationApi.mockResolvedValue({ data: { id: 77 } });
    const res = await request(app)
      .post('/groups')
      .type('form')
      .send({ name: 'Repair crew', 'member_ids[]': [String(ME), '900015', '900016'] });
    expect(res.status).toBe(302);
    const [, , , payload] = api.callConversationApi.mock.calls[0];
    expect(payload.member_ids).toEqual([900015, 900016]);
    expect(payload.member_ids).not.toContain(ME);
  });
});

describe('an unavailable translation provider is not reported as a failure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: ME, name: 'E2E UserA' } });
  });

  const refuse = (code, status) => {
    const error = new api.ApiError('nope', status, { errors: [{ code, message: 'x' }] });
    api.callMessageApi.mockRejectedValue(error);
  };

  it('sends TRANSLATION_UNAVAILABLE to the "not available" message', async () => {
    refuse('TRANSLATION_UNAVAILABLE', 503);
    const res = await request(app).post(`/${900015}/m/543/translate`).type('form').send({ target_language: 'de' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=translate-unavailable');
    // "try again later" is what it used to say, and it could never work.
    expect(res.headers.location).not.toContain('status=translate-failed');
  });

  it('still reports a genuine provider failure as a failure', async () => {
    refuse('TRANSLATION_FAILED', 500);
    const res = await request(app).post(`/${900015}/m/543/translate`).type('form').send({ target_language: 'de' });
    expect(res.headers.location).toContain('status=translate-failed');
  });

  it('keeps the existing empty-content answer', async () => {
    refuse('NO_CONTENT', 422);
    const res = await request(app).post(`/${900015}/m/543/translate`).type('form').send({ target_language: 'de' });
    expect(res.headers.location).toContain('status=translate-empty');
  });

  it('the two messages are different words, not the same sentence twice', () => {
    const t = createTranslator('en');
    const unavailable = t('govuk_alpha_messages.translate.unavailable');
    const failed = t('govuk_alpha_messages.translate.failed');
    expect(unavailable).toBeTruthy();
    expect(failed).toBeTruthy();
    expect(unavailable).not.toBe(failed);
    expect(unavailable).not.toMatch(/try again/i);
  });
});
