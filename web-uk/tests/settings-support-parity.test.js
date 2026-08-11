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
  getSupportActions: jest.fn(),
  confirmSupportAction: jest.fn(),
  declineSupportAction: jest.fn(),
  cancelSupportAction: jest.fn(),
  getChildAccounts: jest.fn(),
  getChildActivity: jest.fn(),
  requestMessageAccess: jest.fn(),
  withdrawMessageAccess: jest.fn()
}));

const api = require('../src/lib/api');
const supportActionsRouter = require('../src/routes/settings-support-actions');
const activityRouter = require('../src/routes/settings-linked-account-activity');
const messageAccessRouter = require('../src/routes/settings-message-access');

function testApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'test-token';
    res.locals.t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => `/hour-timebank/accessible${pathname}`;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/settings/support-actions', supportActionsRouter);
  app.use('/settings/linked-accounts/activity', activityRouter);
  app.use('/settings/linked-accounts/message-access', messageAccessRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getSupportActions.mockResolvedValue({ data: { actions: [] } });
});

describe('Support actions — the approval queue', () => {
  it('asks for both sides separately', async () => {
    await request(testApp()).get('/settings/support-actions');

    expect(api.getSupportActions).toHaveBeenCalledWith('test-token', 'supported');
    expect(api.getSupportActions).toHaveBeenCalledWith('test-token', 'supporter');
  });

  it('still shows what the member must answer when their own prepared list fails', async () => {
    api.getSupportActions.mockImplementation((token, role) => (role === 'supported'
      ? Promise.resolve({ data: { actions: [{ id: 4, action_type: 'listing_create', other_party_name: 'Bridget' }] } })
      : Promise.reject(new api.ApiError('boom', 500))));

    const response = await request(testApp()).get('/settings/support-actions');

    expect(response.status).toBe(200);
    expect(response.body.locals.incoming).toHaveLength(1);
    expect(response.body.locals.outgoing).toEqual([]);
  });

  it('shows a transfer amount of 0 rather than treating it as missing', async () => {
    api.getSupportActions.mockImplementation((token, role) => (role === 'supported'
      ? Promise.resolve({ data: { actions: [{ id: 4, action_type: 'credit_transfer', payload_summary: { amount: 0 } }] } })
      : Promise.resolve({ data: { actions: [] } })));

    const response = await request(testApp()).get('/settings/support-actions');

    expect(response.body.locals.incoming[0].detail).toBe(0);
  });

  it.each([
    ['approve', 'confirmSupportAction', 'support-approved'],
    ['decline', 'declineSupportAction', 'support-declined'],
    ['withdraw', 'cancelSupportAction', 'support-withdrawn']
  ])('routes the "%s" answer to the right call', async (answer, method, expectedStatus) => {
    api[method].mockResolvedValue({ data: {} });

    const response = await request(testApp())
      .post('/settings/support-actions/respond')
      .send(`action_id=4&answer=${answer}`);

    expect(api[method]).toHaveBeenCalled();
    expect(response.headers.location).toContain(`status=${expectedStatus}`);
  });

  it('declines with NO reason, because a reason is never required', async () => {
    api.declineSupportAction.mockResolvedValue({ data: {} });

    await request(testApp()).post('/settings/support-actions/respond').send('action_id=4&answer=decline');

    expect(api.declineSupportAction).toHaveBeenCalledWith('test-token', 4, '');
  });

  it('passes a reason when one is offered', async () => {
    api.declineSupportAction.mockResolvedValue({ data: {} });

    await request(testApp())
      .post('/settings/support-actions/respond')
      .send('action_id=4&answer=decline&reason=Not%20right%20now');

    expect(api.declineSupportAction).toHaveBeenCalledWith('test-token', 4, 'Not right now');
  });

  it('refuses an answer outside the vocabulary without calling anything', async () => {
    const response = await request(testApp())
      .post('/settings/support-actions/respond')
      .send('action_id=4&answer=confirm-everything');

    expect(api.confirmSupportAction).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=support-failed');
  });

  it('separates "already answered or expired" from a general failure', async () => {
    api.confirmSupportAction.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    const notFound = await request(testApp()).post('/settings/support-actions/respond').send('action_id=4&answer=approve');
    expect(notFound.headers.location).toContain('status=support-not-found');

    api.confirmSupportAction.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const failed = await request(testApp()).post('/settings/support-actions/respond').send('action_id=4&answer=approve');
    expect(failed.headers.location).toContain('status=support-failed');
  });
});

describe('Supported member activity summary', () => {
  it('renders only for a member on this user’s own list', async () => {
    api.getChildAccounts.mockResolvedValue({ data: { children: [{ user_id: 12, name: 'Sam' }] } });
    api.getChildActivity.mockResolvedValue({ data: { hours: { hours_given: 3 }, timeline: [] } });

    const response = await request(testApp()).get('/settings/linked-accounts/activity/12');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('settings/linked-account-activity');
    expect(response.body.locals.childName).toBe('Sam');
  });

  it('refuses a member id that is not theirs, without calling for the activity', async () => {
    api.getChildAccounts.mockResolvedValue({ data: { children: [{ user_id: 12, name: 'Sam' }] } });

    const response = await request(testApp()).get('/settings/linked-accounts/activity/99');

    // "Not yours" and "no grant" are the same outcome on purpose, so this
    // cannot be used to probe whether a member exists.
    expect(api.getChildActivity).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=activity-denied');
  });

  it('gives the same refusal when the grant is gone', async () => {
    api.getChildAccounts.mockResolvedValue({ data: { children: [{ user_id: 12, name: 'Sam' }] } });
    api.getChildActivity.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));

    const response = await request(testApp()).get('/settings/linked-accounts/activity/12');

    expect(response.headers.location).toContain('status=activity-denied');
  });

  it('caps the timeline at ten entries', async () => {
    api.getChildAccounts.mockResolvedValue({ data: { children: [{ user_id: 12, name: 'Sam' }] } });
    api.getChildActivity.mockResolvedValue({
      data: { timeline: Array.from({ length: 25 }, (_, i) => ({ activity_type: 'post', description: `p${i}` })) }
    });

    const response = await request(testApp()).get('/settings/linked-accounts/activity/12');

    expect(response.body.locals.timeline).toHaveLength(10);
  });
});

describe('Message access — the consent loop', () => {
  it('asks by raising the messages tier to assist, which grants nothing on its own', async () => {
    api.requestMessageAccess.mockResolvedValue({ data: {} });

    const response = await request(testApp())
      .post('/settings/linked-accounts/message-access/request')
      .send('relationship_id=5');

    // The backend turns this into a pending consent action; only the supported
    // member's own yes activates it.
    expect(api.requestMessageAccess).toHaveBeenCalledWith('test-token', 5);
    expect(response.headers.location).toContain('status=message-access-requested');
  });

  it('withdraws in one press with no reason asked', async () => {
    api.withdrawMessageAccess.mockResolvedValue({ data: {} });

    const response = await request(testApp())
      .post('/settings/linked-accounts/message-access/withdraw')
      .send('relationship_id=5');

    expect(api.withdrawMessageAccess).toHaveBeenCalledWith('test-token', 5);
    expect(response.headers.location).toContain('status=message-access-withdrawn');
  });

  it.each([
    ['request', 'requestMessageAccess'],
    ['withdraw', 'withdrawMessageAccess']
  ])('refuses a missing relationship id on %s', async (action, method) => {
    const response = await request(testApp())
      .post(`/settings/linked-accounts/message-access/${action}`)
      .send('');

    expect(api[method]).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=link-failed');
  });
});

describe('Support-action and activity pages render', () => {
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

  it('renders approve and decline as plain posts, with the reason never required', () => {
    const html = env.render('settings/support-actions.njk', {
      ...shell,
      incoming: [{ id: 4, typeKey: 'type_listing_create', other_party_name: 'Bridget', detail: 'Garden help', expiresOnLabel: '5 August 2026' }],
      outgoing: [], statusKey: null, statusIsSuccess: false, statusIsError: false
    });

    expect(html).toContain('value="approve"');
    expect(html).toContain('value="decline"');
    expect(html).toContain('nothing_without_you');
    expect(html).toContain('name="reason"');
    expect(html).not.toContain('required');
    expect(html).not.toMatch(/on(click|submit|change)=/i);
  });

  it('offers withdraw only while a prepared action is unanswered', () => {
    const pending = env.render('settings/support-actions.njk', {
      ...shell,
      incoming: [],
      outgoing: [{ id: 9, typeKey: 'type_credit_transfer', other_party_name: 'Sam', state: 'pending', stateTagClass: 'govuk-tag--yellow' }],
      statusKey: null, statusIsSuccess: false, statusIsError: false
    });
    expect(pending).toContain('value="withdraw"');

    const answered = env.render('settings/support-actions.njk', {
      ...shell,
      incoming: [],
      outgoing: [{ id: 9, typeKey: 'type_credit_transfer', other_party_name: 'Sam', state: 'confirmed', stateTagClass: 'govuk-tag--green' }],
      statusKey: null, statusIsSuccess: false, statusIsError: false
    });
    expect(answered).not.toContain('value="withdraw"');
  });

  it('renders the activity summary with no action on it at all', () => {
    const html = env.render('settings/linked-account-activity.njk', {
      ...shell,
      childName: 'Sam',
      hours: { hours_given: 3, hours_received: 0, net_balance: 3 },
      connections: null, engagement: null,
      timeline: [{ activity_type: 'post', description: 'Shared a notice' }]
    });

    expect(html).toContain('activity_hours_given');
    expect(html).toContain('Shared a notice');

    // Read-only in the strict sense. The shared layout carries its own forms
    // (cookie banner, language switcher), so the assertion that matters is that
    // nothing on THIS page submits anything about the supported member.
    expect(html).not.toMatch(/<form[^>]*action="[^"]*linked-accounts/i);
    expect(html).not.toMatch(/<form[^>]*action="[^"]*support-actions/i);
    expect(html).not.toContain('name="relationship_id"');
  });

  it('shows a zero balance rather than omitting the row', () => {
    const html = env.render('settings/linked-account-activity.njk', {
      ...shell,
      childName: 'Sam',
      hours: { hours_given: 0, hours_received: 0, net_balance: 0 },
      connections: null, engagement: null, timeline: []
    });

    expect(html).toContain('activity_hours_given');
    expect(html).toContain('activity_timeline_empty');
  });
});
