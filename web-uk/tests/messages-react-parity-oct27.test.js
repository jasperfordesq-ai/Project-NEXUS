// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One-to-one messaging gaps found by the deep React parity audit of 27 Oct 2026
 * (frontend-drift/2026-10-27-deep-evidence, M1-M3 and the context card):
 *
 *  9. No reactions on one-to-one messages, and existing ones were not shown
 *     (React ConversationPage + MessageBubble; web-uk had them for groups only).
 * 10. A whole conversation could only be deleted for yourself. React offers
 *     "Delete for me" and "Delete for everyone".
 * 11. A safeguarding-restricted conversation showed a banner only. React offers
 *     "Ask a coordinator to help" (when the API allows it) and, when vetting is
 *     the reason, "Request a vetting review".
 * 12. Only listings got a context card. React also shows events, jobs and
 *     volunteering opportunities a conversation is about.
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
    callListingApi: jest.fn(),
    callJobApi: jest.fn(),
    callVolunteeringApi: jest.fn(),
    getEvent: jest.fn(),
    getProfile: jest.fn(),
    getUser: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const messagesRoutes = require('../src/routes/messages');

const ME = 1;
const OTHER = 22;

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'messages-parity-oct27-test-secret-32ch', resave: false, saveUninitialized: false }));
  app.use('/messages', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test' } };
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
      formatLocaleDate: () => '27 October 2026',
    });
    next();
  }, messagesRoutes);
  return app;
}

const app = mount();
const t = createTranslator('en');

function conversation({ messages = [], safeguarding = null, reactions = {} } = {}) {
  api.callMessageApi.mockImplementation(async (token, method, apiPath) => {
    if (String(apiPath).startsWith('/restriction-status')) return { data: {} };
    if (String(apiPath).startsWith('/reactions/batch')) return { data: { reactions } };
    if (method === 'GET') {
      return {
        data: messages,
        meta: { conversation: { other_user: { id: OTHER, name: 'Bea Smith' }, ...(safeguarding ? { safeguarding } : {}) } }
      };
    }
    return { data: {} };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: ME, name: 'Me' } });
});

describe('9. reactions on one-to-one messages', () => {
  it('shows existing reactions and offers the six React reactions', async () => {
    conversation({
      messages: [{ id: 501, body: 'Hi there', sender_id: OTHER, created_at: '2026-10-27T10:00:00Z' }],
      reactions: { 501: [{ emoji: '\u{1F44D}', count: 2, user_ids: [ME, OTHER] }] }
    });
    const res = await request(app).get(`/messages/${OTHER}`);
    expect(res.status).toBe(200);
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'GET', '/reactions/batch?ids=501');
    expect(res.text).toContain(t('govuk_alpha_messages.reactions.count_label', { emoji: '\u{1F44D}', count: 2 }));
    expect(res.text.split(`action="/messages/${OTHER}/m/501/react"`).length - 1).toBe(6);
    expect(res.text).toContain(t('govuk_alpha_messages.reactions.remove_with', { emoji: '\u{1F44D}' }));
  });

  it('toggles a reaction and returns to the message', async () => {
    conversation();
    api.callMessageApi.mockResolvedValueOnce({ data: { action: 'added' } });
    const res = await request(app).post(`/messages/${OTHER}/m/501/react`).type('form').send({ emoji: '❤️' });
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'POST', '/501/reactions', { emoji: '❤️' });
    expect(res.headers.location).toBe(`/messages/${OTHER}?status=reaction-added#m-501`);
  });

  it('refuses an emoji React does not offer', async () => {
    conversation();
    const res = await request(app).post(`/messages/${OTHER}/m/501/react`).type('form').send({ emoji: 'x' });
    expect(res.headers.location).toBe(`/messages/${OTHER}?status=reaction-invalid#m-501`);
    expect(api.callMessageApi).not.toHaveBeenCalledWith('token:test', 'POST', '/501/reactions', expect.anything());
  });

  it('shows the reaction outcome on the conversation page', async () => {
    conversation();
    const res = await request(app).get(`/messages/${OTHER}?status=reaction-removed`);
    expect(res.text).toContain(t('govuk_alpha_messages.status.reaction_removed'));
  });
});

describe('10. delete a whole conversation for me or for everyone', () => {
  it('links to a confirmation page offering both', async () => {
    conversation();
    const page = await request(app).get(`/messages/${OTHER}`);
    expect(page.text).toContain(`href="/messages/${OTHER}/delete"`);
    // The name comes from the member's profile, so the confirmation page does
    // not mark the conversation read.
    api.getUser.mockResolvedValueOnce({ data: { id: OTHER, name: 'Bea Smith' } });
    const confirm = await request(app).get(`/messages/${OTHER}/delete`);
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('name="scope" type="radio" value="self"');
    expect(confirm.text).toContain('name="scope" type="radio" value="everyone"');
    expect(confirm.text).toContain('Bea Smith');
  });

  it('deletes for everyone', async () => {
    conversation();
    const res = await request(app).post(`/messages/${OTHER}/delete`).type('form').send({ scope: 'everyone' });
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'DELETE', `/conversations/${OTHER}`, { scope: 'everyone' });
    expect(res.headers.location).toBe('/messages?status=conversation-deleted');
    api.getConversations.mockResolvedValue({ data: [], meta: {} });
    api.getUnreadCount.mockResolvedValue({ data: { count: 0 } });
    const inbox = await request(app).get('/messages?status=conversation-deleted');
    expect(inbox.text).toContain(t('govuk_alpha_messages.delete_conversation.deleted'));
  });

  it('deletes for me only', async () => {
    conversation();
    const res = await request(app).post(`/messages/${OTHER}/delete`).type('form').send({ scope: 'self' });
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'DELETE', `/conversations/${OTHER}`, { scope: 'self' });
    expect(res.headers.location).toBe('/messages?status=conversation-archived');
  });

  it('asks again with an error when no choice was made', async () => {
    conversation();
    const res = await request(app).post(`/messages/${OTHER}/delete`).type('form').send({});
    expect(res.status).toBe(400);
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain(t('govuk_alpha_messages.delete_conversation.error_choose'));
  });
});

describe('11. safeguarding-restricted conversation actions', () => {
  it('offers coordinator help and a vetting review when vetting is required', async () => {
    conversation({ safeguarding: { restricted: true, code: 'VETTING_REQUIRED', can_request_coordinator: true, required_vetting_labels: ['Police check'] } });
    const res = await request(app).get(`/messages/${OTHER}`);
    expect(res.text).toContain(`action="/messages/${OTHER}/request-coordinator"`);
    expect(res.text).toContain('action="/profile/safeguarding/vetting-review"');
    expect(res.text).toContain('Police check');
  });

  it('offers neither when the API does not allow them', async () => {
    conversation({ safeguarding: { restricted: true, code: 'SAFEGUARDING_CONTACT_RESTRICTED', can_request_coordinator: false } });
    const res = await request(app).get(`/messages/${OTHER}`);
    expect(res.text).not.toContain('/request-coordinator"');
    expect(res.text).not.toContain('/profile/safeguarding/vetting-review');
  });

  it('asks the API to alert a coordinator', async () => {
    conversation();
    const res = await request(app).post(`/messages/${OTHER}/request-coordinator`).type('form').send({});
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'POST', `/${OTHER}/request-coordinator`, {});
    expect(res.headers.location).toBe(`/messages/${OTHER}?status=coordinator-requested#safeguarding-notice`);
    const page = await request(app).get(`/messages/${OTHER}?status=coordinator-requested`);
    expect(page.text).toContain(t('govuk_alpha_messages.safeguarding.coordinator_sent'));
  });

  it('reports a refused coordinator request', async () => {
    const { ApiError } = api;
    conversation();
    api.callMessageApi.mockRejectedValueOnce(new ApiError('no', 422, {}));
    const res = await request(app).post(`/messages/${OTHER}/request-coordinator`).type('form').send({});
    expect(res.headers.location).toBe(`/messages/${OTHER}?status=coordinator-request-failed#safeguarding-notice`);
  });
});

describe('12. context cards for events, jobs and volunteering', () => {
  it('shows the event a new conversation is about and sends the context with the message', async () => {
    conversation();
    api.getEvent.mockResolvedValue({ data: { id: 77, title: 'Repair cafe' } });
    const res = await request(app).get(`/messages/${OTHER}?context_type=event&context_id=77`);
    expect(api.getEvent).toHaveBeenCalledWith('token:test', 77);
    expect(res.text).toContain('href="/events/77"');
    expect(res.text).toContain('Repair cafe');
    expect(res.text).toContain('name="context_type" value="event"');
    expect(res.text).toContain('name="context_id" value="77"');
  });

  it('finds the context on an existing conversation\'s messages', async () => {
    conversation({ messages: [{ id: 9, body: 'About the job', sender_id: ME, context_type: 'job', context_id: 12 }] });
    api.callJobApi.mockResolvedValue({ data: { id: 12, title: 'Gardener' } });
    const res = await request(app).get(`/messages/${OTHER}`);
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'GET', '/12');
    expect(res.text).toContain('href="/jobs/12"');
    expect(res.text).toContain('Gardener');
  });

  it('links a volunteering opportunity', async () => {
    conversation();
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 3, title: 'Litter pick' } });
    const res = await request(app).get(`/messages/${OTHER}?context_type=volunteering&context_id=3`);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('token:test', 'GET', '/opportunities/3');
    expect(res.text).toContain('href="/volunteering/opportunities/3"');
  });

  it('still shows a plain card when the item cannot be read', async () => {
    conversation();
    api.getEvent.mockRejectedValue(new Error('gone'));
    const res = await request(app).get(`/messages/${OTHER}?context_type=event&context_id=77`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/events/77"');
  });

  it('passes an event context through when sending', async () => {
    conversation();
    await request(app).post(`/messages/${OTHER}`).type('form').send({ body: 'Hello', context_type: 'event', context_id: '77' });
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'POST', '', { recipient_id: OTHER, body: 'Hello', context_type: 'event', context_id: 77 });
  });

  it('ignores an unknown context type', async () => {
    conversation();
    await request(app).post(`/messages/${OTHER}`).type('form').send({ body: 'Hello', context_type: 'bogus', context_id: '77' });
    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'POST', '', { recipient_id: OTHER, body: 'Hello' });
  });
});
