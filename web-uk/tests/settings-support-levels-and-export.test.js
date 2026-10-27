// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two parity items from the 27 Oct React ↔ web-uk audit:
 *
 *  - SUPPORT LEVELS (React SubAccountsManager). The supported member sets each
 *    supporter's level per capability (Off / Prepare only / Act alone); the
 *    supporter can only lower or keep theirs. Message access is NOT a level here
 *    — it is the separate consent flow — and `can_view_messages` is never sent.
 *
 *  - INSTANT DATA DOWNLOAD (React DataExportPage). JSON or ZIP straight away,
 *    streamed through web-uk with the token in a header, plus past exports.
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
  callUserSettingsApi: jest.fn(),
  downloadMemberDataExport: jest.fn(),
  getMemberDataExportHistory: jest.fn()
}));

const api = require('../src/lib/api');
const settingsRouter = require('../src/routes/settings');
const { normalizeRelationship } = settingsRouter;

function testApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    res.locals.t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/settings', settingsRouter);
  return app;
}

const t = (key) => key;

beforeEach(() => {
  jest.clearAllMocks();
  api.callUserSettingsApi.mockResolvedValue({ data: [] });
});

describe('support levels are read the way Laravel resolves them', () => {
  it('treats the legacy booleans as the floor and the tiers object as the answer', () => {
    const legacy = normalizeRelationship({ relationship_id: 1, permissions: { can_view_activity: true, can_transact: true } }, t);
    const tiered = normalizeRelationship({
      relationship_id: 2,
      permissions: { can_transact: true, tiers: { credits: 'co_decide', listings: 'represent', activity: 'nonsense' } }
    }, t);

    expect(legacy.tiers).toEqual({ activity: 'assist', listings: 'none', credits: 'represent' });
    expect(tiered.tiers).toEqual({ activity: 'none', listings: 'represent', credits: 'co_decide' });
  });

  it('offers the supporter only levels at or below what they hold', () => {
    const row = normalizeRelationship({ relationship_id: 1, permissions: { tiers: { listings: 'co_decide', credits: 'none' } } }, t);

    expect(row.supporterTierOptions.listings).toEqual(['none', 'co_decide']);
    expect(row.supporterTierOptions.credits).toEqual(['none']);
    expect(row.canPrepareListing).toBe(true);
    expect(row.canPrepareTransfer).toBe(false);
  });

  it('marks a coordinator-recorded arrangement so no control is offered', () => {
    expect(normalizeRelationship({ relationship_id: 1, staff_recorded: true }, t).staffRecorded).toBe(true);
  });
});

describe('the supporter can lower their own level', () => {
  it('sends the tier object, never the dead message boolean', async () => {
    const response = await request(testApp())
      .post('/settings/linked-accounts/tiers')
      .send('relationship_id=7&tier_activity=none&tier_listings=co_decide&tier_credits=none&perm_can_view_messages=on&tier_messages=assist');

    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/sub-accounts/7/permissions', {
      permissions: { tiers: { activity: 'none', listings: 'co_decide', credits: 'none' } }
    });
    expect(response.headers.location).toBe('/settings/linked-accounts?status=link-permissions-saved#children');
  });

  it('says plainly that only the supported member can grant more', async () => {
    api.callUserSettingsApi.mockRejectedValueOnce(new api.ApiError('no', 422, {
      errors: [{ code: 'MEMBER_APPROVAL_REQUIRED' }]
    }));

    const response = await request(testApp())
      .post('/settings/linked-accounts/tiers')
      .send('relationship_id=7&tier_activity=assist&tier_listings=represent&tier_credits=represent');

    expect(response.headers.location).toBe('/settings/linked-accounts?status=link-tiers-member-approval#children');
  });

  it('drops invalid tier values instead of sending them', async () => {
    await request(testApp())
      .post('/settings/linked-accounts/tiers')
      .send('relationship_id=7&tier_activity=none&tier_listings=god&tier_credits=assist');

    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/sub-accounts/7/permissions', {
      permissions: { tiers: { activity: 'none' } }
    });
  });
});

describe('the supported member approves and changes levels', () => {
  it('saves their choice on their own end of the link', async () => {
    const response = await request(testApp())
      .post('/settings/linked-accounts/member-tiers')
      .send('relationship_id=7&tier_activity=assist&tier_listings=co_decide&tier_credits=represent');

    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/parent-accounts/7/permissions', {
      tiers: { activity: 'assist', listings: 'co_decide', credits: 'represent' }
    });
    expect(response.headers.location).toBe('/settings/linked-accounts?status=link-permissions-saved#parents');
  });

  it('turning activity off sends none', async () => {
    await request(testApp())
      .post('/settings/linked-accounts/member-tiers')
      .send('relationship_id=7&tier_listings=none&tier_credits=none');

    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/parent-accounts/7/permissions', {
      tiers: { activity: 'none', listings: 'none', credits: 'none' }
    });
  });

  it('keeps Laravel\'s safeguarding refusal visible', async () => {
    api.callUserSettingsApi.mockRejectedValueOnce(new api.ApiError('no', 422, { code: 'SAFEGUARDING_CONTACT_RESTRICTED' }));

    const response = await request(testApp())
      .post('/settings/linked-accounts/member-tiers')
      .send('relationship_id=7&tier_activity=assist&tier_listings=represent&tier_credits=none');

    expect(response.headers.location).toBe('/settings/linked-accounts?status=link-contact-restricted#parents');
  });

  it('refuses a missing relationship without calling Laravel', async () => {
    const response = await request(testApp()).post('/settings/linked-accounts/member-tiers').send('tier_listings=none');

    expect(api.callUserSettingsApi).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=link-failed');
  });
});

describe('instant data download', () => {
  it('shows both formats, a fresh key, and past exports', async () => {
    api.getMemberDataExportHistory.mockResolvedValue({
      data: { exports: [{ id: 3, format: 'zip', requested_at: '2026-10-20 09:15:00', completed_at: '2026-10-20 09:15:02', file_size_bytes: 20480 }] }
    });

    const response = await request(testApp()).get('/settings/data-export');

    expect(response.body.view).toBe('settings/data-export');
    expect(response.body.locals.formats.map((format) => format.value)).toEqual(['json', 'zip']);
    expect(response.body.locals.idempotencyKey).toMatch(/.{8,}/);
    expect(response.body.locals.history).toEqual([
      expect.objectContaining({ id: 3, format: 'ZIP', sizeLabel: '20 KB' })
    ]);
  });

  it('still renders when the history cannot be read', async () => {
    api.getMemberDataExportHistory.mockRejectedValue(new api.ApiError('boom', 500));

    const response = await request(testApp()).get('/settings/data-export');

    expect(response.status).toBe(200);
    expect(response.body.locals.historyError).toBe(true);
  });

  it('streams the archive with a safe filename and no caching', async () => {
    const bytes = Buffer.from('PK\u0003\u0004zip', 'binary');
    api.downloadMemberDataExport.mockResolvedValue({
      status: 200,
      body: bytes,
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="personal-data-2026-10-27.zip"'
      }
    });

    const response = await request(testApp())
      .post('/settings/data-export')
      .send('format=zip&idempotency_key=export-key-12345')
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(api.downloadMemberDataExport).toHaveBeenCalledWith('test-token', 'zip', 'export-key-12345');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe('attachment; filename="personal-data-2026-10-27.zip"');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(response.body, bytes)).toBe(0);
  });

  it('never passes an unsafe upstream filename through', async () => {
    api.downloadMemberDataExport.mockResolvedValue({
      status: 200,
      body: Buffer.from('{}'),
      headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="../../evil\r\nX: y.json"' }
    });

    const response = await request(testApp()).post('/settings/data-export').send('format=json&idempotency_key=export-key-12345');

    expect(response.headers['content-disposition']).toBe('attachment; filename="personal-data.json"');
  });

  it('falls back to JSON for an unknown format, as Laravel does', async () => {
    api.downloadMemberDataExport.mockResolvedValue({ status: 200, body: Buffer.from('{}'), headers: { 'content-type': 'application/json' } });

    await request(testApp()).post('/settings/data-export').send('format=exe&idempotency_key=export-key-12345');

    expect(api.downloadMemberDataExport).toHaveBeenCalledWith('test-token', 'json', 'export-key-12345');
  });

  it('does not send a stubby key; Laravel would refuse it', async () => {
    api.downloadMemberDataExport.mockResolvedValue({ status: 200, body: Buffer.from('{}'), headers: {} });

    await request(testApp()).post('/settings/data-export').send('format=json&idempotency_key=abc');

    expect(api.downloadMemberDataExport).toHaveBeenCalledWith('test-token', 'json', null);
  });

  it.each([
    [429, 'export-rate-limited'],
    [500, 'export-failed'],
    [403, 'export-failed']
  ])('turns a %s into a message on the page', async (status, expected) => {
    api.downloadMemberDataExport.mockRejectedValue(new api.ApiError('no', status));

    const response = await request(testApp()).post('/settings/data-export').send('format=json&idempotency_key=export-key-12345');

    expect(response.headers.location).toBe(`/settings/data-export?status=${expected}#download`);
  });

  it('renders the status message for a refusal', async () => {
    api.getMemberDataExportHistory.mockResolvedValue({ data: { exports: [] } });

    const response = await request(testApp()).get('/settings/data-export?status=export-rate-limited');

    expect(response.body.locals.errorMessage).toBe('govuk_alpha_settings.data_export.error_rate_limit');
  });
});

describe('the pages render with real translations', () => {
  const nunjucks = require('nunjucks');
  const path = require('path');
  const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
  const { registerTemplateFilters } = require('../src/lib/template-filters');
  const env = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true }
  );
  registerTemplateFilters(env);
  const realT = createTranslator('en');
  const shell = {
    t: realT,
    tc: createChoiceTranslator('en'),
    urlFor: (pathname) => pathname,
    formatLocaleNumber: (value) => String(value),
    formatLocaleDate: (value) => String(value ?? ''),
    isAuthenticated: true,
    tenantName: 'Acme Timebank',
    serviceName: 'Project NEXUS Accessible',
    communityName: 'Acme Timebank',
    alphaNavItems: [],
    alphaFooterColumns: [],
    alphaLocaleOptions: [],
    alphaLanguageQueryParams: [],
    alphaCurrentLocale: 'en',
    htmlLang: 'en',
    htmlDirection: 'ltr',
    csrfToken: 'test-csrf',
    characterCountMessages: require('../src/lib/character-count-messages').characterCountMessages(realT, 'en')
  };
  const visible = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

  function renderLinked(children = [], parents = []) {
    return env.render('settings/linked-accounts.njk', {
      ...shell,
      children,
      parents,
      maxChildren: 20,
      permissions: [],
      linkTypes: [],
      grantableTiers: ['none', 'co_decide', 'represent']
    });
  }

  it('gives the supporter only lower levels and the prepare buttons their level allows', () => {
    const row = normalizeRelationship({
      relationship_id: 7, user_id: 77, first_name: 'Mary', last_name: 'Casey', status: 'active',
      permissions: { tiers: { activity: 'none', listings: 'co_decide', credits: 'none' } }
    }, realT);
    const html = renderLinked([row]);

    expect(html).toContain('action="/settings/linked-accounts/tiers"');
    expect(html).not.toContain('value="represent"');
    expect(html).toContain('href="/settings/support-actions/prepare/77/listing"');
    expect(html).not.toContain('/prepare/77/transfer');
    expect(html).not.toContain('perm_can_view_messages');
    expect(html).not.toContain('name="tier_messages"');
  });

  it('gives the supported member every level, and never offers messages as a level', () => {
    const row = normalizeRelationship({
      relationship_id: 9, user_id: 5, first_name: 'Sam', last_name: 'Helper', status: 'active',
      permissions: { tiers: { activity: 'assist', listings: 'none', credits: 'co_decide' } }
    }, realT);
    const html = renderLinked([], [row]);
    const text = visible(html);

    expect(html).toContain('action="/settings/linked-accounts/member-tiers"');
    expect(html).toContain('value="represent"');
    expect(text).toContain('Prepare only — you approve each one');
    expect(html).not.toContain('/support-actions/prepare/');
    expect(html).not.toContain('name="tier_messages"');
  });

  it('offers no level control on a coordinator-recorded arrangement', () => {
    const row = normalizeRelationship({
      relationship_id: 7, user_id: 77, first_name: 'Mary', status: 'active', staff_recorded: true,
      permissions: { tiers: { listings: 'co_decide' } }
    }, realT);
    const html = renderLinked([row]);

    expect(html).not.toContain('action="/settings/linked-accounts/tiers"');
    expect(visible(html)).toContain('Mary chose these levels');
  });

  it('renders the transfer form, its check page, the listing pages and the photo step', () => {
    const transfer = env.render('settings/support-prepare-transfer.njk', {
      ...shell, supportedUserId: 77, supportedName: 'Mary Casey', tier: 'co_decide', balance: 12.5, maxTransfer: 20,
      recipients: [], recipient: { id: 42, name: 'Alex Recipient' }, recipientQuery: 'Alex',
      values: { amount: '2', description: '' }, errors: [], idempotencyKey: 'abcdef123456'
    });
    expect(visible(transfer)).toContain("Mary Casey's balance: 12.5 hours");
    expect(visible(transfer)).toContain('Nothing happens yet');
    expect(transfer).toContain('name="idempotency_key" value="abcdef123456"');

    const check = env.render('settings/support-prepare-transfer-check.njk', {
      ...shell, supportedUserId: 77, supportedName: 'Mary Casey', tier: 'represent',
      summary: { recipientId: 42, recipientName: 'Alex Recipient', recipientQuery: 'Alex', amount: 2, amountText: '2', description: 'Garden' },
      idempotencyKey: 'abcdef123456'
    });
    expect(visible(check)).toContain('Check your answers');
    expect(visible(check)).toContain('Do it now');
    expect(visible(check)).toContain('This will happen immediately');

    const listing = env.render('settings/support-prepare-listing.njk', {
      ...shell, supportedUserId: 77, supportedName: 'Mary Casey', tier: 'co_decide', categories: [{ id: 3, name: 'Gardening' }],
      values: { title: '', type: 'offer', category_id: '', description: '', hours_estimate: '', service_type: 'physical_only', location: '', skill_tags: '' },
      errors: [{ text: 'Fill in Title', href: '#title' }], photoAfterApproval: true, photoOffered: false
    });
    expect(visible(listing)).toContain('A photo cannot be added yet');
    expect(listing).not.toContain('type="file"');
    expect(listing).toContain('govuk-error-summary');

    const listingCheck = env.render('settings/support-prepare-listing-check.njk', {
      ...shell, supportedUserId: 77, supportedName: 'Mary Casey', tier: 'co_decide', categoryName: 'Gardening',
      values: { title: 'Dog walking', type: 'offer', category_id: '3', description: 'Walks', hours_estimate: '1', service_type: 'physical_only', location: '', skill_tags: '' }
    });
    expect(visible(listingCheck)).toContain('Send for their approval');

    const photo = env.render('settings/support-prepare-photo.njk', {
      ...shell, supportedUserId: 77, supportedName: 'Mary Casey', listingId: 31, photoError: false
    });
    expect(photo).toContain('enctype="multipart/form-data"');
    expect(visible(photo)).toContain('Finish without a photo');
  });

  it('renders the data download page with formats and history', () => {
    const html = env.render('settings/data-export.njk', {
      ...shell,
      formats: [
        { value: 'json', label: realT('govuk_alpha_settings.data_export.format_json'), hint: 'h', checked: true },
        { value: 'zip', label: realT('govuk_alpha_settings.data_export.format_zip'), hint: 'h', checked: false }
      ],
      idempotencyKey: 'abcdef123456',
      history: [{ id: 3, format: 'ZIP', requestedLabel: '20 October 2026', sizeLabel: '20 KB' }],
      historyError: false,
      errorMessage: ''
    });
    const text = visible(html);

    expect(text).toContain('Download my data');
    expect(text).toContain('JSON (developer-friendly)');
    expect(text).toContain('20 KB');
    expect(html).toContain('action="/settings/data-export"');
  });
});
