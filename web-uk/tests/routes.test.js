// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Integration tests for routes
 */

const request = require('supertest');

// Mock the API module before requiring the app
jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
  login: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn(),
  getListings: jest.fn(),
  getListingCategories: jest.fn(),
  getBalance: jest.fn(),
  getUnreadCount: jest.fn(),
  getTransactions: jest.fn(),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn()
}));

// Set required env vars
process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

describe('Public Routes', () => {
  let app;

  beforeAll(() => {
    // Require app after mocks are set up
    app = require('../src/server');
  });

  describe('GET /', () => {
    it('renders the Laravel tenant chooser on the shared root', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockResolvedValueOnce({
        data: [
          { id: 2, name: 'Acme Timebank', slug: 'acme', tagline: 'Neighbours helping neighbours' },
          { id: 3, name: 'Dunmanway Timebank', slug: 'dunmanway' }
        ]
      });

      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Choose a community');
      expect(response.text).toContain('Select the community you want to use with Project NEXUS Accessible.');
      expect(response.text).toContain('Acme Timebank');
      expect(response.text).toContain('Neighbours helping neighbours');
      expect(response.text).toContain('Community link: acme');
      expect(response.text).toContain('href="/acme/accessible"');
      expect(response.text).toContain('Dunmanway Timebank');
      expect(response.text).toContain('href="/dunmanway/accessible"');
      expect(response.text).not.toContain('Project NEXUS master tenant');
      expect(api.getTenants).toHaveBeenCalledWith({ includeMaster: false });
    });

    it('orders shared-root tenant chooser communities by name like Laravel Blade', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockResolvedValueOnce({
        data: [
          { id: 2, name: 'Zebra Timebank', slug: 'zebra' },
          { id: 3, name: 'Acme Timebank', slug: 'acme' }
        ]
      });

      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text.indexOf('Acme Timebank')).toBeLessThan(response.text.indexOf('Zebra Timebank'));
    });

    it('localizes populated and empty tenant chooser states from Laravel catalogs', async () => {
      const api = require('../src/lib/api');
      const { translate } = require('../src/lib/localization');
      api.getTenants
        .mockResolvedValueOnce({
          data: [{ id: 2, name: 'Acme Timebank', slug: 'acme', tagline: 'Neighbours helping neighbours' }]
        })
        .mockResolvedValueOnce({ data: [] });

      const populated = await request(app).get('/?locale=ar');
      const empty = await request(app).get('/?locale=ar');

      expect(populated.status).toBe(200);
      expect(populated.headers['content-language']).toBe('ar');
      expect(populated.text).toContain('dir="rtl"');
      expect(populated.text).toContain(translate('ar', 'tenant_chooser.title'));
      expect(populated.text).toContain(translate('ar', 'tenant_chooser.community_slug', { slug: 'acme' }));
      expect(populated.text).not.toContain('Community link: acme');
      expect(empty.status).toBe(200);
      expect(empty.text).toContain(translate('ar', 'states.empty_title'));
      expect(empty.text).toContain(translate('ar', 'tenant_chooser.empty'));
      expect(empty.text).not.toContain('Nothing to show yet');
    });
  });

  describe('shared tenant accessible mount', () => {
    it('serves the flat app below /{tenantSlug}/accessible and prefixes shell links', async () => {
      const response = await request(app).get('/acme/accessible');

      expect(response.status).toBe(200);
      expect(response.text).toContain('<h1 class="govuk-heading-xl">Accessible</h1>');
      expect(response.text).toContain('href="/acme/accessible"');
      expect(response.text).toContain('href="/acme/accessible/login"');
      expect(response.text).toContain('href="/acme/accessible/register"');
      expect(response.text).not.toContain('/acme/alpha');
    });

    it('renders the Laravel Blade tenant home for the mounted tenant root', async () => {
      const api = require('../src/lib/api');
      api.getTenantBootstrap.mockClear();
      api.getPlatformStats.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 2,
          name: 'Acme Timebank',
          slug: 'acme',
          tagline: 'Neighbours helping neighbours',
          branding: {
            logo_url: '/uploads/tenants/acme/tenant-logo.png',
            logo_shape: 'wide'
          },
          modules: {
            feed: true,
            listings: true,
            wallet: true
          },
          features: {
            connections: true,
            events: false,
            volunteering: true
          }
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({
        data: {
          members: 1234,
          hours_exchanged: 567.5,
          listings: 89,
          communities: 12
        }
      });

      const response = await request(app).get('/acme/accessible');

      expect(response.status).toBe(200);
      expect(response.text).toContain('<h1 class="govuk-heading-xl">Accessible</h1>');
      expect(response.text).toContain('Use a simpler, accessible version of Acme Timebank for core community tasks.');
      expect(response.text).toContain('Neighbours helping neighbours');
      expect(response.text).toContain('class="nexus-alpha-header__logo nexus-alpha-header__logo--wide"');
      expect(response.text).toContain('src="http://127.0.0.1:8088/uploads/tenants/acme/tenant-logo.png"');
      expect(response.text).toContain('alt="Acme Timebank"');
      expect(response.text).toContain('Not affiliated with GOV.UK');
      expect(response.headers['content-security-policy']).toContain('img-src \'self\' data: http://127.0.0.1:8088');
      expect(response.text).toContain('Built for accessibility needs');
      expect(response.text).toContain('Members');
      expect(response.text).toContain('1,234');
      expect(response.text).toContain('568');
      expect(response.text).toContain('What you can do');
      expect(response.text).toContain('Choose a task for Acme Timebank.');
      expect(response.text).toContain('This module is not enabled for this community.');
      expect(response.text).toContain('href="/acme/accessible/login?status=auth-required"');
      expect(response.text).not.toContain('Welcome to Project NEXUS Community');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ slug: 'acme' });
      expect(api.getPlatformStats).toHaveBeenCalledWith({ slug: 'acme' });
    });

    it('localizes Laravel-owned tenant Home copy and statistics', async () => {
      const api = require('../src/lib/api');
      const { formatLocaleNumber, translate } = require('../src/lib/localization');
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 2,
          name: 'Acme Timebank',
          slug: 'acme',
          modules: { feed: true, listings: true, wallet: true },
          features: { connections: true, events: true, volunteering: true }
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({
        data: { members: 1234, hours_exchanged: 567.5, listings: 89, communities: 12 }
      });

      const response = await request(app).get('/acme/accessible?locale=ar');

      expect(response.status).toBe(200);
      expect(response.headers['content-language']).toBe('ar');
      expect(response.text).toContain('dir="rtl"');
      expect(response.text).toContain(translate('ar', 'home.description', { community: 'Acme Timebank' }));
      expect(response.text).toContain(translate('ar', 'home.secondary_guest'));
      expect(response.text).toContain(translate('ar', 'about.stats.members'));
      expect(response.text).toContain(translate('ar', 'about.stats.hours_exchanged'));
      expect(response.text).toContain(translate('ar', 'home.modules_title'));
      expect(response.text).toContain(translate('ar', 'home.modules_intro', { community: 'Acme Timebank' }));
      expect(response.text).toContain(translate('ar', 'home.summary_community_key'));
      expect(response.text).toContain(translate('ar', 'home.summary_account_signed_out'));
      expect(response.text).toContain(formatLocaleNumber(1234, 'ar', { maximumFractionDigits: 0 }));
      expect(response.text).toContain(formatLocaleNumber(567.5, 'ar', { maximumFractionDigits: 0 }));
      expect(response.text).not.toContain('What you can do');
      expect(response.text).not.toContain('Hours exchanged');
      expect(response.text).not.toContain('Not signed in');
    });

    it('matches signed Laravel Home gates for messaging and exchange workflow', async () => {
      const api = require('../src/lib/api');
      const cookieSignature = require('cookie-signature');
      const signedToken = `s:${cookieSignature.sign('test-token', process.env.COOKIE_SECRET)}`;
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 2,
          name: 'Acme Timebank',
          slug: 'acme',
          modules: { feed: true, listings: true, wallet: true },
          features: {
            connections: true,
            events: true,
            volunteering: true,
            direct_messaging: false,
            exchange_workflow: false
          }
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({ data: {} });

      const response = await request(app)
        .get('/acme/accessible')
        .set('Cookie', `token=${encodeURIComponent(signedToken)}`);

      expect(response.status).toBe(200);
      expect(response.text).not.toContain('href="/acme/accessible/messages"');
      expect(response.text).not.toContain('href="/acme/accessible/exchanges"');
      expect(response.text).toContain('href="/acme/accessible/wallet"');
      expect(response.text).toContain('href="/acme/accessible/listings"');
      expect(response.text.match(/This module is not enabled for this community\./g)).toHaveLength(2);
    });

    it('canonicalizes Laravel legacy alpha mount paths to the cleaner accessible mount', async () => {
      const response = await request(app).get('/acme/alpha/login?status=auth-required');

      expect(response.status).toBe(301);
      expect(response.headers.location).toBe('/acme/accessible/login?status=auth-required');
    });

    it('keeps local redirects inside the active shared accessible mount', async () => {
      const response = await request(app).get('/acme/accessible/dashboard');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/acme/accessible/login?status=auth-required');
    });

    it('keeps rendered forms and links inside the active shared accessible mount', async () => {
      const response = await request(app).get('/acme/accessible/login');

      expect(response.status).toBe(200);
      expect(response.text).toContain('action="/acme/accessible/login"');
      expect(response.text).toContain('href="/acme/accessible/login/forgot-password"');
      expect(response.text).toContain('href="/acme/accessible/register"');
      expect(response.text).not.toContain('action="/login"');
      expect(response.text).not.toContain('href="/login/forgot-password"');
      expect(response.text).not.toContain('href="/register"');
      expect(response.text.match(/<main\b/g)).toHaveLength(1);
      expect(response.text.match(/id="main-content"/g)).toHaveLength(1);
    });

    it('keeps auth POST redirects inside the active shared accessible mount', async () => {
      const api = require('../src/lib/api');
      api.login.mockReset();
      api.login.mockResolvedValueOnce({
        success: true,
        access_token: 'test-token',
        refresh_token: 'refresh-token',
        expires_in: 900,
        refresh_expires_in: 604800
      });

      const agent = request.agent(app);
      const first = await agent.get('/acme/accessible/login');
      const csrfMatch = first.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const response = await agent
        .post('/acme/accessible/login')
        .type('form')
        .send({
          _csrf: csrfMatch[1],
          email: 'member@acme.test',
          password: 'Test123!',
          tenant_slug: 'acme'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/acme/accessible/dashboard');
      expect(api.login).toHaveBeenCalledWith('member@acme.test', 'Test123!', 'acme');

      const authenticatedPage = await agent.get('/acme/accessible/cookies');
      expect(authenticatedPage.status).toBe(200);
      expect(authenticatedPage.text).toContain('data-login-url="/acme/accessible/login"');
      expect(authenticatedPage.text).toContain('id="session-timeout-logout-form"');
      expect(authenticatedPage.text).toContain('method="post" action="/acme/accessible/logout"');
      expect(authenticatedPage.text).not.toContain('action="/logout"');

      const timeoutCsrfMatch = authenticatedPage.text.match(
        /id="session-timeout-logout-form"[\s\S]*?name="_csrf" value="([^"]+)"/
      );
      expect(timeoutCsrfMatch).not.toBeNull();

      api.logout.mockResolvedValueOnce({ ok: true });
      const logoutResponse = await agent
        .post('/acme/accessible/logout')
        .type('form')
        .send({ _csrf: timeoutCsrfMatch[1], timeout: 'true' });

      expect(logoutResponse.status).toBe(302);
      expect(logoutResponse.headers.location).toBe('/acme/accessible/login?status=signed-out');
      expect(api.logout).toHaveBeenCalledWith('test-token', 'refresh-token');

      const signedOutPage = await agent.get(logoutResponse.headers.location);
      expect(signedOutPage.status).toBe(200);
      expect(signedOutPage.text).toContain('You have signed out.');
      expect(signedOutPage.text).toContain('govuk-notification-banner--success');
    });

    it('keeps server-level cookie redirects inside the active shared accessible mount', async () => {
      const agent = request.agent(app);
      const first = await agent.get('/acme/accessible/cookies');
      const csrfMatch = first.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const response = await agent
        .post('/acme/accessible/cookie-consent')
        .type('form')
        .send({
          _csrf: csrfMatch[1],
          cookies: 'save',
          analytics: 'yes'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/acme/accessible/cookies?status=saved');
      expect((response.headers['set-cookie'] || []).join('; ')).toContain('nexus_accessible_cookie_consent=all');
      expect((response.headers['set-cookie'] || []).join('; ')).not.toContain('nexus_alpha_cookie_consent=');
    });

    it('keeps cookie-banner return redirects inside the active shared accessible mount', async () => {
      const agent = request.agent(app);
      const first = await agent.get('/acme/accessible');
      const csrfMatch = first.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const mountedReturn = await agent
        .post('/acme/accessible/cookie-consent')
        .type('form')
        .send({
          _csrf: csrfMatch[1],
          cookies: 'reject',
          return: '/acme/accessible/volunteering?tab=organisations'
        });

      expect(mountedReturn.status).toBe(302);
      expect(mountedReturn.headers.location)
        .toBe('/acme/accessible/volunteering?tab=organisations');

      const second = await agent.get('/acme/accessible/cookies');
      const secondCsrfMatch = second.text.match(/name="_csrf" value="([^"]+)"/);
      expect(secondCsrfMatch).not.toBeNull();

      const unmountedReturn = await agent
        .post('/acme/accessible/cookie-consent')
        .type('form')
        .send({
          _csrf: secondCsrfMatch[1],
          cookies: 'accept',
          return: '/admin'
        });

      expect(unmountedReturn.status).toBe(302);
      expect(unmountedReturn.headers.location).toBe('/acme/accessible/admin');
    });

    it('treats accessible and legacy Laravel cookie choices as banner dismissal signals', async () => {
      const accessibleCookie = await request(app)
        .get('/acme/accessible/cookies')
        .set('Cookie', 'nexus_accessible_cookie_consent=all');

      const legacyCookie = await request(app)
        .get('/acme/accessible/cookies')
        .set('Cookie', 'nexus_alpha_cookie_consent=all');

      expect(accessibleCookie.status).toBe(200);
      expect(accessibleCookie.text).not.toContain('govuk-cookie-banner');
      expect(legacyCookie.status).toBe(200);
      expect(legacyCookie.text).not.toContain('govuk-cookie-banner');
    });

    it('keeps server-level organisation auth redirects inside the active shared accessible mount', async () => {
      const response = await request(app).get('/acme/accessible/organisations/42');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/acme/accessible/login?status=auth-required');
    });
  });

  describe('custom accessible domains', () => {
    it('renders a parent custom-domain tenant home with network child links at the slugless root', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getPlatformStats.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 4,
          name: 'Timebank Global',
          slug: 'timebank-global',
          domain: 'timebank.global',
          tagline: 'Connecting Communities Worldwide...',
          seo: {
            h1_headline: 'Exchange Skills Across Borders',
            hero_intro: 'Join the world largest timebanking community.'
          },
          tenant_switcher: {
            source: 'children',
            items: [
              {
                id: 2,
                name: 'Hour Timebank',
                slug: 'hour-timebank',
                tagline: 'Connecting Communities',
                url: 'https://timebank.global/hour-timebank'
              },
              {
                id: 9,
                name: 'timebanks.us',
                slug: 'timebanks-us',
                tagline: 'Timebanking platform for the US',
                url: 'https://timebanks.us'
              }
            ]
          }
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({
        data: {
          members: 946,
          hours_exchanged: 1988,
          listings: 129,
          communities: 5
        }
      });

      const response = await request(app)
        .get('/')
        .set('Host', 'timebank.global');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Exchange Skills Across Borders');
      expect(response.text).toContain('Join the world largest timebanking community.');
      expect(response.text).toContain('Communities in this network');
      expect(response.text).toContain('Hour Timebank');
      expect(response.text).toContain('Connecting Communities');
      expect(response.text).toContain('href="/hour-timebank"');
      expect(response.text).toContain('timebanks.us');
      expect(response.text).toContain('href="https://timebanks.us"');
      expect(response.text).not.toContain('Choose a community');
      expect(response.text).not.toContain('/timebank-global/accessible');
      expect(response.text).not.toContain('/timebank-global/alpha');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'timebank.global' });
      expect(api.getPlatformStats).toHaveBeenCalledWith({ host: 'timebank.global' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('renders the master custom-domain front page instead of the shared chooser', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getPlatformStats.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 1,
          name: 'Master',
          slug: '',
          domain: 'project-nexus.ie',
          tagline: 'Project NEXUS Master Platform',
          seo: {
            h1_headline: 'Build Thriving Communities with NEXUS',
            hero_intro: 'NEXUS is the all-in-one platform for launching and managing timebanks.'
          },
          tenant_switcher: {
            source: 'children',
            items: [
              {
                id: 5,
                name: 'Partner Demo',
                slug: 'partner-demo',
                url: 'https://project-nexus.ie/partner-demo'
              },
              {
                id: 4,
                name: 'Timebank Global',
                slug: 'timebank-global',
                url: 'https://timebank.global'
              }
            ]
          }
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({
        data: {
          members: 1200,
          hours_exchanged: 3000,
          listings: 200,
          communities: 16
        }
      });

      const response = await request(app)
        .get('/')
        .set('Host', 'project-nexus.ie');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Build Thriving Communities with NEXUS');
      expect(response.text).toContain('NEXUS is the all-in-one platform for launching and managing timebanks.');
      expect(response.text).toContain('Communities in this network');
      expect(response.text).toContain('Partner Demo');
      expect(response.text).toContain('href="/partner-demo"');
      expect(response.text).toContain('Timebank Global');
      expect(response.text).toContain('href="https://timebank.global"');
      expect(response.text).not.toContain('Choose a community');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'project-nexus.ie' });
      expect(api.getPlatformStats).toHaveBeenCalledWith({ host: 'project-nexus.ie' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('does not serve slugless accessible pages on ordinary tenant domains', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getPlatformStats.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 1,
          name: 'Master',
          slug: '',
          domain: 'project-nexus.ie'
        }
      });

      const response = await request(app)
        .get('/login')
        .set('Host', 'project-nexus.ie');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'project-nexus.ie' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('resolves the tenant home from a forwarded custom-domain host', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getPlatformStats.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 4,
          name: 'Timebank Global',
          slug: 'timebank-global',
          domain: 'timebank.global',
          seo: {
            h1_headline: 'Exchange Skills Across Borders',
            hero_intro: 'Join the world largest timebanking community.'
          },
          tenant_switcher: {
            source: 'children',
            items: [
              {
                id: 2,
                name: 'Hour Timebank',
                slug: 'hour-timebank',
                url: 'https://timebank.global/hour-timebank'
              }
            ]
          }
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({ data: { members: 1, hours_exchanged: 2, listings: 3, communities: 4 } });

      const response = await request(app)
        .get('/')
        .set('Host', '127.0.0.1:5180')
        .set('X-Forwarded-Host', 'timebank.global');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Exchange Skills Across Borders');
      expect(response.text).toContain('href="/hour-timebank"');
      expect(response.text).not.toContain('Choose a community');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'timebank.global' });
      expect(api.getPlatformStats).toHaveBeenCalledWith({ host: 'timebank.global' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('serves the tenant home at the slugless root when Laravel resolves the host accessible domain', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getPlatformStats.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 2,
          name: 'Acme Timebank',
          slug: 'acme',
          accessible_domain: 'acme-accessible.test'
        }
      });
      api.getPlatformStats.mockResolvedValueOnce({
        data: {
          members: 123,
          hours_exchanged: 45,
          listings: 6,
          communities: 1
        }
      });

      const response = await request(app)
        .get('/')
        .set('Host', 'acme-accessible.test');

      expect(response.status).toBe(200);
      expect(response.text).toContain('<h1 class="govuk-heading-xl">Accessible</h1>');
      expect(response.text).toContain('Use a simpler, accessible version of Acme Timebank for core community tasks.');
      expect(response.text).toContain('href="/"');
      expect(response.text).toContain('href="/login"');
      expect(response.text).toContain('href="/register"');
      expect(response.text).not.toContain('Choose a community');
      expect(response.text).not.toContain('/acme/accessible');
      expect(response.text).not.toContain('/acme/alpha');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'acme-accessible.test' });
      expect(api.getPlatformStats).toHaveBeenCalledWith({ host: 'acme-accessible.test' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('canonicalizes tenant-prefixed accessible paths to slugless paths on custom domains', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getTenantBootstrap.mockResolvedValue({
        data: {
          id: 2,
          name: 'Acme Timebank',
          slug: 'acme',
          accessible_domain: 'acme-accessible.test'
        }
      });

      const alphaResponse = await request(app)
        .get('/acme/alpha/login?status=auth-required')
        .set('Host', 'acme-accessible.test');

      expect(alphaResponse.status).toBe(301);
      expect(alphaResponse.headers.location).toBe('/login?status=auth-required');

      const accessibleResponse = await request(app)
        .get('/acme/accessible/register')
        .set('Host', 'acme-accessible.test');

      expect(accessibleResponse.status).toBe(301);
      expect(accessibleResponse.headers.location).toBe('/register');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'acme-accessible.test' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('serves a direct child tenant below a parent custom domain path', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 3,
          name: 'Dunmanway Timebank',
          slug: 'dunmanway',
          parent_domain: 'parent-domain.test'
        }
      });

      const response = await request(app)
        .get('/dunmanway/login?status=auth-required')
        .set('Host', 'parent-domain.test');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Sign in');
      expect(response.text).toContain('action="/dunmanway/login"');
      expect(response.text).toContain('href="/dunmanway/register"');
      expect(response.text).not.toContain('/dunmanway/accessible');
      expect(response.text).not.toContain('/dunmanway/alpha');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ slug: 'dunmanway' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it('allows Laravel-unreserved first segments to resolve as parent-domain child slugs', async () => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 33,
          name: 'Gardeners Timebank',
          slug: 'gardeners',
          parent_domain: 'parent-domain.test'
        }
      });

      const response = await request(app)
        .get('/gardeners/login?status=auth-required')
        .set('Host', 'parent-domain.test');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Sign in');
      expect(response.text).toContain('action="/gardeners/login"');
      expect(response.text).toContain('href="/gardeners/register"');
      expect(response.text).not.toContain('/gardeners/accessible');
      expect(response.text).not.toContain('/gardeners/alpha');
      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ slug: 'gardeners' });
      expect(api.getTenants).not.toHaveBeenCalled();
    });

    it.each([
      'advertise',
      'auth',
      'clubs',
      'coupons',
      'courses',
      'developers',
      'donations',
      'join',
      'me',
      'municipality-calendar',
      'partner-analytics',
      'pilot-apply',
      'pilot-inquiry',
      'podcasts',
      'premium',
      'pricing',
      'regional-analytics',
      'saved',
      'trust-and-safety',
      'users',
      'verify-identity-optional'
    ])('does not treat newly Laravel-reserved /%s as a child tenant slug', async (segment) => {
      const api = require('../src/lib/api');
      api.getTenants.mockClear();
      api.getTenantBootstrap.mockClear();
      api.getTenantBootstrap.mockResolvedValueOnce({
        data: {
          id: 4,
          name: 'Timebank Global',
          slug: 'timebank-global',
          domain: 'parent-domain.test'
        }
      });

      await request(app)
        .get(`/${segment}`)
        .set('Host', 'parent-domain.test');

      expect(api.getTenantBootstrap).toHaveBeenCalledWith({ host: 'parent-domain.test' });
      expect(api.getTenantBootstrap).not.toHaveBeenCalledWith({ slug: segment });
      expect(api.getTenants).not.toHaveBeenCalled();
    });
  });

  describe('GET /health', () => {
    it('should return OK', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });
  });

  describe('GET /login', () => {
    it('should return login page', async () => {
      const response = await request(app).get('/login');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Sign in');
    });
  });

  describe('GET /register', () => {
    it('should return registration page', async () => {
      const response = await request(app).get('/register');

      expect(response.status).toBe(200);
      expect(response.text).toContain('<h1 class="govuk-heading-xl">Register</h1>');
    });
  });

  describe('GET /nonexistent', () => {
    it('should return 404', async () => {
      const response = await request(app).get('/nonexistent-page');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });
  });
});

describe('Protected Routes', () => {
  let app;

  beforeAll(() => {
    app = require('../src/server');
  });

  describe('without authentication', () => {
    it('GET /dashboard should redirect to login', async () => {
      const response = await request(app).get('/dashboard');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?status=auth-required');
    });

    it('GET /listings should remain public like Laravel Blade', async () => {
      const api = require('../src/lib/api');
      api.getListings.mockResolvedValueOnce({ data: [], meta: {} });
      api.getListingCategories.mockResolvedValueOnce({ data: [] });

      const response = await request(app).get('/listings');

      expect(response.status).toBe(200);
      expect(response.text).toContain('<h1 class="govuk-heading-xl">Listings</h1>');
      expect(response.text).toContain('href="/login?status=auth-required"');
    });

    it('GET /wallet should redirect to login', async () => {
      const response = await request(app).get('/wallet');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?status=auth-required');
    });

    it('GET /messages should redirect to login', async () => {
      const response = await request(app).get('/messages');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?status=auth-required');
    });

    it('GET /profile should redirect to login', async () => {
      const response = await request(app).get('/profile');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?status=auth-required');
    });

    it('GET /settings should return not found', async () => {
      const response = await request(app).get('/settings');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('GET /progress should return not found', async () => {
      const response = await request(app).get('/progress');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('GET /profile/edit should return not found', async () => {
      const response = await request(app).get('/profile/edit');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('legacy wallet GET pages should return not found', async () => {
      for (const path of ['/wallet/transactions', '/wallet/transactions/42', '/wallet/transfer']) {
        const response = await request(app).get(path);

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }
    });

    it('legacy listing delete GET page should return not found', async () => {
      const response = await request(app).get('/listings/42/delete');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('bare /messages/new should return not found', async () => {
      const getResponse = await request(app).get('/messages/new');
      expect(getResponse.status).toBe(404);
      expect(getResponse.text).toContain('Page not found');

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const postResponse = await agent
        .post('/messages/new')
        .type('form')
        .send({ _csrf: csrfMatch[1] });

      expect(postResponse.status).toBe(404);
      expect(postResponse.text).toContain('Page not found');
    });

    it('legacy feed post routes should return not found', async () => {
      for (const path of ['/feed/new', '/feed/42', '/feed/42/edit']) {
        const response = await request(app).get(path);

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      for (const path of [
        '/feed/new',
        '/feed/42/edit',
        '/feed/42/delete',
        '/feed/42/like',
        '/feed/42/unlike',
        '/feed/42/comments',
        '/feed/42/comments/12/delete'
      ]) {
        const response = await agent
          .post(path)
          .type('form')
          .send({ _csrf: csrfMatch[1] });

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }
    });

    it('legacy event routes should return not found', async () => {
      const myEventsResponse = await request(app).get('/events/my');
      expect(myEventsResponse.status).toBe(404);
      expect(myEventsResponse.text).toContain('Page not found');

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const removeRsvpResponse = await agent
        .post('/events/42/rsvp/remove')
        .type('form')
        .send({ _csrf: csrfMatch[1] });

      expect(removeRsvpResponse.status).toBe(404);
      expect(removeRsvpResponse.text).toContain('Page not found');
    });

    it('legacy group member-management routes should return not found', async () => {
      for (const path of ['/groups/my', '/groups/42/members']) {
        const response = await request(app).get(path);

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      for (const path of [
        '/groups/42/members/add',
        '/groups/42/members/55/remove',
        '/groups/42/members/55/role',
        '/groups/42/transfer-ownership'
      ]) {
        const response = await agent
          .post(path)
          .type('form')
          .send({ _csrf: csrfMatch[1] });

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }
    });

    it('legacy member connect route should return not found', async () => {
      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const response = await agent
        .post('/members/77/connect')
        .type('form')
        .send({ _csrf: csrfMatch[1] });

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('legacy search suggestions route should return not found', async () => {
      const response = await request(app).get('/search/suggestions?q=repair');

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('legacy generic report routes should return not found', async () => {
      for (const path of ['/reports/new?type=user&id=77&return_to=/members/77', '/reports/my']) {
        const response = await request(app).get(path);

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const response = await agent
        .post('/reports/new')
        .type('form')
        .send({ _csrf: csrfMatch[1], content_type: 'user', content_id: '77', reason: 'other' });

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('legacy review edit and target-specific routes should return not found', async () => {
      const getResponse = await request(app).get('/reviews/91/edit');

      expect(getResponse.status).toBe(404);
      expect(getResponse.text).toContain('Page not found');

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      for (const path of ['/reviews/91/edit', '/reviews/user/77', '/reviews/listing/42']) {
        const response = await agent
          .post(path)
          .type('form')
          .send({ _csrf: csrfMatch[1], rating: '5', comment: 'Helpful' });

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }
    });

    it('legacy two-factor verification alias should return not found', async () => {
      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      const response = await agent
        .post('/verify-2fa')
        .type('form')
        .send({ _csrf: csrfMatch[1], code: '123456' });

      expect(response.status).toBe(404);
      expect(response.text).toContain('Page not found');
    });

    it('legacy local admin route family should return not found', async () => {
      for (const path of [
        '/admin',
        '/admin/categories',
        '/admin/categories/42/edit',
        '/admin/categories/new',
        '/admin/config',
        '/admin/moderation',
        '/admin/roles',
        '/admin/roles/7/edit',
        '/admin/roles/new',
        '/admin/users',
        '/admin/users/77',
        '/admin/users/77/edit'
      ]) {
        const response = await request(app).get(path);

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }

      const agent = request.agent(app);
      const csrfPage = await agent.get('/login');
      const csrfMatch = csrfPage.text.match(/name="_csrf" value="([^"]+)"/);
      expect(csrfMatch).not.toBeNull();

      for (const path of [
        '/admin/categories/42/delete',
        '/admin/categories/42/edit',
        '/admin/categories/new',
        '/admin/config',
        '/admin/moderation/42/approve',
        '/admin/moderation/42/reject',
        '/admin/roles/7/delete',
        '/admin/roles/7/edit',
        '/admin/roles/new',
        '/admin/users/77/activate',
        '/admin/users/77/edit',
        '/admin/users/77/suspend'
      ]) {
        const response = await agent
          .post(path)
          .type('form')
          .send({ _csrf: csrfMatch[1] });

        expect(response.status).toBe(404);
        expect(response.text).toContain('Page not found');
      }
    });
  });
});

describe('Security Headers', () => {
  let app;

  beforeAll(() => {
    app = require('../src/server');
  });

  it('should include security headers', async () => {
    const response = await request(app).get('/');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
