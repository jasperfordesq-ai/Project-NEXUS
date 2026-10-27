// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Coupon "redeem in store" QR code (27 Oct 2026).
 *
 * React's CouponDetailPage asks the API for a short-lived, one-time QR token
 * (POST /v2/coupons/{id}/qr: { token, expires_at, coupon_code }) and shows it as a QR
 * code with its expiry. The accessible coupon page showed the code
 * only. Here a form button asks for the token (no JavaScript), it is kept in the
 * session rather than the address bar, and the QR is drawn on the server
 * (lib/qr-svg.js).
 */

const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  callCouponApi: jest.fn(),
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const couponsRouter = require('../src/routes/coupons');

const t = createTranslator('en');
const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
env.addFilter('nl2br', (value) => String(value || ''));

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'coupon-qr-test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.csrfToken = () => 'csrf';
    res.locals.t = t;
    res.locals.urlFor = (value) => value;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/coupons', couponsRouter);
  return app;
}

function renderDetail(locals) {
  const source = fs.readFileSync(path.join(viewsDir, 'coupons/detail.njk'), 'utf8');
  const imports = source.split('\n').filter((line) => line.startsWith('{% from')).join('\n');
  const start = source.indexOf('{% block content %}') + '{% block content %}'.length;
  const end = source.lastIndexOf('{% endblock %}');
  return env.renderString(`${imports}\n${source.slice(start, end)}`, { t, urlFor: (v) => v, ...locals });
}

const COUPON = { id: 8, title: 'Ten percent off', code: 'SAVE10', discount_type: 'percent', discount_value: 10 };

beforeEach(() => jest.clearAllMocks());

describe('coupon redeem-in-store QR', () => {
  it('offers a "redeem in store" button on the coupon page', async () => {
    api.callCouponApi.mockResolvedValue({ data: COUPON });
    const res = await request(createApp()).get('/coupons/8');
    expect(res.body.locals.qr).toBeNull();
    const html = renderDetail(res.body.locals);
    expect(html).toContain('action="/coupons/8/qr"');
    expect(html).toContain('name="_csrf"');
    expect(html).toContain(t('govuk_alpha_commerce.coupon_qr.button'));
  });

  it('asks the API for a one-time token, keeps it out of the URL and shows it as a QR code', async () => {
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    api.callCouponApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'POST' && apiPath === '/8/qr') return { data: { token: 'ABCDEF1234567890', expires_at: expires, coupon_code: 'SAVE10' } };
      return { data: COUPON };
    });
    const agent = request.agent(createApp());
    const post = await agent.post('/coupons/8/qr').type('form').send({});
    expect(api.callCouponApi).toHaveBeenCalledWith('test-token', 'POST', '/8/qr', {});
    expect(post.status).toBe(302);
    expect(post.headers.location).toBe('/coupons/8#redeem-in-store');
    expect(post.headers.location).not.toContain('ABCDEF');

    const page = await agent.get('/coupons/8');
    expect(page.body.locals.qr.token).toBe('ABCDEF1234567890');
    expect(page.body.locals.qr.svg).toContain('<svg');
    const html = renderDetail(page.body.locals);
    expect(html).toContain('<svg');
    // The one-time token is a credential: encoded in the QR only, never printed (lib/qr-svg.js).
    expect(html).not.toContain('ABCDEF1234567890');
    expect(html).toContain(t('govuk_alpha_commerce.coupon_qr.scan_at_checkout'));
  });

  it('drops an expired token instead of showing a code that will not scan', async () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    api.callCouponApi.mockImplementation(async (token, method) => (method === 'POST'
      ? { data: { token: 'OLDTOKEN00000000', expires_at: expired } }
      : { data: COUPON }));
    const agent = request.agent(createApp());
    await agent.post('/coupons/8/qr').type('form').send({});
    const page = await agent.get('/coupons/8');
    expect(page.body.locals.qr).toBeNull();
  });

  it('reports a refusal (for example a used-up coupon) on the page', async () => {
    api.callCouponApi.mockImplementation(async (token, method) => {
      if (method === 'POST') throw new api.ApiError('Coupon limit reached', 422);
      return { data: COUPON };
    });
    const agent = request.agent(createApp());
    const post = await agent.post('/coupons/8/qr').type('form').send({});
    expect(post.headers.location).toBe('/coupons/8?status=qr-failed#redeem-in-store');
    const page = await agent.get('/coupons/8?status=qr-failed');
    expect(page.body.locals.qrError).toBe(t('govuk_alpha_commerce.coupon_qr.failed'));
    expect(renderDetail(page.body.locals)).toContain(t('govuk_alpha_commerce.coupon_qr.failed'));
  });
});
