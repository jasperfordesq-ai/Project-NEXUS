// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public certificate check on the accessible frontend (gap C1, 7 Oct 2026).
 *
 * Pinned here:
 * - a code in the address only prefills the box: nothing is looked up from it;
 * - a missing code or name is refused locally, with what was typed kept;
 * - a match shows only what the certificate prints; a mismatch says so plainly;
 * - a busy API (429) and a broken one are told apart, and neither looks like "no";
 * - a community with volunteering off answers 404, before and after the API.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

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
    checkVolunteerCertificate: jest.fn()
  };
});

const api = require('../src/lib/api');
const certificateCheckRoutes = require('../src/routes/certificate-check');

const PREFIX = '/acme/accessible';
const PAGE = `${PREFIX}/verify-certificate`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const K = 'govuk_alpha_volunteering.certificate_check.';

function createApp({ features = { volunteering: true } } = {}) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'certificate-check-test-secret', resave: false, saveUninitialized: false }));

  app.use(PREFIX, (req, res, next) => {
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: {}, features },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: false,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: PAGE,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? ''))
    });
    next();
  }, certificateCheckRoutes);

  return app;
}

// Nunjucks autoescape turns the apostrophe in "volunteer's" into &#39;.
const html = (text) => String(text).replace(/'/g, '&#39;');

function inputValue(html, id) {
  const match = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]*)"`));
  return match ? match[1] : null;
}

beforeEach(() => {
  api.checkVolunteerCertificate.mockReset();
});

describe('certificate check page', () => {
  it('prefills the code from the address and looks nothing up', async () => {
    const res = await request(createApp()).get(`${PAGE}/I2MST0GPZLQ47DIX`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${K}title`));
    expect(inputValue(res.text, 'code')).toBe('I2MST0GPZLQ47DIX');
    expect(inputValue(res.text, 'name')).toBe('');
    expect(res.text).toContain(`action="${PAGE}"`);
    expect(api.checkVolunteerCertificate).not.toHaveBeenCalled();
  });

  it('does not match an address code that is not code-shaped', async () => {
    const res = await request(createApp()).get(`${PAGE}/${encodeURIComponent('<b>x</b>')}`);

    expect(res.status).toBe(404);
    expect(api.checkVolunteerCertificate).not.toHaveBeenCalled();
  });

  it('does not prefill an over-long code from the address', async () => {
    const res = await request(createApp()).get(`${PAGE}/${'A'.repeat(65)}`);

    expect(res.status).toBe(200);
    expect(inputValue(res.text, 'code')).toBe('');
  });

  it('refuses a missing name locally and keeps the code', async () => {
    const res = await request(createApp()).post(PAGE).type('form').send({ code: 'ABC123', name: '  ' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain(html(t(`${K}name_required`)));
    expect(res.text).not.toContain(html(t(`${K}code_required`)));
    expect(inputValue(res.text, 'code')).toBe('ABC123');
    expect(api.checkVolunteerCertificate).not.toHaveBeenCalled();
  });

  it('confirms a match with only what the certificate prints', async () => {
    api.checkVolunteerCertificate.mockResolvedValue({
      data: {
        valid: true,
        name: 'Áine Ní Bhriain',
        total_hours: 12.5,
        date_range: { start: '2026-01-05', end: '2026-09-30' },
        organizations: [{ name: 'Food Bank', hours: 10 }, { name: '', hours: 2.5 }],
        generated_at: '2026-10-01 09:00:00',
        user_id: 4242
      }
    });

    const res = await request(createApp()).post(PAGE).type('form').send({ code: ' abc123 ', name: 'aine ni bhriain' });

    expect(res.status).toBe(200);
    expect(api.checkVolunteerCertificate).toHaveBeenCalledWith('abc123', 'aine ni bhriain');
    expect(res.text).toContain('data-testid="certificate-check-valid"');
    expect(res.text).toContain(t(`${K}valid_title`));
    expect(res.text).toContain(html(t(`${K}valid_body`, { name: 'Áine Ní Bhriain' })));
    expect(res.text).toContain('12.5');
    expect(res.text).toContain(t(`${K}period_range`, { start: '2026-01-05', end: '2026-09-30' }));
    expect(res.text).toContain(t(`${K}organisation_hours`, { name: 'Food Bank', hours: '10' }));
    expect(res.text).toContain(t(`${K}organisation_hours`, { name: t(`${K}independent`), hours: '2.5' }));
    expect(res.text).not.toContain('4242');
  });

  it('says plainly when the code and name do not match', async () => {
    api.checkVolunteerCertificate.mockResolvedValue({ data: { valid: false } });

    const res = await request(createApp()).post(PAGE).type('form').send({ code: 'ABC123', name: 'Someone Else' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-testid="certificate-check-invalid"');
    expect(res.text).toContain(t(`${K}invalid_title`));
    expect(res.text).not.toContain('data-testid="certificate-check-valid"');
    expect(inputValue(res.text, 'name')).toBe('Someone Else');
  });

  it('tells a busy API apart from a broken one, and neither reads as "no match"', async () => {
    api.checkVolunteerCertificate.mockRejectedValueOnce(new api.ApiError('Too many', 429, {}));
    const busy = await request(createApp()).post(PAGE).type('form').send({ code: 'ABC123', name: 'Sam' });
    expect(busy.status).toBe(429);
    expect(busy.text).toContain(t(`${K}rate_limited`));
    expect(busy.text).not.toContain(t(`${K}invalid_title`));

    api.checkVolunteerCertificate.mockRejectedValueOnce(new api.ApiError('Server error', 500, {}));
    const broken = await request(createApp()).post(PAGE).type('form').send({ code: 'ABC123', name: 'Sam' });
    expect(broken.status).toBe(502);
    expect(broken.text).toContain(t(`${K}error`));
    expect(broken.text).not.toContain(t(`${K}invalid_title`));
  });

  it('answers 404 when the community has volunteering off', async () => {
    const app = createApp({ features: { volunteering: false } });

    expect((await request(app).get(PAGE)).status).toBe(404);
    expect((await request(app).post(PAGE).type('form').send({ code: 'ABC123', name: 'Sam' })).status).toBe(404);
    expect(api.checkVolunteerCertificate).not.toHaveBeenCalled();
  });

  it('answers 404 when the API refuses the feature', async () => {
    api.checkVolunteerCertificate.mockRejectedValue(new api.ApiError('Feature disabled', 403, {}));

    const res = await request(createApp()).post(PAGE).type('form').send({ code: 'ABC123', name: 'Sam' });

    expect(res.status).toBe(404);
  });
});
