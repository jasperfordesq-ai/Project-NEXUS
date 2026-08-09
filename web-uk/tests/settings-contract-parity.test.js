// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs');
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
  callProfileApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  callWebAuthnApi: jest.fn(),
  getProfile: jest.fn(),
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn(),
  uploadInsuranceCertificate: jest.fn(),
  uploadProfileAvatar: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const { buildAccountLinks } = require('../src/lib/account-links');
const { createTranslator } = require('../src/lib/localization');
const { parseMultipartForm } = require('../src/middleware/multipart');
const profileRouter = require('../src/routes/profile');
const settingsRouter = require('../src/routes/settings');

function middleware({ insuranceEnabled = true } = {}) {
  return (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.t = createTranslator('en');
    req.accessibleRouting = {
      tenant: {
        slug: 'acme',
        compliance: { insurance_enabled: insuranceEnabled }
      }
    };
    res.locals.urlFor = (pathname) => pathname;
    res.locals.t = req.t;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  };
}

function profileApp(options = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use('/profile/settings', parseMultipartForm({ maxFileSize: 10 * 1024 * 1024 }));
  app.use(middleware(options));
  app.use('/profile', profileRouter);
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}

function settingsApp(options = {}) {
  const app = express();
  app.use(express.urlencoded({
    extended: true,
    verify: (req, res, buffer) => {
      req.rawUrlencodedBody = buffer.toString('utf8');
    }
  }));
  app.use(middleware(options));
  app.use('/settings', settingsRouter);
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}

describe('Laravel account and settings contract parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({
      data: {
        id: 7,
        first_name: 'Ada',
        last_name: 'Lovelace',
        newsletter_opt_in: false
      }
    });
    api.callWebAuthnApi.mockResolvedValue({ data: [] });
    api.callProfileApi.mockImplementation((token, method, requestPath) => {
      if (method === 'GET' && requestPath === '/users/me/sessions') {
        return Promise.resolve({
          data: [{ id: 'session-1', device: 'Desktop', ip_address: '127.0.0.1', last_active: '2026-07-10T12:00:00Z' }]
        });
      }
      if (method === 'GET' && requestPath === '/safeguarding/my-preferences') {
        return Promise.resolve({
          data: {
            preferences: [{
              option_id: 4,
              label: 'Broker support',
              activations: {
                requires_broker_approval: true,
                restricts_messaging: true
              }
            }]
          }
        });
      }
      return Promise.resolve({ data: {} });
    });
    api.callUserSettingsApi.mockImplementation((token, method, requestPath) => {
      if (method === 'GET' && requestPath === '/consent') {
        return Promise.resolve({
          data: [{ consent_type_slug: 'marketing_email', given: true }]
        });
      }
      if (method === 'GET' && requestPath === '/availability') {
        return Promise.resolve({
          data: {
            weekly: [
              { day_of_week: 1, start_time: '09:00:00', end_time: '10:30:00', is_recurring: true },
              { day_of_week: 2, start_time: '11:00:00', end_time: '12:00:00', is_recurring: false }
            ]
          }
        });
      }
      return Promise.resolve({ data: {} });
    });
    api.uploadInsuranceCertificate.mockResolvedValue({ data: { id: 12 } });
    api.uploadProfileAvatar.mockResolvedValue({ data: { avatar_url: '/uploads/avatar.jpg' } });
  });

  it('builds the full Blade account hub while omitting explicitly disabled tenant facilities', () => {
    const links = buildAccountLinks({
      tenant: {
        modules: { wallet: false, messages: true, notifications: false, listings: false },
        features: {
          direct_messaging: false,
          connections: false,
          reviews: false,
          job_vacancies: false,
          group_exchanges: false,
          gamification: false
        }
      },
      unreadMessageCount: 5,
      t: createTranslator('en')
    });
    const hrefs = links.map(({ href }) => href);

    expect(hrefs).toEqual([
      '/activity',
      '/saved',
      '/profile',
      '/profile/settings',
      '/settings/linked-accounts',
      '/settings/appearance'
    ]);
    expect(hrefs).not.toContain('/wallet');
    expect(hrefs).not.toContain('/messages');
  });

  it('builds every current Blade account destination when its tenant facility is enabled', () => {
    const links = buildAccountLinks({
      tenant: {
        modules: { wallet: true, notifications: true, listings: true },
        features: { connections: true, reviews: true, job_vacancies: true, group_exchanges: true, gamification: true }
      },
      directMessagingEnabled: true,
      unreadMessageCount: 3,
      t: createTranslator('en')
    });

    expect(links.map(({ href }) => href)).toEqual([
      '/wallet', '/messages', '/connections', '/notifications', '/reviews',
      '/activity', '/saved', '/jobs', '/matches', '/group-exchanges',
      '/achievements', '/leaderboard', '/nexus-score', '/profile',
      '/profile/settings', '/settings/linked-accounts', '/settings/appearance'
    ]);
    expect(links.find(({ href }) => href === '/messages')).toMatchObject({ badge: 3 });
  });

  it('renders appearance settings from the exact Laravel catalog and ignores unknown statuses', async () => {
    const response = await request(settingsApp()).get('/settings/appearance?status=appearance-saved');
    const unknownStatusResponse = await request(settingsApp()).get('/settings/appearance?status=untrusted');
    const t = createTranslator('en');

    expect(response.status).toBe(200);
    expect(response.body.locals.title).toBe(t('govuk_alpha_settings.appearance.title'));
    expect(response.body.locals.statusMessage).toBe(t('govuk_alpha_settings.states.appearance-saved'));
    expect(response.body.locals.themes).toEqual(['light', 'dark', 'system'].map((theme) => ({
      value: theme,
      label: t(`govuk_alpha_settings.appearance.themes.${theme}`),
      hint: t(`govuk_alpha_settings.appearance.theme_hints.${theme}`),
      checked: theme === 'system'
    })));
    expect(unknownStatusResponse.body.locals.statusMessage).toBe('');
  });

  it('normalizes linked-account rows and labels from the exact Laravel catalog', async () => {
    api.callUserSettingsApi.mockImplementation((token, method, requestPath) => {
      if (method === 'GET' && requestPath === '/sub-accounts') {
        return Promise.resolve({
          data: {
            sub_accounts: [{
              relationship_id: 41,
              name: '',
              relationship_type: 'organization',
              status: 'active',
              permissions: JSON.stringify({ can_view_activity: true })
            }]
          }
        });
      }
      if (method === 'GET' && requestPath === '/parent-accounts') {
        return Promise.resolve({
          data: {
            parent_accounts: [{
              id: 42,
              first_name: 'Ada',
              last_name: 'Lovelace',
              relationship_type: 'guardian',
              status: 'pending'
            }]
          }
        });
      }
      return Promise.resolve({ data: {} });
    });
    const response = await request(settingsApp()).get('/settings/linked-accounts?status=link-approved');
    const t = createTranslator('en');

    expect(response.status).toBe(200);
    expect(response.body.locals.title).toBe(t('govuk_alpha_settings.linked.title'));
    expect(response.body.locals.statusMessage).toBe(t('govuk_alpha_settings.states.link-approved'));
    expect(response.body.locals.children[0]).toEqual(expect.objectContaining({
      relationshipId: 41,
      name: t('govuk_alpha_settings.common.unknown_member'),
      relationshipType: 'organization',
      relationshipTypeLabel: t('govuk_alpha_settings.linked.types.organization'),
      status: 'active',
      permissions: expect.objectContaining({ can_view_activity: true, can_view_messages: false })
    }));
    expect(response.body.locals.parents[0]).toEqual(expect.objectContaining({
      relationshipId: 42,
      name: 'Ada Lovelace',
      relationshipTypeLabel: t('govuk_alpha_settings.linked.types.guardian'),
      status: 'pending'
    }));
    expect(response.body.locals.permissions.map(({ label }) => label)).toEqual([
      'can_view_activity',
      'can_manage_listings',
      'can_transact',
      'can_view_messages'
    ].map((permission) => t(`govuk_alpha_settings.linked.permissions.${permission}`)));
  });

  it('normalizes insurance certificates and labels from the exact Laravel catalog', async () => {
    api.callUserSettingsApi.mockImplementation((token, method, requestPath) => {
      if (method === 'GET' && requestPath === '/insurance') {
        return Promise.resolve({
          data: {
            insurance_certificates: [{
              insurance_type: 'professional_indemnity',
              provider_name: '',
              expiry_date: '',
              status: 'verified'
            }, {
              insurance_type: 'unexpected_type',
              status: 'under_review'
            }]
          }
        });
      }
      return Promise.resolve({ data: {} });
    });
    const response = await request(settingsApp()).get('/settings/insurance?status=insurance-uploaded');
    const t = createTranslator('en');

    expect(response.status).toBe(200);
    expect(response.body.locals.title).toBe(t('govuk_alpha_settings.insurance.title'));
    expect(response.body.locals.statusMessage).toBe(t('govuk_alpha_settings.states.insurance-uploaded'));
    expect(response.body.locals.certificates).toEqual([
      expect.objectContaining({
        insuranceType: 'professional_indemnity',
        insuranceTypeLabel: t('govuk_alpha_settings.insurance.types.professional_indemnity'),
        providerName: '',
        expiryLabel: '',
        status: 'verified',
        statusLabel: t('govuk_alpha_settings.insurance.statuses.verified'),
        statusTagClass: 'govuk-tag--green'
      }),
      expect.objectContaining({
        insuranceType: 'other',
        insuranceTypeLabel: t('govuk_alpha_settings.insurance.types.other'),
        status: 'under_review',
        statusLabel: 'Under Review',
        statusTagClass: 'govuk-tag--grey'
      })
    ]);
    expect(response.body.locals.insuranceTypes.map(({ label }) => label)).toEqual([
      'public_liability',
      'professional_indemnity',
      'employers_liability',
      'product_liability',
      'personal_accident',
      'other'
    ].map((type) => t(`govuk_alpha_settings.insurance.types.${type}`)));
  });

  it('uses exact session, safeguarding, and consent reads and normalizes their v2 envelopes', async () => {
    const response = await request(profileApp({ insuranceEnabled: false })).get('/profile/settings');

    expect(response.status).toBe(200);
    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'GET', '/users/me/sessions');
    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'GET', '/safeguarding/my-preferences');
    expect(api.callProfileApi).not.toHaveBeenCalledWith('test-token', 'GET', '/sessions');
    expect(api.callProfileApi).not.toHaveBeenCalledWith('test-token', 'GET', '/safeguarding/preferences');
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'GET', '/consent');
    expect(response.body.locals.profile.newsletter_opt_in).toBe(true);
    expect(response.body.locals.sessions).toHaveLength(1);
    expect(response.body.locals.safeguarding[0].activations).toEqual([
      'restricts_messaging',
      'requires_broker_approval'
    ]);
    expect(response.body.locals.settingsLinks.map(({ href }) => href)).not.toContain('/settings/insurance');
  });

  it('persists newsletter consent through the dedicated Laravel consent API and supports avatar removal', async () => {
    const response = await request(profileApp())
      .post('/profile/settings')
      .type('form')
      .send({
        first_name: ' Ada ',
        last_name: ' Lovelace ',
        remove_avatar: 'on',
        newsletter_opt_in: 'on',
        privacy_profile: 'members',
        privacy_search: 'on'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile?status=profile-updated');
    expect(api.callUserSettingsApi).toHaveBeenNthCalledWith(1, 'test-token', 'PUT', '', expect.objectContaining({
      first_name: 'Ada',
      last_name: 'Lovelace',
      avatar_url: null
    }));
    expect(api.callUserSettingsApi.mock.calls[0][3]).not.toHaveProperty('newsletter_opt_in');
    expect(api.callUserSettingsApi).toHaveBeenNthCalledWith(3, 'test-token', 'PUT', '/consent', {
      slug: 'marketing_email',
      given: true
    });
  });

  it('proxies a multipart avatar before profile persistence through the exact Laravel avatar helper', async () => {
    const response = await request(profileApp())
      .post('/profile/settings')
      .field('first_name', 'Ada')
      .field('last_name', 'Lovelace')
      .attach('avatar', Buffer.from('avatar-image'), {
        filename: 'avatar.png',
        contentType: 'image/png'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile?status=profile-updated');
    expect(api.uploadProfileAvatar).toHaveBeenCalledWith('test-token', {
      file: expect.objectContaining({
        buffer: Buffer.from('avatar-image'),
        filename: 'avatar.png',
        contentType: 'image/png'
      })
    });
    expect(api.uploadProfileAvatar.mock.invocationCallOrder[0]).toBeLessThan(
      api.callUserSettingsApi.mock.invocationCallOrder[0]
    );
  });

  it('reads Laravel availability from data.weekly, trims time values, and excludes one-off slots', async () => {
    const response = await request(settingsApp()).get('/settings/availability');
    const unknownStatusResponse = await request(settingsApp()).get('/settings/availability?status=untrusted');
    const t = createTranslator('en');

    expect(response.status).toBe(200);
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'GET', '/availability');
    expect(response.body.locals.title).toBe(t('govuk_alpha_settings.availability.title'));
    expect(response.body.locals.dayLabels).toEqual(
      Array.from({ length: 7 }, (_, index) => t(`govuk_alpha_settings.availability.day_labels.${index}`))
    );
    expect(response.body.locals.availabilityByDay).toEqual({
      1: [{ start: '09:00', end: '10:30' }]
    });
    expect(unknownStatusResponse.body.locals.statusMessage).toBe('');
  });

  it('submits Laravel bulk availability with the canonical schedule field', async () => {
    const response = await request(settingsApp())
      .post('/settings/availability')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send([
        'slots%5B1%5D%5B0%5D%5Bstart%5D=09%3A00',
        'slots%5B1%5D%5B0%5D%5Bend%5D=10%3A30',
        'slots%5B2%5D%5B0%5D%5Bstart%5D=',
        'slots%5B2%5D%5B0%5D%5Bend%5D='
      ].join('&'));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/settings/availability?status=availability-saved');
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/availability', {
      schedule: [{ day_of_week: 1, start_time: '09:00', end_time: '10:30' }]
    });
  });

  it.each(['get', 'post'])('returns Blade-compatible 404 for %s insurance when compliance disables it', async (method) => {
    const client = request(settingsApp({ insuranceEnabled: false }));
    const response = method === 'get'
      ? await client.get('/settings/insurance')
      : await client.post('/settings/insurance').type('form').send({ insurance_type: 'public_liability' });

    expect(response.status).toBe(404);
    expect(response.body.view).toBe('errors/404');
    expect(api.uploadInsuranceCertificate).not.toHaveBeenCalled();
    expect(api.callUserSettingsApi).not.toHaveBeenCalledWith('test-token', 'GET', '/insurance');
  });

  it('links the blocked-member settings control to the implemented Laravel-parity route', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'profile', 'settings.njk'),
      'utf8'
    );

    expect(source).toContain("urlFor('/profile/blocked')");
    expect(source).not.toContain("urlFor('/profile/blocked-members')");
  });
});
