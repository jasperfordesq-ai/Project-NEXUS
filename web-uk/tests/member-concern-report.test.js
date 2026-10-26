// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A member can report another member, or a direct message they received, to their
 * community's coordinators (26 Oct 2026). The API is
 * POST /api/v2/users/{id}/report and POST /api/v2/messages/{id}/report, each taking
 * { category, details? }.
 *
 * Pinned here:
 * - the profile offers "Report this member" next to Block, never on your own profile;
 * - a direct conversation offers "Report this message" on the OTHER person's messages
 *   only — the API accepts a report only from the message's receiver;
 * - the form is a GOV.UK question page: six reasons with hints, a 2,000-character
 *   count, the "not told who reported them" inset and the emergency warning;
 * - validation errors are mapped to the field they belong to, both our own and the
 *   API's, with the error summary pattern;
 * - "already reported" (409) is an information page, not an error;
 * - the messages report pages stay behind the messages module gate.
 */

const path = require('path');
const nunjucks = require('nunjucks');
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
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getUser: jest.fn(),
    reportMember: jest.fn(),
    reportMessage: jest.fn(),
    callMessageApi: jest.fn(),
    invalidateMessageUnreadCount: jest.fn()
  };
});

const api = require('../src/lib/api');
const { ApiError } = api;
const membersRoutes = require('../src/routes/members');
const messagesRoutes = require('../src/routes/messages');
const { routeGatesForPath } = require('../src/middleware/tenant-feature-gates');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { createChoiceTranslator } = require('../src/lib/localization');
const { characterCountMessages } = require('../src/lib/character-count-messages');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const K = 'govuk_alpha_members.concern_report';
const CATEGORIES = ['safeguarding_concern', 'harassment', 'inappropriate', 'scam_or_fraud', 'spam', 'other'];

// The real app signs cookies (an expired session clears them) and sets the
// translated character-count strings; the shared harness does neither.
function prepare(req, res, next) {
  req.secret = 'test-cookie-secret';
  res.locals.characterCountMessages = characterCountMessages(t, 'en');
  next();
}

const membersApp = (options) => createApp('/members', [membersRoutes], {
  before: [prepare],
  ...options
});
const messagesApp = (options) => createApp('/messages', [messagesRoutes], {
  before: [prepare],
  ...options
});

function decode(html) {
  return html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function apiError(status, code, message = 'Refused by the server', field = undefined) {
  return new ApiError(message, status, { errors: [{ code, message, ...(field ? { field } : {}) }] });
}

function renderView(view, context) {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([
      path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ]),
    { autoescape: true }
  );
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  const urlFor = (value) => `${PREFIX}${value}`;
  return env.render(view, {
    isAuthenticated: true,
    csrfToken: 'test-csrf',
    t,
    tc: createChoiceTranslator('en'),
    urlFor,
    formatLocaleNumber: (value) => String(value),
    formatLocaleDate: (value) => String(value),
    ...context
  });
}

beforeEach(() => jest.clearAllMocks());

describe('where the report links appear', () => {
  const profileContext = (overrides) => ({
    user: { id: 7, name: 'Sam Example' },
    displayName: 'Sam Example',
    isOwnProfile: false,
    isBlocked: false,
    profileStats: [],
    profileListings: [],
    profileSkills: [],
    reviews: [],
    gamificationBadges: [],
    ...overrides
  });

  it('offers "Report this member" next to Block on someone else’s profile', () => {
    const html = decode(renderView('members/profile.njk', profileContext()));
    expect(html).toContain(`href="${PREFIX}/members/7/report"`);
    expect(html).toContain(t(`${K}.link_member`));
    const reportAt = html.indexOf(t(`${K}.link_member`));
    const blockAt = html.indexOf(t('profile.block.toggle'));
    expect(blockAt).toBeGreaterThan(-1);
    // Next to the Block control: both sit in the same "not your own profile" block.
    expect(Math.abs(reportAt - blockAt)).toBeLessThan(1500);
  });

  it('still offers the report link when you have blocked them', () => {
    const html = renderView('members/profile.njk', profileContext({ isBlocked: true }));
    expect(html).toContain(`href="${PREFIX}/members/7/report"`);
  });

  it('never offers it on your own profile', () => {
    const html = renderView('members/profile.njk', profileContext({ isOwnProfile: true }));
    expect(html).not.toContain('/members/7/report');
  });

  it('offers "Report this message" on the other person’s messages only', () => {
    const html = decode(renderView('messages/direct-conversation.njk', {
      conversation: { id: 3, otherUser: { id: 3, name: 'Sam Example' } },
      messages: [
        { id: 55, body: 'From them', isOwn: false, isDeleted: false, displaySenderName: 'Sam Example' },
        { id: 56, body: 'From me', isOwn: true, isDeleted: false, canManage: true, displaySenderName: 'You' },
        { id: 57, body: '', isOwn: false, isDeleted: true, displaySenderName: 'Sam Example' }
      ],
      meta: {},
      canSend: true,
      directMessagingEnabled: true
    }));
    expect(html).toContain(`href="${PREFIX}/messages/3/m/55/report"`);
    expect(html).toContain(t(`${K}.link_message`));
    expect(html).not.toContain('/messages/3/m/56/report');
    expect(html).not.toContain('/messages/3/m/57/report');
  });
});

describe('report a member', () => {
  it('sends a signed-out visitor to sign in', async () => {
    const res = await request(membersApp({ signedIn: false })).get(`${PREFIX}/members/7/report`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/login?status=auth-required`);
  });

  it('shows the GOV.UK question page', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    const res = await request(membersApp()).get(`${PREFIX}/members/7/report`);
    expect(res.status).toBe(200);
    const html = decode(res.text);

    expect(html).toContain(t(`${K}.member_heading`, { name: 'Sam Example' }));
    expect(html).toContain(`action="${PREFIX}/members/7/report"`);
    expect(html).toContain('name="_csrf" value="test-csrf-token"');
    for (const category of CATEGORIES) {
      expect(html).toContain(`value="${category}"`);
      expect(html).toContain(t(`${K}.categories.${category}.label`));
      expect(html).toContain(t(`${K}.categories.${category}.hint`));
    }
    expect(html).toContain('id="category"');
    expect(html).toContain('data-module="govuk-character-count"');
    expect(html).toContain('data-maxlength="2000"');
    expect(html).toContain('maxlength="2000"');
    expect(html).toContain('id="details-info"');
    expect(html).toContain('govuk-inset-text');
    expect(html).toContain(t(`${K}.inset`));
    expect(html).toContain('govuk-warning-text');
    expect(html).toContain(t(`${K}.emergency_warning`));
    expect(html).toContain(`href="${PREFIX}/members/7"`);
    expect(html).not.toContain('govuk-error-summary');
  });

  it('still lets you report someone whose profile you cannot see', async () => {
    api.getUser.mockRejectedValue(apiError(403, 'FORBIDDEN'));
    const res = await request(membersApp()).get(`${PREFIX}/members/7/report`);
    expect(res.status).toBe(200);
    expect(decode(res.text)).toContain(t(`${K}.member_heading_unnamed`));
  });

  it('files the report and confirms it with a panel', async () => {
    api.reportMember.mockResolvedValue({ data: { reported: true, report_id: 4321 } });
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form')
      .send({ _csrf: 'test-csrf-token', category: 'harassment', details: '  Repeated unwanted messages.  ' });

    expect(api.reportMember).toHaveBeenCalledWith('test-token', 7, {
      category: 'harassment',
      details: 'Repeated unwanted messages.'
    });
    expect(res.status).toBe(200);
    const html = decode(res.text);
    expect(html).toContain('govuk-panel--confirmation');
    expect(html).toContain(t(`${K}.sent_title`));
    expect(html).toContain('4321');
    expect(html).toContain(`href="${PREFIX}/members/7"`);
  });

  it('leaves details out when the member wrote none', async () => {
    api.reportMember.mockResolvedValue({ data: { reported: true, report_id: 1 } });
    await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam', details: '   ' });
    expect(api.reportMember).toHaveBeenCalledWith('test-token', 7, { category: 'spam' });
  });

  it('asks for a reason before calling the API', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ details: 'Kept' });
    expect(res.status).toBe(422);
    expect(api.reportMember).not.toHaveBeenCalled();
    const html = decode(res.text);
    expect(html).toContain('govuk-error-summary');
    expect(html).toContain(`<a href="#category">${t(`${K}.errors.category_required`)}</a>`);
    expect(html).toContain('id="category-error"');
    expect(html).toContain('Kept</textarea>');
    expect(html).toMatch(/<title>[^<]*Error/);
  });

  it('asks for details when the reason is "something else"', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'other' });
    expect(res.status).toBe(422);
    expect(api.reportMember).not.toHaveBeenCalled();
    const html = decode(res.text);
    expect(html).toContain(`<a href="#details">${t(`${K}.errors.details_required`)}</a>`);
    expect(html).toContain('id="details-error"');
    expect(html).toMatch(/value="other"[^>]*checked/);
  });

  it('refuses details longer than 2,000 characters', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form')
      .send({ category: 'spam', details: 'x'.repeat(2001) });
    expect(res.status).toBe(422);
    expect(api.reportMember).not.toHaveBeenCalled();
    expect(decode(res.text)).toContain('<a href="#details">');
  });

  it('puts the API’s own validation message on the field it names', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    api.reportMember.mockRejectedValue(apiError(422, 'VALIDATION_ERROR', 'Tell us more, translated by the server', 'details'));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam', details: 'a' });
    expect(res.status).toBe(422);
    const html = decode(res.text);
    expect(html).toContain('<a href="#details">Tell us more, translated by the server</a>');
    expect(html).toContain('id="details-error"');
  });

  it('shows "you cannot report yourself" as a form error', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    api.reportMember.mockRejectedValue(apiError(422, 'CANNOT_REPORT_SELF', 'You cannot report yourself, translated'));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(422);
    expect(decode(res.text)).toContain('You cannot report yourself, translated');
  });

  it('tells a member who has already reported them, without calling it an error', async () => {
    api.reportMember.mockRejectedValue(apiError(409, 'ALREADY_REPORTED'));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(200);
    const html = decode(res.text);
    expect(html).toContain(t(`${K}.already_title`));
    expect(html).not.toContain('govuk-error-summary');
    expect(html).not.toMatch(/<title>[^<]*Error/);
  });

  it('shows the not-found page for a member who does not exist', async () => {
    api.reportMember.mockRejectedValue(apiError(404, 'NOT_FOUND'));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(404);
  });

  it('keeps the answers and says so when too many reports were sent', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    api.reportMember.mockRejectedValue(new ApiError('Too many', 429, { errors: [{ code: 'RATE_LIMITED', message: 'Too many requests, translated' }] }));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam', details: 'Kept' });
    expect(res.status).toBe(429);
    const html = decode(res.text);
    expect(html).toContain('Too many requests, translated');
    expect(html).toContain('Kept</textarea>');
  });

  it('says the report was not sent when the API fails', async () => {
    api.getUser.mockResolvedValue({ data: { id: 7, name: 'Sam Example' } });
    api.reportMember.mockRejectedValue(new ApiError('Boom', 500, { errors: [{ code: 'SERVER_ERROR', message: 'internal' }] }));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(502);
    const html = decode(res.text);
    expect(html).toContain(t(`${K}.errors.failed`));
    expect(html).not.toContain('internal');
  });

  it('sends an expired session to sign in', async () => {
    api.reportMember.mockRejectedValue(apiError(401, 'AUTH_REQUIRED'));
    const res = await request(membersApp()).post(`${PREFIX}/members/7/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/login?status=auth-required`);
  });
});

describe('report a message', () => {
  it('stays behind the messages module gate', () => {
    expect(routeGatesForPath('/messages/3/m/55/report').map((gate) => gate.moduleKey)).toContain('messages');
  });

  it('shows the question page for that message', async () => {
    api.getUser.mockResolvedValue({ data: { id: 3, name: 'Sam Example' } });
    const res = await request(messagesApp()).get(`${PREFIX}/messages/3/m/55/report`);
    expect(res.status).toBe(200);
    const html = decode(res.text);
    expect(html).toContain(t(`${K}.message_heading`, { name: 'Sam Example' }));
    expect(html).toContain(`action="${PREFIX}/messages/3/m/55/report"`);
    expect(html).toContain(`href="${PREFIX}/messages/3#m-55"`);
    for (const category of CATEGORIES) expect(html).toContain(`value="${category}"`);
    expect(html).toContain(t(`${K}.emergency_warning`));
  });

  it('files the report against the message and links back to the conversation', async () => {
    api.callMessageApi.mockResolvedValue({ data: { reported: true, report_id: 99 } });
    const res = await request(messagesApp()).post(`${PREFIX}/messages/3/m/55/report`).type('form')
      .send({ category: 'scam_or_fraud', details: 'Asked for my bank details' });
    expect(api.callMessageApi).toHaveBeenCalledWith('test-token', 'POST', '/55/report', {
      category: 'scam_or_fraud',
      details: 'Asked for my bank details'
    });
    expect(res.status).toBe(200);
    const html = decode(res.text);
    expect(html).toContain('govuk-panel--confirmation');
    expect(html).toContain('99');
    expect(html).toContain(`href="${PREFIX}/messages/3"`);
  });

  it('maps a validation error to the right field', async () => {
    api.getUser.mockResolvedValue({ data: { id: 3, name: 'Sam Example' } });
    const res = await request(messagesApp()).post(`${PREFIX}/messages/3/m/55/report`).type('form').send({});
    expect(res.status).toBe(422);
    expect(api.callMessageApi).not.toHaveBeenCalled();
    expect(decode(res.text)).toContain(`<a href="#category">${t(`${K}.errors.category_required`)}</a>`);
  });

  it('treats a second report of the same message as information', async () => {
    api.callMessageApi.mockRejectedValue(apiError(409, 'ALREADY_REPORTED'));
    const res = await request(messagesApp()).post(`${PREFIX}/messages/3/m/55/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(200);
    expect(decode(res.text)).toContain(t(`${K}.already_title`));
  });

  it('shows not found for a message the member cannot report', async () => {
    api.callMessageApi.mockRejectedValue(apiError(404, 'NOT_FOUND'));
    const res = await request(messagesApp()).post(`${PREFIX}/messages/3/m/55/report`).type('form').send({ category: 'spam' });
    expect(res.status).toBe(404);
  });
});

describe('every report string is translated', () => {
  it('has English for each key the pages use', () => {
    const keys = [
      'link_member', 'link_message', 'member_heading', 'member_heading_unnamed', 'message_heading',
      'message_heading_unnamed', 'legend', 'details_label', 'details_hint', 'inset', 'emergency_warning',
      'submit', 'sent_title', 'sent_reference', 'sent_body', 'sent_next', 'already_title', 'already_body',
      'back_to_profile', 'back_to_conversation', 'errors.category_required', 'errors.details_required',
      'errors.details_too_long', 'errors.failed', 'errors.rate_limited'
    ];
    for (const key of keys) {
      expect(t(`${K}.${key}`)).not.toBe(`${K}.${key}`);
    }
    for (const category of CATEGORIES) {
      expect(t(`${K}.categories.${category}.label`)).not.toBe(`${K}.categories.${category}.label`);
      expect(t(`${K}.categories.${category}.hint`)).not.toBe(`${K}.categories.${category}.hint`);
    }
  });
});
