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
  callMarketplaceApi: jest.fn()
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const marketplaceRouter = require('../src/routes/marketplace');

function createApp(translator = (key) => `translated:${key}`) {
  const app = express();

  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    if (translator) req.t = translator;
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/marketplace', marketplaceRouter);

  return app;
}

describe('request-scoped Marketplace status localization', () => {
  beforeEach(() => {
    api.callMarketplaceApi.mockReset().mockResolvedValue({ data: [] });
  });

  it.each([
    ['unsaved', 'govuk_alpha_commerce.saved.status_unsaved'],
    ['reported', 'govuk_alpha_commerce.report.status_reported'],
    ['listing-created', 'listings.create.created'],
    ['deleted', 'govuk_alpha_commerce.my_listings.status_deleted'],
    ['renewed', 'govuk_alpha_commerce.my_listings.status_renewed'],
    ['accepted', 'govuk_alpha_commerce.offers.status_accepted_done'],
    ['declined', 'govuk_alpha_commerce.offers.status_declined_done'],
    ['withdrawn', 'govuk_alpha_commerce.offers.status_withdrawn_done'],
    ['offer-sent', 'govuk_alpha_commerce.offers.status_offer_sent'],
    ['ordered', 'govuk_alpha_commerce.orders.status_ordered'],
    ['payment-submitted', 'govuk_alpha_commerce.orders.status_payment_submitted'],
    ['payment-cancelled', 'govuk_alpha_commerce.orders.status_payment_cancelled'],
    ['shipped', 'govuk_alpha_commerce.orders.status_shipped_done'],
    ['confirmed', 'govuk_alpha_commerce.orders.status_confirmed'],
    ['cancelled', 'govuk_alpha_commerce.orders.status_cancelled_done'],
    ['rated', 'govuk_alpha_commerce.orders.status_rated'],
    ['onboarding-complete', 'govuk_alpha_commerce.onboarding.status_complete'],
    ['slot-created', 'govuk_alpha_commerce.slots.status_slot_created'],
    ['slot-saved', 'govuk_alpha_commerce.slots.status_slot_saved'],
    ['slot-deleted', 'govuk_alpha_commerce.slots.status_slot_deleted'],
    ['pickup-confirmed', 'govuk_alpha_commerce.slots.status_pickup_confirmed'],
    ['coupon-created', 'govuk_alpha_commerce.coupons.status_coupon_created'],
    ['coupon-saved', 'govuk_alpha_commerce.coupons.status_coupon_saved'],
    ['coupon-deleted', 'govuk_alpha_commerce.coupons.status_coupon_deleted']
  ])('renders success token %s through %s', async (status, translationKey) => {
    const response = await request(createApp()).get(`/marketplace?status=${status}`);

    expect(response.status).toBe(200);
    expect(response.body.locals.status).toEqual({
      type: 'success',
      message: `translated:${translationKey}`
    });
  });

  it.each([
    ['listing-create-failed', 'govuk_alpha_commerce.listing_form.error_create'],
    ['listing-save-failed', 'govuk_alpha_commerce.listing_form.error_update'],
    ['delete-failed', 'govuk_alpha_commerce.my_listings.status_delete_failed'],
    ['renew-failed', 'govuk_alpha_commerce.my_listings.status_renew_failed'],
    ['order-failed', 'govuk_alpha_commerce.buy.error_generic'],
    ['offer-amount-invalid', 'govuk_alpha_commerce.offer.error_amount'],
    ['offer-failed', 'govuk_alpha_commerce.offer.error_generic'],
    ['report-failed', 'govuk_alpha_commerce.report.status_report_failed'],
    ['accept-failed', 'govuk_alpha_commerce.offers.status_action_failed'],
    ['decline-failed', 'govuk_alpha_commerce.offers.status_action_failed'],
    ['withdraw-failed', 'govuk_alpha_commerce.offers.status_action_failed'],
    ['pay-not-pending', 'govuk_alpha_commerce.orders.status_pay_not_pending'],
    ['pay-not-required', 'govuk_alpha_commerce.orders.status_pay_not_required'],
    ['pay-unavailable', 'govuk_alpha_commerce.orders.status_pay_unavailable'],
    ['pay-failed', 'govuk_alpha_commerce.orders.status_pay_failed'],
    ['ship-failed', 'govuk_alpha_commerce.orders.status_ship_failed'],
    ['confirm-failed', 'govuk_alpha_commerce.orders.status_confirm_failed'],
    ['cancel-failed', 'govuk_alpha_commerce.orders.status_cancel_failed'],
    ['rate-failed', 'govuk_alpha_commerce.orders.status_rate_failed'],
    ['rate-invalid', 'govuk_alpha_commerce.orders.status_rate_invalid'],
    ['business-name-required', 'govuk_alpha_commerce.onboarding.error_business_name'],
    ['display-name-required', 'govuk_alpha_commerce.onboarding.error_display_name'],
    ['onboarding-failed', 'govuk_alpha_commerce.onboarding.status_failed'],
    ['slot-create-failed', 'govuk_alpha_commerce.slots.status_slot_create_failed'],
    ['slot-save-failed', 'govuk_alpha_commerce.slots.status_slot_save_failed'],
    ['slot-delete-failed', 'govuk_alpha_commerce.slots.status_slot_delete_failed'],
    ['pickup-scan-failed', 'govuk_alpha_commerce.slots.status_pickup_scan_failed'],
    ['coupon-title-required', 'govuk_alpha_commerce.coupons.error_title'],
    ['coupon-create-failed', 'govuk_alpha_commerce.coupons.error_create'],
    ['coupon-save-failed', 'govuk_alpha_commerce.coupons.status_coupon_save_failed'],
    ['coupon-delete-failed', 'govuk_alpha_commerce.coupons.status_coupon_delete_failed']
  ])('renders error token %s through %s', async (status, translationKey) => {
    const response = await request(createApp()).get(`/marketplace?status=${status}`);

    expect(response.status).toBe(200);
    expect(response.body.locals.status).toEqual({
      type: 'error',
      message: `translated:${translationKey}`
    });
  });

  it.each([
    ['saved', 'success', 'This item has been saved.'],
    ['listing-saved', 'success', 'Your changes were saved.'],
    ['listing-validation', 'error', 'Check the listing details and try again.'],
    ['save-failed', 'error', 'Sorry, this item could not be saved. Please try again.'],
    ['unsave-failed', 'error', 'Sorry, this item could not be removed from your saved list. Please try again.']
  ])('retains the exact fallback for %s when Laravel has no unambiguous key', async (status, type, message) => {
    const response = await request(createApp()).get(`/marketplace?status=${status}`);

    expect(response.status).toBe(200);
    expect(response.body.locals.status).toEqual({ type, message });
  });

  it.each(['not-a-real-status', 'payment-started'])('does not expose neutral token %s as user-facing text', async (status) => {
    const response = await request(createApp()).get(`/marketplace?status=${status}`);

    expect(response.status).toBe(200);
    expect(response.body.locals.status).toBeNull();
  });

  it('uses the English Laravel catalog when an isolated route does not install req.t', async () => {
    const response = await request(createApp(null)).get('/marketplace?status=listing-created');

    expect(response.status).toBe(200);
    expect(response.body.locals.status).toEqual({
      type: 'success',
      message: 'Your listing has been published.'
    });
  });

  it('resolves an available native Laravel translation for the listing-created token', async () => {
    const response = await request(createApp(createTranslator('ga')))
      .get('/marketplace?status=listing-created');

    expect(response.status).toBe(200);
    expect(response.body.locals.status).toEqual({
      type: 'success',
      message: createTranslator('ga')('listings.create.created')
    });
    expect(response.body.locals.status.message).not.toBe('Your listing has been published.');
  });
});
