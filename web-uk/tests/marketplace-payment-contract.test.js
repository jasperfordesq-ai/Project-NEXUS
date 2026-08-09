// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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
  callMarketplaceApi: jest.fn(),
  uploadMarketplaceListingImages: jest.fn()
}));

const api = require('../src/lib/api');
const marketplaceActionRouter = require('../src/routes/marketplace-actions');

function createApp({ token = 'test-token', prefix = '' } = {}) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = token ? { token } : {};
    res.locals.urlFor = (pathname) => `${prefix}${pathname}`;
    next();
  });
  app.use('/marketplace', marketplaceActionRouter);

  return app;
}

describe('accessible Marketplace hosted-checkout boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['', '/marketplace/orders?status=pay-failed'],
    ['/acme/accessible', '/acme/accessible/marketplace/orders?status=pay-failed'],
    ['/child-community', '/child-community/marketplace/orders?status=pay-failed']
  ])('fails honestly without creating a PaymentIntent under prefix %s', async (prefix, location) => {
    const response = await request(createApp({ prefix }))
      .post('/marketplace/orders/42/pay')
      .type('form')
      .send({});

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(location);
    expect(response.headers.location).not.toContain('payment-started');
    expect(response.headers.location).not.toContain('pay-unavailable');
    expect(api.callMarketplaceApi).not.toHaveBeenCalled();
  });

  it('preserves the tenant-mounted auth handoff without calling Laravel payments', async () => {
    const response = await request(createApp({ token: '', prefix: '/acme/accessible' }))
      .post('/marketplace/orders/42/pay')
      .type('form')
      .send({});

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/login?status=auth-required');
    expect(api.callMarketplaceApi).not.toHaveBeenCalled();
  });
});
