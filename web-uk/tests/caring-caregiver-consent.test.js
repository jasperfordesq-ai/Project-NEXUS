// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community caregiver links — what the accessible frontend offers, and
 * what it refuses to offer.
 *
 * 🔴 The assertions that matter here are the NEGATIVE ones. This journey grants
 * one person authority over another person's care, so the important question is
 * not "does approve work" but "is approve withheld in every case where consent
 * has not been established". Each of those is pinned below.
 */

const express = require('express');
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
  getMyCaregiverLinks: jest.fn(),
  getIncomingCaregiverLinks: jest.fn(),
  createCaregiverLink: jest.fn(),
  confirmIncomingCaregiverLink: jest.fn(),
  rejectIncomingCaregiverLink: jest.fn(),
  getCaregiverLinksForReview: jest.fn(),
  approveCaregiverLink: jest.fn(),
  rejectCaregiverLink: jest.fn(),
  createCaregiverRequestOnBehalf: jest.fn(),
  searchUsers: jest.fn()
}));

const api = require('../src/lib/api');
const caringRouter = require('../src/routes/caring');

function testApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'test-token';
    req.accessibleRouting = { tenantSlug: 'e2e-community', tenant: { slug: 'e2e-community' } };
    res.locals.t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => `/e2e-community/accessible${pathname}`;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/caring', caringRouter);
  return app;
}

function link(overrides = {}) {
  return {
    id: 9,
    caregiver_id: 100,
    caregiver_name: 'Ada Caregiver',
    cared_for_id: 200,
    cared_for_name: 'Bea Recipient',
    relationship_type: 'neighbour',
    status: 'pending',
    recipient_confirmed_at: null,
    rejection_reason: null,
    start_date: '2026-08-29',
    created_at: '2026-08-29T10:00:00Z',
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getMyCaregiverLinks.mockResolvedValue({ data: [] });
  api.getIncomingCaregiverLinks.mockResolvedValue({ data: [] });
  api.getCaregiverLinksForReview.mockResolvedValue({ data: [] });
  api.searchUsers.mockResolvedValue({ data: { items: [] } });
});

describe('A pending relationship confers nothing', () => {
  it('names WHICH gate a pending request is waiting on', async () => {
    api.getMyCaregiverLinks.mockResolvedValue({
      data: [link({ recipient_confirmed_at: null })]
    });

    const response = await request(testApp()).get('/caring/caregiver');

    // "Pending" alone would leave the member unable to tell whether they are
    // waiting on the other person or on staff.
    expect(response.body.locals.links[0].stageKey).toBe('status_pending_recipient');
    expect(response.body.locals.links[0].isActive).toBe(false);
  });

  it('moves to the staff gate once the recipient has agreed', async () => {
    api.getMyCaregiverLinks.mockResolvedValue({
      data: [link({ recipient_confirmed_at: '2026-08-29T11:00:00Z' })]
    });

    const response = await request(testApp()).get('/caring/caregiver');

    // 🔴 Still not active. Recipient agreement is necessary, never sufficient.
    expect(response.body.locals.links[0].stageKey).toBe('status_pending_staff');
    expect(response.body.locals.links[0].isActive).toBe(false);
  });

  it.each(['pending', 'rejected', 'inactive'])(
    'refuses the on-behalf page for a "%s" relationship',
    async (status) => {
      api.getMyCaregiverLinks.mockResolvedValue({ data: [link({ status })] });

      const response = await request(testApp()).get('/caring/caregiver/on-behalf/200');

      // Offering the form and only failing on submit would tell the member they
      // hold authority they do not have.
      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('status=on-behalf-failed');
      expect(api.createCaregiverRequestOnBehalf).not.toHaveBeenCalled();
    }
  );

  it('offers the on-behalf page only for an active relationship', async () => {
    api.getMyCaregiverLinks.mockResolvedValue({ data: [link({ status: 'active' })] });

    const response = await request(testApp()).get('/caring/caregiver/on-behalf/200');

    expect(response.status).toBe(200);
    expect(response.body.locals.link.isActive).toBe(true);
  });

  it('refuses an on-behalf POST for a member the caller has no link with', async () => {
    api.getMyCaregiverLinks.mockResolvedValue({ data: [link({ status: 'active', cared_for_id: 200 })] });

    const response = await request(testApp())
      .post('/caring/caregiver/on-behalf/999')
      .type('form')
      .send({ title: 'Lift to hospital' });

    expect(response.headers.location).toContain('status=on-behalf-failed');
    expect(api.createCaregiverRequestOnBehalf).not.toHaveBeenCalled();
  });
});

describe('The care recipient answers for themselves', () => {
  it('lists only requests still awaiting THIS member’s answer', async () => {
    api.getIncomingCaregiverLinks.mockResolvedValue({
      data: [
        link({ id: 1, recipient_confirmed_at: null }),
        link({ id: 2, recipient_confirmed_at: '2026-08-29T11:00:00Z' }),
        link({ id: 3, status: 'rejected' })
      ]
    });

    const response = await request(testApp()).get('/caring/caregiver');

    // One already agreed to is waiting on staff, not on them.
    expect(response.body.locals.incoming.map((row) => row.id)).toEqual([1]);
  });

  it('agreeing calls confirm and never activates the link itself', async () => {
    api.confirmIncomingCaregiverLink.mockResolvedValue({ data: link({ recipient_confirmed_at: 'now' }) });

    const response = await request(testApp())
      .post('/caring/caregiver/incoming/respond')
      .type('form')
      .send({ link_id: '9', action: 'confirm' });

    expect(api.confirmIncomingCaregiverLink).toHaveBeenCalledWith('test-token', 9);
    expect(api.approveCaregiverLink).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=incoming-confirmed');
  });

  it('refusing calls reject', async () => {
    api.rejectIncomingCaregiverLink.mockResolvedValue({ data: link({ status: 'rejected' }) });

    const response = await request(testApp())
      .post('/caring/caregiver/incoming/respond')
      .type('form')
      .send({ link_id: '9', action: 'reject', reason: 'I do not agree' });

    expect(api.rejectIncomingCaregiverLink).toHaveBeenCalledWith('test-token', 9, 'I do not agree');
    expect(response.headers.location).toContain('status=incoming-rejected');
  });

  it('ignores an unknown action rather than guessing one', async () => {
    const response = await request(testApp())
      .post('/caring/caregiver/incoming/respond')
      .type('form')
      .send({ link_id: '9', action: 'approve' });

    expect(api.confirmIncomingCaregiverLink).not.toHaveBeenCalled();
    expect(api.rejectIncomingCaregiverLink).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=incoming-failed');
  });
});

describe('Asking to care for someone', () => {
  it('reads the paginated { items } search shape, not just a bare array', async () => {
    // 🔴 /v2/users/search answers { data: { items: [...] } }. The React page
    // expected an array, read `.length` on the object, got undefined, and
    // rendered "no results" for every query — making its form impossible to
    // complete. This pins the real shape here.
    api.searchUsers.mockResolvedValue({ data: { items: [{ id: 200, name: 'Bea Recipient' }] } });

    const response = await request(testApp()).get('/caring/caregiver/link?q=Bea');

    expect(response.body.locals.results).toEqual([{ id: 200, name: 'Bea Recipient' }]);
  });

  it('creates the request with the chosen member and a normalised date', async () => {
    api.createCaregiverLink.mockResolvedValue({ data: link() });

    const response = await request(testApp()).post('/caring/caregiver/link').type('form')
      .send({
      cared_for_id: '200',
      cared_for_name: 'Bea Recipient',
      relationship_type: 'neighbour',
      'start_date-day': '29',
      'start_date-month': '8',
      'start_date-year': '2026',
      notes: 'Weekly shopping'
    });

    expect(api.createCaregiverLink).toHaveBeenCalledWith('test-token', {
      caredForId: 200,
      relationshipType: 'neighbour',
      startDate: '2026-08-29',
      notes: 'Weekly shopping'
    });
    expect(response.headers.location).toContain('status=link-requested');
  });

  it.each([
    ['no member chosen', { relationship_type: 'neighbour', 'start_date-day': '29', 'start_date-month': '8', 'start_date-year': '2026' }, 'error_no_member'],
    ['no relationship', { cared_for_id: '200', 'start_date-day': '29', 'start_date-month': '8', 'start_date-year': '2026' }, 'error_no_relationship'],
    ['no date', { cared_for_id: '200', relationship_type: 'neighbour' }, 'error_no_start_date'],
    ['impossible date', { cared_for_id: '200', relationship_type: 'neighbour', 'start_date-day': '31', 'start_date-month': '2', 'start_date-year': '2026' }, 'error_bad_start_date']
  ])('refuses to send the request when there is %s', async (_label, body, expectedKey) => {
    const response = await request(testApp()).post('/caring/caregiver/link').type('form')
      .send(body);

    expect(api.createCaregiverLink).not.toHaveBeenCalled();
    // Re-rendered in place, not redirected, so the summary can take focus and
    // each message can link to the field it is about.
    expect(response.status).toBe(200);
    expect(response.body.locals.errors.map((e) => e.key)).toContain(expectedKey);
    for (const error of response.body.locals.errors) {
      expect(error.href.startsWith('#')).toBe(true);
    }
  });

  it('tells the member they already have a relationship rather than "it failed"', async () => {
    const error = new api.ApiError('conflict', 409);
    api.createCaregiverLink.mockRejectedValue(error);

    const response = await request(testApp()).post('/caring/caregiver/link').type('form')
      .send({
      cared_for_id: '200',
      relationship_type: 'family',
      'start_date-day': '29',
      'start_date-month': '8',
      'start_date-year': '2026'
    });

    expect(response.headers.location).toContain('status=link-duplicate');
  });
});

describe('Staff review — approval is withheld until consent is established', () => {
  it('does NOT offer approval while the recipient has not agreed', async () => {
    api.getCaregiverLinksForReview.mockResolvedValue({
      data: [link({ recipient_confirmed_at: null })]
    });

    const response = await request(testApp()).get('/caring/reviews');

    // 🔴 canApprove drives whether the approval FORM is rendered at all, not
    // whether a button is disabled. A disabled control is walked past by a
    // hand-edited form post.
    expect(response.body.locals.requests[0].recipientAgreed).toBe(false);
    expect(response.body.locals.requests[0].canApprove).toBe(false);
  });

  it('offers approval once the recipient has agreed', async () => {
    api.getCaregiverLinksForReview.mockResolvedValue({
      data: [link({ recipient_confirmed_at: '2026-08-29T11:00:00Z' })]
    });

    const response = await request(testApp()).get('/caring/reviews');

    expect(response.body.locals.requests[0].canApprove).toBe(true);
  });

  it('refuses to approve without recorded consent evidence', async () => {
    api.getCaregiverLinksForReview.mockResolvedValue({ data: [link()] });

    const response = await request(testApp())
      .post('/caring/reviews/9/decide')
      .type('form')
      .send({ action: 'approve', consent_verified: 'yes' });

    expect(api.approveCaregiverLink).not.toHaveBeenCalled();
    expect(response.body.locals.errors.map((e) => e.key)).toContain('error_no_evidence');
  });

  it('refuses to approve without the explicit attestation', async () => {
    api.getCaregiverLinksForReview.mockResolvedValue({ data: [link()] });

    const response = await request(testApp())
      .post('/caring/reviews/9/decide')
      .type('form')
      .send({ action: 'approve', consent_evidence: 'Telephone call on 29 August' });

    expect(api.approveCaregiverLink).not.toHaveBeenCalled();
    expect(response.body.locals.errors.map((e) => e.key)).toContain('error_no_attestation');
  });

  it('approves only with BOTH evidence and attestation', async () => {
    api.approveCaregiverLink.mockResolvedValue({ data: link({ status: 'active' }) });

    const response = await request(testApp())
      .post('/caring/reviews/9/decide')
      .type('form')
      .send({ action: 'approve', consent_evidence: 'Telephone call on 29 August', consent_verified: 'yes' });

    expect(api.approveCaregiverLink).toHaveBeenCalledWith('test-token', 9, 'Telephone call on 29 August');
    expect(response.headers.location).toContain('status=review-approved');
  });

  it('reports "the member has not agreed" distinctly from a general failure', async () => {
    // Laravel answers 422 when the care recipient has never confirmed. Telling
    // the reviewer only "something went wrong" leaves them unable to act.
    api.approveCaregiverLink.mockRejectedValue(new api.ApiError('not agreed', 422));

    const response = await request(testApp())
      .post('/caring/reviews/9/decide')
      .type('form')
      .send({ action: 'approve', consent_evidence: 'Telephone call', consent_verified: 'yes' });

    expect(response.headers.location).toContain('status=review-not-agreed');
  });

  it('refuses to reject without a reason, and preserves the reason when given', async () => {
    api.getCaregiverLinksForReview.mockResolvedValue({ data: [link()] });

    const blocked = await request(testApp())
      .post('/caring/reviews/9/decide')
      .type('form')
      .send({ action: 'reject', reason: '   ' });
    expect(api.rejectCaregiverLink).not.toHaveBeenCalled();
    expect(blocked.body.locals.errors.map((e) => e.key)).toContain('error_no_reason');

    api.rejectCaregiverLink.mockResolvedValue({ data: link({ status: 'rejected' }) });
    const allowed = await request(testApp())
      .post('/caring/reviews/9/decide')
      .type('form')
      .send({ action: 'reject', reason: 'Could not reach the member' });

    expect(api.rejectCaregiverLink).toHaveBeenCalledWith('test-token', 9, 'Could not reach the member');
    expect(allowed.headers.location).toContain('status=review-rejected');
  });

  it('renders an empty queue rather than someone else’s records when Laravel refuses', async () => {
    // Authorisation and tenant scoping are Laravel's. What this page must do is
    // fail SAFELY when it is refused.
    api.getCaregiverLinksForReview.mockRejectedValue(new api.ApiError('forbidden', 403));

    const response = await request(testApp()).get('/caring/reviews');

    expect(response.status).toBe(200);
    expect(response.body.locals.requests).toEqual([]);
  });
});
