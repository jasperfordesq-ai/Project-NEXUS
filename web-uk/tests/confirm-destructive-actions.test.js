// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK "confirm a deletion": 19 destructive or declining actions used to happen on
 * one click (29 Oct 2026 deep audit M6). The first POST now renders the shared
 * confirmation page (warning button, Cancel link) and calls nothing; only the
 * confirmed POST reaches Laravel, with the member's original fields intact.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    deleteNotification: jest.fn(),
    blockMember: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: {} })),
  });
});
jest.mock('../src/middleware/auth', () => ({ requireAuth: (req, res, next) => next(), withTokenRefresh: (h) => h }));
jest.mock('../src/lib/auditLogger', () => ({ audit: new Proxy({}, { get: () => () => (req, res, next) => next() }) }));

const api = require('../src/lib/api');
const { confirmFirst } = require('../src/lib/confirm-action');
const t = createTranslator('en');

function mount(prefix, router) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'token:test';
    req.signedCookies = { token: 'token:test' };
    req.session = {};
    req.flash = () => [];
    res.locals.t = t;
    res.locals.urlFor = (v) => v;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use(prefix, router);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('notification delete', () => {
  const app = mount('/notifications', require('../src/routes/notifications'));

  it('asks first, with a warning button and "You cannot undo this", and deletes nothing', async () => {
    const res = await request(app).post('/notifications/7/delete').type('form').send({ _csrf: 'x' });
    expect(res.body.view).toBe('confirm-delete');
    expect(res.body.locals.confirmHeading).toBe(t('govuk_alpha.confirm_action.delete_notification'));
    expect(res.body.locals.confirmWarning).toBe(t('govuk_alpha.confirm_action.cannot_undo'));
    expect(res.body.locals.confirmButton).toBe(t('notifications.delete'));
    expect(res.body.locals.confirmAction).toBe('/notifications/7/delete');
    expect(res.body.locals.confirmFields).toEqual([]);
    expect(api.deleteNotification).not.toHaveBeenCalled();
  });

  it('deletes once confirmed', async () => {
    api.deleteNotification.mockResolvedValue({});
    await request(app).post('/notifications/7/delete').type('form').send({ confirmed: '1' });
    expect(api.deleteNotification).toHaveBeenCalledWith('token:test', '7');
  });
});

describe('member block', () => {
  const app = mount('/members', require('../src/routes/members'));

  it('carries the reason through the confirmation page', async () => {
    const res = await request(app).post('/members/12/block').type('form').send({ reason: 'Unwanted messages' });
    expect(res.body.view).toBe('confirm-delete');
    expect(res.body.locals.confirmWarning).toBe(t('profile.block.explain'));
    expect(res.body.locals.confirmFields).toEqual([{ name: 'reason', value: 'Unwanted messages' }]);
    expect(api.blockMember).not.toHaveBeenCalled();
  });

  it('Cancel on an unblock from the blocked-members list returns to that list', async () => {
    const res = await request(app).post('/members/12/unblock').type('form').send({ from: 'list' });
    expect(res.body.locals.cancelHref).toBe('/profile/blocked');
    expect(res.body.locals.confirmFields).toEqual([{ name: 'from', value: 'list' }]);
  });

  it('blocks once confirmed', async () => {
    api.blockMember.mockResolvedValue({});
    await request(app).post('/members/12/block').type('form').send({ reason: 'Unwanted messages', confirmed: '1' });
    expect(api.blockMember).toHaveBeenCalledWith('token:test', 12, 'Unwanted messages');
  });
});

describe('confirmFirst', () => {
  function fakeRes() {
    const res = { locals: { t }, rendered: null };
    res.render = (view, locals) => { res.rendered = { view, locals }; };
    return res;
  }

  it('sends Cancel to the fixed page the caller names (no Referer: Helmet sends no-referrer)', () => {
    const req = { token: 'token:test', body: {}, baseUrl: '/x', path: '/1/remove', get: () => '' };
    const res = fakeRes();
    expect(confirmFirst(req, res, 'remove_skill', { cancelHref: '/profile/settings' })).toBe(true);
    expect(res.rendered.locals.cancelHref).toBe('/profile/settings');
  });
});

describe('the 19 actions are all guarded', () => {
  it('every listed handler calls confirmFirst', () => {
    const counts = {
      connections: 1, courses: 1, 'federation-actions': 3, goals: 1, 'group-exchange-actions': 1, groups: 1,
      'ideation-actions': 1, jobs: 1, 'marketplace-actions': 1, 'marketplace-member-tools': 1, members: 2,
      notifications: 1, profile: 2, 'volunteering-actions': 1, 'volunteering-shifts': 1
    };
    let total = 0;
    for (const [file, expected] of Object.entries(counts)) {
      const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', `${file}.js`), 'utf8');
      const found = (source.match(/confirmFirst\(req, res, /g) || []).length;
      expect({ file, found }).toEqual({ file, found: expected });
      total += found;
    }
    expect(total).toBe(19);
  });

  it('every confirmation question is translated', () => {
    for (const loc of ['en', 'ga', 'ar']) {
      const tl = createTranslator(loc);
      for (const key of ['delete_comment', 'delete_notification', 'block_member', 'unblock_member', 'revoke_devices',
        'remove_skill', 'remove_participant', 'remove_list_item', 'decline_connection', 'decline_buddy',
        'decline_interview', 'decline_offer', 'cancel_join_request', 'cancel_shift', 'withdraw_urgent', 'cannot_undo']) {
        expect(tl(`govuk_alpha.confirm_action.${key}`)).not.toMatch(/^govuk_alpha\./);
      }
    }
  });
});

describe('signed out', () => {
  it('steps aside so the handler can send them to sign in', () => {
    const res = { locals: { t }, render: jest.fn() };
    expect(confirmFirst({ body: {}, baseUrl: '/x', path: '/1/remove', get: () => '' }, res, 'remove_skill')).toBe(false);
    expect(res.render).not.toHaveBeenCalled();
  });
});
