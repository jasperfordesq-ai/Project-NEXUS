// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  getChildAccounts: jest.fn(),
  getSupportedConversations: jest.fn(),
  getSupportedThread: jest.fn()
}));

const api = require('../src/lib/api');
const viewerRouter = require('../src/routes/settings-supported-messages');

/** A mutable fake session shared with the request, so a POST can seed a GET. */
let session;

function testApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'test-token';
    req.session = session;
    res.locals.t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => `/hour-timebank/accessible${pathname}`;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/settings/linked-accounts/messages', viewerRouter);
  return app;
}

function seedLivePurpose(childId, purpose = 'Checking they are okay') {
  session[`alpha_msg_view_purpose_${childId}`] = { purpose, expires: Date.now() + 60_000 };
}

beforeEach(() => {
  jest.clearAllMocks();
  session = {};
  api.getChildAccounts.mockResolvedValue({ data: { children: [{ user_id: 12, name: 'Sam' }] } });
  api.getSupportedConversations.mockResolvedValue({ data: { conversations: [], has_more: false } });
  api.getSupportedThread.mockResolvedValue({ data: { items: [] } });
});

describe('Nothing is fetched before a reason is given', () => {
  it('renders the purpose form INSTEAD of the list, and fetches no messages', async () => {
    const response = await request(testApp()).get('/settings/linked-accounts/messages/12');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('settings/supported-messages-purpose');
    // The form is the page, not an overlay on loaded data.
    expect(api.getSupportedConversations).not.toHaveBeenCalled();
  });

  it('renders the purpose form for a thread too, carrying the partner through', async () => {
    const response = await request(testApp()).get('/settings/linked-accounts/messages/12/7');

    expect(response.body.view).toBe('settings/supported-messages-purpose');
    expect(response.body.locals.partnerId).toBe(7);
    expect(api.getSupportedThread).not.toHaveBeenCalled();
  });

  it('refuses a member who is not on this user’s own list, before any purpose is considered', async () => {
    const response = await request(testApp()).get('/settings/linked-accounts/messages/99');

    expect(response.headers.location).toContain('status=message-view-denied');
    expect(api.getSupportedConversations).not.toHaveBeenCalled();
  });
});

describe('The purpose is stored in the session, never in a URL', () => {
  it('stores it and redirects to the viewer with no purpose in the location', async () => {
    const response = await request(testApp())
      .post('/settings/linked-accounts/messages/12/purpose')
      .send('reason=safety&detail=Worried%20about%20a%20new%20contact');

    expect(response.status).toBe(302);
    // 🔴 The redirect target must not carry the reason: URLs reach access logs,
    // browser history and shared screenshots.
    expect(response.headers.location).toBe('/hour-timebank/accessible/settings/linked-accounts/messages/12');
    expect(response.headers.location).not.toContain('purpose');
    expect(response.headers.location).not.toContain('Worried');

    const stored = session.alpha_msg_view_purpose_12;
    expect(stored.purpose).toContain('reason_safety');
    expect(stored.purpose).toContain('Worried about a new contact');
    expect(stored.expires).toBeGreaterThan(Date.now());
  });

  it('redirects back to the thread when one was being opened', async () => {
    const response = await request(testApp())
      .post('/settings/linked-accounts/messages/12/purpose')
      .send('reason=wellbeing&partner_id=7');

    expect(response.headers.location).toBe('/hour-timebank/accessible/settings/linked-accounts/messages/12/7');
  });

  it('falls back to a known reason rather than storing an arbitrary one', async () => {
    await request(testApp())
      .post('/settings/linked-accounts/messages/12/purpose')
      .send('reason=because-i-want-to');

    expect(session.alpha_msg_view_purpose_12.purpose).toContain('reason_wellbeing');
  });

  it('caps the free-text detail so an unbounded note cannot be stored', async () => {
    await request(testApp())
      .post('/settings/linked-accounts/messages/12/purpose')
      .send(`reason=other&detail=${'x'.repeat(500)}`);

    const stored = session.alpha_msg_view_purpose_12.purpose;
    expect(stored).toContain('x'.repeat(300));
    expect(stored).not.toContain('x'.repeat(301));
  });
});

describe('Reading with a live purpose', () => {
  it('sends the purpose to the API and never puts it in the request path', async () => {
    seedLivePurpose(12, 'Weekly wellbeing check');

    const response = await request(testApp()).get('/settings/linked-accounts/messages/12');

    expect(response.body.view).toBe('settings/supported-messages');
    expect(api.getSupportedConversations).toHaveBeenCalledWith(
      'test-token', 12, 'Weekly wellbeing check', expect.objectContaining({ limit: 20 })
    );
  });

  it('reads a single thread with the same purpose', async () => {
    seedLivePurpose(12);
    api.getSupportedThread.mockResolvedValue({ data: { items: [{ body: 'Hello', sender_name: 'Sam' }] } });

    const response = await request(testApp()).get('/settings/linked-accounts/messages/12/7');

    expect(response.body.view).toBe('settings/supported-messages-thread');
    expect(api.getSupportedThread).toHaveBeenCalledWith('test-token', 12, 7, 'Checking they are okay');
    expect(response.body.locals.messages).toHaveLength(1);
  });

  it('treats an expired purpose as no purpose and asks again', async () => {
    session.alpha_msg_view_purpose_12 = { purpose: 'Stale', expires: Date.now() - 1000 };

    const response = await request(testApp()).get('/settings/linked-accounts/messages/12');

    expect(response.body.view).toBe('settings/supported-messages-purpose');
    expect(api.getSupportedConversations).not.toHaveBeenCalled();
    // The dead entry is cleared rather than left to be re-read.
    expect(session.alpha_msg_view_purpose_12).toBeUndefined();
  });

  it('does not let one member’s purpose unlock another member', async () => {
    api.getChildAccounts.mockResolvedValue({
      data: { children: [{ user_id: 12, name: 'Sam' }, { user_id: 13, name: 'Ada' }] }
    });
    seedLivePurpose(12);

    const response = await request(testApp()).get('/settings/linked-accounts/messages/13');

    expect(response.body.view).toBe('settings/supported-messages-purpose');
    expect(api.getSupportedConversations).not.toHaveBeenCalled();
  });

  it('refuses rather than showing anything when the grant has gone', async () => {
    seedLivePurpose(12);
    api.getSupportedConversations.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));

    const response = await request(testApp()).get('/settings/linked-accounts/messages/12');

    expect(response.headers.location).toContain('status=message-view-denied');
  });

  it('publishes a next cursor only when more remain', async () => {
    seedLivePurpose(12);
    api.getSupportedConversations.mockResolvedValue({ data: { conversations: [], has_more: false, cursor: 'abc' } });
    expect((await request(testApp()).get('/settings/linked-accounts/messages/12')).body.locals.nextCursor).toBeNull();

    api.getSupportedConversations.mockResolvedValue({ data: { conversations: [], has_more: true, cursor: 'abc' } });
    expect((await request(testApp()).get('/settings/linked-accounts/messages/12')).body.locals.nextCursor).toBe('abc');
  });
});

describe('The viewer pages render read-only', () => {
  const env = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true }
  );

  const shell = {
    t: (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key),
    urlFor: (pathname) => `/hour-timebank/accessible${pathname}`,
    isAuthenticated: true,
    alphaNavItems: [], alphaFooterColumns: [], alphaLocaleOptions: [], alphaCurrentLocale: 'en',
    csrfToken: 'test-csrf'
  };

  it('shows the warning before the field on the purpose form', () => {
    const html = env.render('settings/supported-messages-purpose.njk', {
      ...shell, childUserId: 12, childName: 'Sam', partnerId: null,
      reasons: ['wellbeing', 'safety', 'helping_reply', 'other']
    });

    expect(html).toContain('govuk-warning-text');
    expect(html.indexOf('purpose_warning')).toBeLessThan(html.indexOf('purpose_detail_label'));
    expect(html).toContain('name="reason"');
    expect(html).toContain('name="_csrf"');
    expect(html).toContain('maxlength="300"');
  });

  it('offers no reply box and no actions on the conversation list', () => {
    const html = env.render('settings/supported-messages.njk', {
      ...shell,
      childUserId: 12, childName: 'Sam',
      conversations: [{
        partner_id: 7,
        other_user: { id: 7, name: 'Petra' },
        last_message: { body: 'See you at ten' }
      }],
      nextCursor: null
    });

    expect(html).toContain('read_only_banner');
    expect(html).toContain('Petra');
    expect(html).toContain('See you at ten');
    // Read-only: nothing on this page posts anything.
    expect(html).not.toMatch(/<form[^>]*action="[^"]*messages/i);
    expect(html).not.toContain('name="body"');
  });

  it('names a voice message without offering to play it', () => {
    const html = env.render('settings/supported-messages-thread.njk', {
      ...shell,
      childUserId: 12, childName: 'Sam', partnerUserId: 7,
      messages: [{ sender_name: 'Petra', voice_url: 'https://example.test/a.mp3' }]
    });

    expect(html).toContain('voice_message');
    // The recording itself is not exposed on this page.
    expect(html).not.toContain('https://example.test/a.mp3');
    expect(html).not.toContain('<audio');
  });

  it('shows the empty states rather than a blank page', () => {
    expect(env.render('settings/supported-messages.njk', {
      ...shell, childUserId: 12, childName: 'Sam', conversations: [], nextCursor: null
    })).toContain('empty_list');

    expect(env.render('settings/supported-messages-thread.njk', {
      ...shell, childUserId: 12, childName: 'Sam', partnerUserId: 7, messages: []
    })).toContain('empty_thread');
  });
});
