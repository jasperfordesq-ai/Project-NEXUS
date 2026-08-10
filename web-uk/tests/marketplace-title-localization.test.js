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
  getProfile: jest.fn(),
  callMarketplaceApi: jest.fn(),
  callMerchantOnboardingApi: jest.fn()
}));

const api = require('../src/lib/api');
const marketplaceRouter = require('../src/routes/marketplace');

function createApp() {
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

describe('Laravel-first Marketplace document-title localization', () => {
  beforeEach(() => {
    api.getProfile.mockReset().mockResolvedValue({ data: { id: 101 } });
    api.callMerchantOnboardingApi.mockReset().mockResolvedValue({ data: {} });
    api.callMarketplaceApi.mockReset().mockImplementation((token, method, apiPath) => {
      if (apiPath === '/categories') {
        return Promise.resolve({ data: [{ id: 9, name: 'Dynamic category name', slug: 'transport' }] });
      }
      if (apiPath === '/seller/pickup-slots') {
        return Promise.resolve({
          data: [{ id: 7, capacity: 5, slot_start: '2026-07-11T10:00:00Z', slot_end: '2026-07-11T11:00:00Z' }]
        });
      }
      if (apiPath === '/seller/coupons') {
        return Promise.resolve({
          data: [{ id: 5, title: 'Dynamic coupon title', discount_type: 'percent', discount_value: 10, status: 'draft' }]
        });
      }
      if (apiPath === '/sellers/77') {
        return Promise.resolve({ data: { id: 77, display_name: 'Dynamic seller name' } });
      }
      if (/^\/listings\/\d+$/.test(apiPath)) {
        return Promise.resolve({
          data: {
            id: 42,
            title: 'Dynamic listing title',
            price: 12,
            price_currency: 'EUR',
            price_type: 'fixed',
            status: 'active',
            delivery_method: 'pickup'
          }
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  it.each([
    ['/marketplace', 'marketplace/index', 'Marketplace', 'marketplace.title'],
    ['/marketplace/create', 'marketplace/form', 'Create a listing', 'govuk_alpha_commerce.listing_form.title_create'],
    ['/marketplace/mine', 'marketplace/manage', 'My listings', 'govuk_alpha_commerce.my_listings.title'],
    ['/marketplace/saved', 'marketplace/listing-list', 'Saved items', 'govuk_alpha_commerce.saved.title'],
    ['/marketplace/free', 'marketplace/listing-list', 'Free items', 'govuk_alpha_commerce.free_items.title'],
    ['/marketplace/search', 'marketplace/search', 'Advanced search', 'govuk_alpha_commerce.marketplace_advanced.title'],
    ['/marketplace/offers', 'marketplace/offers', 'My offers', 'govuk_alpha_commerce.offers.title'],
    ['/marketplace/orders', 'marketplace/orders', 'My orders', 'govuk_alpha_commerce.orders_buyer.title'],
    ['/marketplace/sales', 'marketplace/orders', 'Sales', 'govuk_alpha_commerce.orders_seller.title'],
    ['/marketplace/pickups', 'marketplace/pickups', 'My collections', 'govuk_alpha_commerce.pickups.title'],
    ['/marketplace/onboarding', 'marketplace/onboarding', 'Become a seller', 'govuk_alpha_commerce.onboarding.title'],
    ['/marketplace/slots', 'marketplace/slots', 'Pickup slots', 'govuk_alpha_commerce.slots.title'],
    ['/marketplace/slots/7/edit', 'marketplace/slot-form', 'Edit pickup slot', 'govuk_alpha_commerce.slots.title_edit'],
    ['/marketplace/coupons', 'marketplace/coupons', 'My coupons', 'govuk_alpha_commerce.coupons.title'],
    ['/marketplace/coupons/new', 'marketplace/coupon-form', 'Create a coupon', 'govuk_alpha_commerce.coupons.title_create'],
    ['/marketplace/coupons/5/edit', 'marketplace/coupon-form', 'Edit your coupon', 'govuk_alpha_commerce.coupons.title_edit'],
    ['/marketplace/42/edit', 'marketplace/form', 'Edit your listing', 'govuk_alpha_commerce.listing_form.title_edit'],
    ['/marketplace/42/buy', 'marketplace/buy', 'Confirm your purchase', 'govuk_alpha_commerce.buy.title'],
    ['/marketplace/42/offer', 'marketplace/offer', 'Make an offer', 'govuk_alpha_commerce.offer.title'],
    ['/marketplace/42/report', 'marketplace/report', 'Report a listing', 'govuk_alpha_commerce.report.title']
  ])('maps %s to the exact Laravel title key', async (url, view, fallback, titleKey) => {
    const response = await request(createApp()).get(url);

    expect(response.status).toBe(200);
    expect(response.body.view).toBe(view);
    expect(response.body.locals).toEqual(expect.objectContaining({
      title: fallback,
      titleKey
    }));
    expect(response.body.locals.titleReplacements).toBeUndefined();
  });

  it.each([
    ['/marketplace/category/transport', 'marketplace/listing-list', 'Dynamic category name'],
    ['/marketplace/seller/77', 'marketplace/seller', 'Dynamic seller name'],
    ['/marketplace/42', 'marketplace/detail', 'Dynamic listing title']
  ])('preserves the user-authored document title for %s', async (url, view, title) => {
    const response = await request(createApp()).get(url);

    expect(response.status).toBe(200);
    expect(response.body.view).toBe(view);
    expect(response.body.locals.title).toBe(title);
    expect(response.body.locals.titleKey).toBeUndefined();
    expect(response.body.locals.titleReplacements).toBeUndefined();
  });

  it.each([
    ['/marketplace/create', 'mine'],
    ['/marketplace/42/edit', 'mine'],
    ['/marketplace/pickups', 'orders'],
    ['/marketplace/coupons', 'sell'],
    ['/marketplace/coupons/new', 'sell'],
    ['/marketplace/coupons/5/edit', 'sell']
  ])('matches the Blade Marketplace navigation selection for %s', async (url, activeTab) => {
    const response = await request(createApp()).get(url);

    expect(response.status).toBe(200);
    expect(response.body.locals.activeTab).toBe(activeTab);
  });
});
