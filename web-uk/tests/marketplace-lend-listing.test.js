// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace & Freecycle — "Borrow & lend" listings (price_type = lend) on the
 * accessible site. A lend listing is never for sale: it must not read "Free",
 * must not offer Buy or Make an offer, and the create form must send no price.
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
  getProfile: jest.fn(),
  callMarketplaceApi: jest.fn(),
  callMerchantOnboardingApi: jest.fn(),
  uploadMarketplaceListingImages: jest.fn()
}));

const api = require('../src/lib/api');
const marketplaceRouter = require('../src/routes/marketplace');
const marketplaceActionRouter = require('../src/routes/marketplace-actions');

function createReadApp() {
  const app = express();
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.session = {};
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/marketplace', marketplaceRouter);
  return app;
}

function createWriteApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.session = {};
    res.locals.urlFor = (pathname) => pathname;
    next();
  });
  app.use('/marketplace', marketplaceActionRouter);
  return app;
}

const LEND_LISTING = {
  id: 42,
  title: 'Pressure washer',
  description: 'Happy to lend for a weekend.',
  price: null,
  price_currency: 'EUR',
  price_type: 'lend',
  loan_terms: 'Up to one week. Collect from Rathmines. <b>Return clean.</b>',
  status: 'active',
  delivery_method: 'pickup',
  user: { id: 77, name: 'Owner' }
};

describe('accessible Marketplace & Freecycle — borrow & lend listings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: 101 } });
    api.callMerchantOnboardingApi.mockResolvedValue({ data: {} });
    api.callMarketplaceApi.mockImplementation((token, method, apiPath) => {
      if (/^\/listings\/\d+$/.test(apiPath)) {
        return Promise.resolve({ data: LEND_LISTING });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it('shows a lend listing as "Borrow", not "Free", with no buy or offer action', async () => {
    const response = await request(createReadApp()).get('/marketplace/42');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('marketplace/detail');
    const item = response.body.locals.item;
    expect(item.priceType).toBe('lend');
    expect(item.isLend).toBe(true);
    expect(item.priceLabel).toBe('Borrow');
    expect(item.priceLabel).not.toBe('Free');
    expect(item.priceTagClass).toBe('govuk-tag--turquoise');
    expect(item.canBuy).toBe(false);
    expect(item.canOffer).toBe(false);
    // Loan terms are plain text: markup an owner typed is stripped.
    expect(item.loanTerms).toBe('Up to one week. Collect from Rathmines. Return clean.');
  });

  it('keeps buy and offer for an ordinary priced listing', async () => {
    api.callMarketplaceApi.mockImplementation((token, method, apiPath) => {
      if (/^\/listings\/\d+$/.test(apiPath)) {
        return Promise.resolve({
          data: { ...LEND_LISTING, price: 12, price_type: 'fixed', loan_terms: 'stale' }
        });
      }
      return Promise.resolve({ data: [] });
    });

    const response = await request(createReadApp()).get('/marketplace/42');
    const item = response.body.locals.item;
    expect(item.isLend).toBe(false);
    expect(item.canBuy).toBe(true);
    expect(item.canOffer).toBe(true);
    expect(item.loanTerms).toBe('');
  });

  it('creates a lend listing with no price and the loan terms', async () => {
    api.callMarketplaceApi.mockResolvedValue({ data: { id: 55 } });

    const response = await request(createWriteApp())
      .post('/marketplace/create')
      .type('form')
      .send({
        title: 'Extension ladder',
        description: 'Three sections.',
        price_type: 'lend',
        price: '25',
        time_credit_price: '2',
        loan_terms: '  Up to two weeks.  ',
        delivery_method: 'pickup'
      });

    expect(response.status).toBe(302);
    expect(api.callMarketplaceApi).toHaveBeenCalledTimes(1);
    const payload = api.callMarketplaceApi.mock.calls[0][3];
    expect(payload.price_type).toBe('lend');
    expect(payload.price).toBeNull();
    expect(payload.time_credit_price).toBeNull();
    expect(payload.loan_terms).toBe('Up to two weeks.');
    expect(payload.delivery_method).toBe('pickup');
  });

  it('refuses a lend listing that could be posted before calling the server', async () => {
    const response = await request(createWriteApp())
      .post('/marketplace/create')
      .type('form')
      .send({
        title: 'Tile cutter',
        description: 'Collect only.',
        price_type: 'lend',
        delivery_method: 'shipping'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/marketplace/create?status=listing-validation');
    expect(api.callMarketplaceApi).not.toHaveBeenCalled();
  });
});
