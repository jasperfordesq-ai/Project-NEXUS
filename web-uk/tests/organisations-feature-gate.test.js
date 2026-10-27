// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisation pages need the `organisations` feature as well as `volunteering`
 * (27 Oct 2026).
 *
 * The website gates /organisations, /organisations/register, My organisations and the
 * organisation dashboard on both switches, and the API answers 403 FEATURE_DISABLED
 * (VolunteerController::ensureOrganisationFeature) when `organisations` is off. This
 * site checked only `volunteering`, so a community with organisations off got pages
 * that could only fail.
 */

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
  class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError,
    getTenantBootstrap: jest.fn(),
    getTenants: jest.fn().mockResolvedValue({ data: [] })
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

const {
  isOrganisationPath,
  organisationsEnabled
} = require('../src/lib/volunteering-sections');

describe('the organisations switch', () => {
  it('is on unless the community has turned it off', () => {
    expect(organisationsEnabled({ features: { organisations: false } })).toBe(false);
    expect(organisationsEnabled({ features: { organisations: true } })).toBe(true);
    expect(organisationsEnabled({ features: {} })).toBe(true);
    expect(organisationsEnabled(undefined)).toBe(true);
  });

  it('covers the organisation pages and nothing else in volunteering', () => {
    expect(isOrganisationPath('/organisations')).toBe(true);
    expect(isOrganisationPath('/organisations/register')).toBe(true);
    expect(isOrganisationPath('/organisations/5')).toBe(true);
    expect(isOrganisationPath('/volunteering/my-organisations')).toBe(true);
    expect(isOrganisationPath('/volunteering/organisations/5/dashboard')).toBe(true);
    expect(isOrganisationPath('/volunteering/org/5/safeguarding')).toBe(true);
    expect(isOrganisationPath('/volunteering')).toBe(false);
    expect(isOrganisationPath('/volunteering/hours')).toBe(false);
    expect(isOrganisationPath('/volunteering/opportunities/3')).toBe(false);
    expect(isOrganisationPath('/organisationsx')).toBe(false);
  });
});

describe('the gate on the running app', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  function tenant(features) {
    api.getTenantBootstrap.mockResolvedValue({
      data: { id: 2, name: 'Acme Timebank', slug: 'acme', modules: {}, features }
    });
  }

  it.each([
    '/acme/accessible/organisations',
    '/acme/accessible/organisations/register',
    '/acme/accessible/volunteering/my-organisations',
    '/acme/accessible/volunteering/organisations/5/dashboard'
  ])('refuses %s when organisations is off', async (url) => {
    tenant({ volunteering: true, organisations: false });

    const response = await request(app).get(url);

    expect(response.status).toBe(403);
  });

  it('lets the organisation directory through to its own sign-in check when organisations is on', async () => {
    tenant({ volunteering: true, organisations: true });

    const response = await request(app).get('/acme/accessible/organisations');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/login');
  });

  it('does not refuse the volunteering page itself when organisations is off', async () => {
    tenant({ volunteering: true, organisations: false });

    const response = await request(app).get('/acme/accessible/volunteering');

    expect(response.status).not.toBe(403);
  });
});
