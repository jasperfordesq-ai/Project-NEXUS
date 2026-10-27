// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A supporter prepares an action for the member they support (React
 * SupportPrepareModal): a time-credit transfer from THAT member's balance, or a
 * listing (with a photo when the supporter may act alone).
 *
 * The tier decides the endpoint, exactly as React:
 *   co_decide → POST /v2/users/me/support-actions (nothing happens until the
 *               supported member approves);
 *   represent → the proxy endpoints (happens now, attributed to the supporter).
 * Every money move or act-for-someone goes through a check page first.
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
  getSupportActions: jest.fn(),
  confirmSupportAction: jest.fn(),
  declineSupportAction: jest.fn(),
  cancelSupportAction: jest.fn(),
  getChildAccounts: jest.fn(),
  getSupportedMemberWallet: jest.fn(),
  prepareSupportAction: jest.fn(),
  transferForSupportedMember: jest.fn(),
  createListingForSupportedMember: jest.fn(),
  uploadSupportedMemberListingImage: jest.fn(),
  getListingCategories: jest.fn(),
  callWalletApi: jest.fn(),
  callUserSettingsApi: jest.fn()
}));

const api = require('../src/lib/api');
const router = require('../src/routes/settings-support-actions');

function testApp({ photoUploads = false, files = null } = {}) {
  const app = express();
  if (photoUploads) app.set('supportPreparePhotoUploads', true);
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'test-token';
    if (files) req.files = files;
    res.locals.t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => `/acme/accessible${pathname}`;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/settings/support-actions', router);
  return app;
}

function child(tiers, overrides = {}) {
  return {
    relationship_id: 7,
    user_id: 77,
    first_name: 'Mary',
    last_name: 'Casey',
    status: 'active',
    permissions: { tiers },
    ...overrides
  };
}

function walletConfig(max = 20) {
  api.callWalletApi.mockImplementation(async (token, method, path) => {
    if (path === '/config') return { data: { max_transfer: max } };
    if (path.startsWith('/user-search')) {
      return { data: { users: [{ id: 42, first_name: 'Alex', last_name: 'Recipient' }] } };
    }
    return { data: {} };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getChildAccounts.mockResolvedValue({ data: [child({ activity: 'none', listings: 'co_decide', credits: 'co_decide' })] });
  api.getSupportedMemberWallet.mockResolvedValue({ data: { balance: 12.5 } });
  api.getListingCategories.mockResolvedValue({ data: [{ id: 3, name: 'Gardening' }] });
  walletConfig();
});

describe('preparing a transfer', () => {
  it('shows the SUPPORTED member\'s balance and the tenant cap, and says nothing happens yet', async () => {
    const response = await request(testApp()).get('/settings/support-actions/prepare/77/transfer');

    expect(response.body.view).toBe('settings/support-prepare-transfer');
    expect(api.getSupportedMemberWallet).toHaveBeenCalledWith('test-token', 77);
    expect(response.body.locals.balance).toBe(12.5);
    expect(response.body.locals.maxTransfer).toBe(20);
    expect(response.body.locals.tier).toBe('co_decide');
    expect(response.body.locals.supportedName).toBe('Mary Casey');
    expect(response.body.locals.idempotencyKey).toMatch(/.{8,}/);
  });

  it('searches recipients and keeps the chosen one', async () => {
    const response = await request(testApp())
      .get('/settings/support-actions/prepare/77/transfer?recipient_q=Alex&recipient_id=42');

    expect(api.callWalletApi).toHaveBeenCalledWith('test-token', 'GET', '/user-search?q=Alex&limit=10');
    expect(response.body.locals.recipient).toEqual(expect.objectContaining({ id: 42, name: 'Alex Recipient' }));
  });

  it.each([
    ['credits off', { listings: 'co_decide', credits: 'none' }],
    ['credits see-only', { listings: 'none', credits: 'assist' }]
  ])('refuses when %s — only what the API permits is offered', async (_label, tiers) => {
    api.getChildAccounts.mockResolvedValue({ data: [child(tiers)] });

    const response = await request(testApp()).get('/settings/support-actions/prepare/77/transfer');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/settings/linked-accounts?status=support-not-allowed#children');
    expect(api.getSupportedMemberWallet).not.toHaveBeenCalled();
  });

  it('refuses someone who is not this supporter\'s supported member, and a pending link', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ credits: 'represent' }, { status: 'pending' })] });
    const pending = await request(testApp()).get('/settings/support-actions/prepare/77/transfer');
    const stranger = await request(testApp()).get('/settings/support-actions/prepare/99/transfer');

    expect(pending.headers.location).toContain('status=support-not-allowed');
    expect(stranger.headers.location).toContain('status=support-not-allowed');
  });

  it('checks the amount against THEIR balance before anything is sent', async () => {
    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/transfer/review')
      .send('recipient_id=42&recipient_q=Alex&amount=13&idempotency_key=abcdef123456');

    expect(response.body.view).toBe('settings/support-prepare-transfer');
    expect(response.body.locals.errors[0]).toEqual(expect.objectContaining({ href: '#amount' }));
    expect(response.body.locals.errors[0].text).toContain('validation_balance');
    expect(api.prepareSupportAction).not.toHaveBeenCalled();
    expect(api.transferForSupportedMember).not.toHaveBeenCalled();
  });

  it.each([
    ['no recipient', 'amount=2&idempotency_key=abcdef123456', 'validation_recipient'],
    ['no amount', 'recipient_id=42&recipient_q=Alex&idempotency_key=abcdef123456', 'validation_amount'],
    ['over the cap', 'recipient_id=42&recipient_q=Alex&amount=11&idempotency_key=abcdef123456', 'validation_max'],
    ['three decimals', 'recipient_id=42&recipient_q=Alex&amount=1.255&idempotency_key=abcdef123456', 'decimals']
  ])('refuses %s', async (_label, body, expected) => {
    walletConfig(10);
    const response = await request(testApp()).post('/settings/support-actions/prepare/77/transfer/review').send(body);

    expect(response.body.locals.errors[0].text).toContain(expected);
  });

  it('shows a check page that moves nothing', async () => {
    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/transfer/review')
      .send('recipient_id=42&recipient_q=Alex&amount=2&description=Garden&idempotency_key=abcdef123456');

    expect(response.body.view).toBe('settings/support-prepare-transfer-check');
    expect(response.body.locals.summary).toEqual(expect.objectContaining({
      recipientId: 42, recipientName: 'Alex Recipient', amount: 2, description: 'Garden'
    }));
    expect(api.prepareSupportAction).not.toHaveBeenCalled();
    expect(api.transferForSupportedMember).not.toHaveBeenCalled();
  });

  it('co_decide: prepares the action for approval with React\'s exact body', async () => {
    api.prepareSupportAction.mockResolvedValue({ data: { id: 5, status: 'pending' } });

    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/transfer')
      .send('recipient_id=42&recipient_q=Alex&amount=2&description=Garden&idempotency_key=abcdef123456');

    expect(api.prepareSupportAction).toHaveBeenCalledWith('test-token', 77, 'credit_transfer', {
      recipient: 42, amount: 2, description: 'Garden'
    });
    expect(api.transferForSupportedMember).not.toHaveBeenCalled();
    expect(response.headers.location).toBe('/acme/accessible/settings/support-actions?status=support-prepared');
  });

  it('represent: moves their credits through the proxy endpoint with the idempotency key', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ credits: 'represent' })] });
    api.transferForSupportedMember.mockResolvedValue({ data: { id: 900 } });

    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/transfer')
      .send('recipient_id=42&recipient_q=Alex&amount=1.5&idempotency_key=abcdef123456');

    expect(api.transferForSupportedMember).toHaveBeenCalledWith('test-token', 77, {
      recipient: 42, amount: 1.5, idempotency_key: 'abcdef123456'
    });
    expect(api.prepareSupportAction).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=support-done');
  });

  it('represent: refuses a missing or stubby idempotency key rather than risk a double transfer', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ credits: 'represent' })] });

    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/transfer')
      .send('recipient_id=42&recipient_q=Alex&amount=1&idempotency_key=abc');

    expect(api.transferForSupportedMember).not.toHaveBeenCalled();
    expect(response.body.view).toBe('settings/support-prepare-transfer');
  });

  it('reports a server refusal as not allowed, and nothing else as success', async () => {
    api.prepareSupportAction.mockRejectedValue(new api.ApiError('no', 403, { errors: [{ code: 'FORBIDDEN' }] }));

    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/transfer')
      .send('recipient_id=42&recipient_q=Alex&amount=2&idempotency_key=abcdef123456');

    expect(response.headers.location).toContain('status=support-not-allowed');
  });
});

describe('preparing a listing', () => {
  const listingBody = 'title=Dog+walking&type=offer&category_id=3&description=Happy+to+walk+dogs&hours_estimate=1&service_type=physical_only&location=Cork&skill_tags=dogs%2C+walking';

  it('co_decide: says a photo can only be added after approval, and offers no file field', async () => {
    const response = await request(testApp({ photoUploads: true })).get('/settings/support-actions/prepare/77/listing');

    expect(response.body.view).toBe('settings/support-prepare-listing');
    expect(response.body.locals.photoAfterApproval).toBe(true);
    expect(response.body.locals.photoOffered).toBe(false);
    expect(response.body.locals.categories).toEqual([{ id: 3, name: 'Gardening' }]);
  });

  it('represent: offers the photo step only when photo uploads are wired up', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ listings: 'represent' })] });
    const off = await request(testApp()).get('/settings/support-actions/prepare/77/listing');
    const on = await request(testApp({ photoUploads: true })).get('/settings/support-actions/prepare/77/listing');

    expect(off.body.locals.photoOffered).toBe(false);
    expect(on.body.locals.photoOffered).toBe(true);
  });

  it('refuses when listings are off', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ listings: 'none', credits: 'represent' })] });

    const response = await request(testApp()).get('/settings/support-actions/prepare/77/listing');

    expect(response.headers.location).toContain('status=support-not-allowed');
  });

  it('requires a title and a description before the check page', async () => {
    const response = await request(testApp()).post('/settings/support-actions/prepare/77/listing/review').send('type=offer');

    expect(response.body.view).toBe('settings/support-prepare-listing');
    expect(response.body.locals.errors.map((error) => error.href)).toEqual(expect.arrayContaining(['#title', '#description']));
  });

  it('shows a check page before anything is posted', async () => {
    const response = await request(testApp()).post('/settings/support-actions/prepare/77/listing/review').send(listingBody);

    expect(response.body.view).toBe('settings/support-prepare-listing-check');
    expect(response.body.locals.values.title).toBe('Dog walking');
    expect(api.prepareSupportAction).not.toHaveBeenCalled();
  });

  it('"change" goes back to the filled-in form, without putting the text in a URL', async () => {
    const response = await request(testApp())
      .post('/settings/support-actions/prepare/77/listing/review')
      .send(`${listingBody}&edit=1`);

    expect(response.body.view).toBe('settings/support-prepare-listing');
    expect(response.body.locals.values.title).toBe('Dog walking');
  });

  it('co_decide: stores the whole payload, skill tags included', async () => {
    api.prepareSupportAction.mockResolvedValue({ data: { id: 6 } });

    const response = await request(testApp()).post('/settings/support-actions/prepare/77/listing').send(listingBody);

    expect(api.prepareSupportAction).toHaveBeenCalledWith('test-token', 77, 'listing_create', {
      title: 'Dog walking',
      type: 'offer',
      category_id: 3,
      description: 'Happy to walk dogs',
      hours_estimate: 1,
      service_type: 'physical_only',
      location: 'Cork',
      skill_tags: ['dogs', 'walking']
    });
    expect(response.headers.location).toContain('status=support-prepared');
  });

  it('represent: posts through the proxy, then goes to the photo step when it is available', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ listings: 'represent' })] });
    api.createListingForSupportedMember.mockResolvedValue({ data: { id: 31 } });

    const withPhoto = await request(testApp({ photoUploads: true })).post('/settings/support-actions/prepare/77/listing').send(listingBody);
    const without = await request(testApp()).post('/settings/support-actions/prepare/77/listing').send(listingBody);

    expect(api.createListingForSupportedMember).toHaveBeenCalledWith('test-token', 77, expect.objectContaining({
      title: 'Dog walking', skill_tags: ['dogs', 'walking']
    }));
    expect(api.prepareSupportAction).not.toHaveBeenCalled();
    expect(withPhoto.headers.location).toBe('/acme/accessible/settings/support-actions/prepare/77/listing/31/photo');
    expect(without.headers.location).toContain('status=support-done');
  });

  it('represent: uploads the photo to the supporter route', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ listings: 'represent' })] });
    api.uploadSupportedMemberListingImage.mockResolvedValue({ data: {} });
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const filepath = path.join(os.tmpdir(), `support-photo-${Date.now()}.jpg`);
    fs.writeFileSync(filepath, 'img');

    const response = await request(testApp({
      photoUploads: true,
      files: { image: { filepath, originalFilename: 'dog.jpg', mimetype: 'image/jpeg', size: 3 } }
    })).post('/settings/support-actions/prepare/77/listing/31/photo').send('');

    expect(api.uploadSupportedMemberListingImage).toHaveBeenCalledWith('test-token', 77, 31, expect.objectContaining({
      filename: 'dog.jpg', contentType: 'image/jpeg'
    }));
    expect(response.headers.location).toContain('status=support-done');
  });

  it('a failed photo is reported as the photo failing, not the listing', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ listings: 'represent' })] });
    api.uploadSupportedMemberListingImage.mockRejectedValue(new api.ApiError('bad', 422));
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const filepath = path.join(os.tmpdir(), `support-photo-fail-${Date.now()}.jpg`);
    fs.writeFileSync(filepath, 'img');

    const response = await request(testApp({
      photoUploads: true,
      files: { image: { filepath, originalFilename: 'dog.jpg', mimetype: 'image/jpeg', size: 3 } }
    })).post('/settings/support-actions/prepare/77/listing/31/photo').send('');

    expect(response.headers.location).toContain('status=support-photo-failed');
  });

  it('never shows the photo step when uploads are not wired up', async () => {
    api.getChildAccounts.mockResolvedValue({ data: [child({ listings: 'represent' })] });

    const response = await request(testApp()).get('/settings/support-actions/prepare/77/listing/31/photo');

    expect(response.headers.location).toContain('status=support-done');
  });

  it('a co_decide supporter cannot reach the photo step', async () => {
    const response = await request(testApp({ photoUploads: true })).get('/settings/support-actions/prepare/77/listing/31/photo');

    expect(response.headers.location).toContain('status=support-not-allowed');
  });
});

describe('the approval queue reports the new outcomes', () => {
  it.each(['support-prepared', 'support-done', 'support-photo-failed'])('knows %s', async (status) => {
    api.getSupportActions.mockResolvedValue({ data: { actions: [] } });

    const response = await request(testApp()).get(`/settings/support-actions?status=${status}`);

    expect(response.body.locals.statusKey).toBeTruthy();
  });
});
