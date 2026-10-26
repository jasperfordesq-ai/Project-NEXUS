// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Card payments on Stripe's hosted payment page (26 Oct 2026): optional identity
 * verification, card donations, club dues, and the member premium return address.
 *
 * Pinned here, for each journey:
 * - the POST sends the member to the API's `checkout_url` with a 303;
 * - the `return_url` given to the API is the ABSOLUTE address of this site's own
 *   page (a bare path is read by Laravel as a website path);
 * - a second submission of the same form can never start a second payment;
 * - already paid, payment in progress (409), cancelled return, and a success
 *   return that the server has not confirmed yet ("we are confirming") versus
 *   confirmed — the address alone is never treated as proof of payment;
 * - signed out goes to sign-in; the identity page is gated on its feature.
 */

const express = require('express');
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
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callVolunteeringApi: jest.fn(),
    getDonationReceipt: jest.fn(),
    createDonationCheckout: jest.fn(),
    getDonationCheckoutStatus: jest.fn(),
    getGroups: jest.fn(),
    getVolunteeringCategories: jest.fn(),
    searchUsers: jest.fn(),
    submitVolunteerExpenseWithReceipt: jest.fn(),
    getIdentityVerificationStatus: jest.fn(),
    saveIdentityDateOfBirth: jest.fn(),
    createIdentityFeeCheckout: jest.fn(),
    startIdentityVerification: jest.fn(),
    getMyVereinDues: jest.fn(),
    createVereinDuesCheckout: jest.fn(),
    getVereinDuesCheckoutStatus: jest.fn(),
    getMemberPremiumTiers: jest.fn(),
    getMemberPremiumMe: jest.fn(),
    createMemberPremiumCheckout: jest.fn(),
    createMemberPremiumPortal: jest.fn(),
    cancelMemberPremium: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const { ApiError } = api;
const identityRoutes = require('../src/routes/identity-verification');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');
const vereinMyDuesRoutes = require('../src/routes/verein-my-dues');
const premiumRoutes = require('../src/routes/premium');
const { tenantFeatureGate, routeGatesForPath } = require('../src/middleware/tenant-feature-gates');
const { absoluteUrl } = require('../src/lib/absolute-url');
const { buildAccountLinks } = require('../src/lib/account-links');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const HOST = '127.0.0.1';
const STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_123';

const identityApp = (options) => createApp('/verify-identity-optional', [identityRoutes], options);
const donationsApp = (options) => createApp('/volunteering', [volunteeringActionRoutes], options);
const duesApp = (options) => createApp('/me/verein-dues', [vereinMyDuesRoutes], options);
const premiumApp = (options) => createApp('/premium', [premiumRoutes], options);

function formToken(html) {
  const match = html.match(/name="form_token" value="([^"]+)"/);
  return match ? match[1] : '';
}

function decode(html) {
  return html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function status(data) {
  return {
    data: {
      has_id_verified_badge: false,
      user_has_dob: true,
      fee_cents: 500,
      fee_currency: 'EUR',
      payment_completed: false,
      verification_status: null,
      latest_session: null,
      ...data
    }
  };
}

beforeEach(() => jest.clearAllMocks());

describe('absolute return address', () => {
  it('builds this site’s own address with the tenant prefix, keeping the host and port', () => {
    const req = { headers: { host: 'localhost:5181' }, protocol: 'http' };
    const res = { locals: { urlFor: (p) => `${PREFIX}${p}` } };
    expect(absoluteUrl(req, res, '/me/verein-dues')).toBe(`http://localhost:5181${PREFIX}/me/verein-dues`);
  });

  it('uses the forwarded host and https in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = { headers: { host: 'internal:3001', 'x-forwarded-host': 'accessible.example.org' }, protocol: 'http' };
      const res = { locals: { urlFor: (p) => p } };
      expect(absoluteUrl(req, res, '/premium/return?status=success')).toBe('https://accessible.example.org/premium/return?status=success');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('ignores a malformed host header instead of copying it into the address', () => {
    const req = { headers: { host: 'evil.example/path?x' }, protocol: 'http' };
    const res = { locals: { urlFor: (p) => p } };
    expect(absoluteUrl(req, res, '/x')).toBe('http://evil.example/x');
  });
});

describe('identity verification', () => {
  it('is gated on identity_verification, without catching other /verify-identity* paths', () => {
    expect(routeGatesForPath('/verify-identity-optional').map((g) => g.featureKey)).toEqual(['identity_verification']);
    expect(routeGatesForPath('/verify-identity-optional/callback').map((g) => g.featureKey)).toEqual(['identity_verification']);
    expect(routeGatesForPath('/verify-identity').map((g) => g.featureKey)).toEqual(['identity_verification']);
    expect(routeGatesForPath('/verify-identity-optionally')).toEqual([]);
  });

  it('refuses the page when the community has switched the feature off', async () => {
    const offSwitch = (req, res, next) => {
      req.accessibleRouting.tenant = { ...req.accessibleRouting.tenant, features: { identity_verification: false } };
      next();
    };
    const router = express.Router();
    router.use('/verify-identity-optional', identityRoutes);
    const app = createApp('', [tenantFeatureGate, router], { before: [] });
    // Run the switch before the gate.
    const gated = createApp('', [offSwitch, tenantFeatureGate, router]);
    const res = await request(gated).get(`${PREFIX}/verify-identity-optional`);
    expect(res.status).toBe(403);
    expect(api.getIdentityVerificationStatus).not.toHaveBeenCalled();
    const open = await request(app).get(`${PREFIX}/verify-identity-optional`).set('Host', HOST);
    expect(api.getIdentityVerificationStatus).toHaveBeenCalled();
    expect(open.status).toBe(200);
  });

  it('sends a signed-out visitor to sign in', async () => {
    const res = await request(identityApp({ signedIn: false })).get(`${PREFIX}/verify-identity-optional`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/login?status=auth-required`);
    expect(api.getIdentityVerificationStatus).not.toHaveBeenCalled();
  });

  it('tells a member who already holds the badge so', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status({ has_id_verified_badge: true }));
    const res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional`);
    expect(res.status).toBe(200);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.verified_title'));
    expect(res.text).not.toContain('/verify-identity-optional/pay');
  });

  it('asks for a date of birth first, with the GOV.UK three-field date', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status({ user_has_dob: false }));
    const res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.dob_title'));
    expect(res.text).toContain('name="date_of_birth-day"');
    expect(res.text).toContain(`action="${PREFIX}/verify-identity-optional/date-of-birth"`);
  });

  it('saves the date of birth as YYYY-MM-DD and returns to the journey', async () => {
    api.saveIdentityDateOfBirth.mockResolvedValue({ data: { success: true } });
    const res = await request(identityApp()).post(`${PREFIX}/verify-identity-optional/date-of-birth`).type('form')
      .send({ 'date_of_birth-day': '3', 'date_of_birth-month': '4', 'date_of_birth-year': '1980' });
    expect(api.saveIdentityDateOfBirth).toHaveBeenCalledWith('test-token', '1980-04-03');
    expect(res.headers.location).toBe(`${PREFIX}/verify-identity-optional`);
  });

  it('shows the under-18 refusal on the date field', async () => {
    api.saveIdentityDateOfBirth.mockRejectedValue(new ApiError('no', 422, { errors: [{ code: 'DATE_OF_BIRTH_UNDER_MINIMUM_AGE' }] }));
    api.getIdentityVerificationStatus.mockResolvedValue(status({ user_has_dob: false }));
    const res = await request(identityApp()).post(`${PREFIX}/verify-identity-optional/date-of-birth`).type('form')
      .send({ 'date_of_birth-day': '3', 'date_of_birth-month': '4', 'date_of_birth-year': '2015' });
    expect(res.status).toBe(422);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.dob_under_minimum_age'));
  });

  it('shows the fee in the community currency with a single-use Pay form', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status());
    const res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional`);
    expect(res.text).toContain('€5.00');
    expect(res.text).toContain(`action="${PREFIX}/verify-identity-optional/pay"`);
    expect(res.text).toContain('data-prevent-double-click="true"');
    expect(formToken(res.text)).not.toBe('');
  });

  it('opens the hosted payment page with a 303, sending this page’s absolute address', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status());
    api.createIdentityFeeCheckout.mockResolvedValue({ data: { checkout_url: STRIPE, fee_cents: 500 } });
    const agent = request.agent(identityApp());
    const page = await agent.get(`${PREFIX}/verify-identity-optional`).set('Host', HOST);
    const res = await agent.post(`${PREFIX}/verify-identity-optional/pay`).set('Host', HOST).type('form')
      .send({ form_token: formToken(page.text) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(STRIPE);
    expect(api.createIdentityFeeCheckout).toHaveBeenCalledWith('test-token', `http://${HOST}${PREFIX}/verify-identity-optional`);

    // The same form again (a double click): no second payment, same page.
    const again = await agent.post(`${PREFIX}/verify-identity-optional/pay`).set('Host', HOST).type('form')
      .send({ form_token: formToken(page.text) });
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe(STRIPE);
    expect(api.createIdentityFeeCheckout).toHaveBeenCalledTimes(1);
  });

  it('refuses a Pay submission without the form token, and starts nothing', async () => {
    const res = await request(identityApp()).post(`${PREFIX}/verify-identity-optional/pay`).type('form').send({});
    expect(res.headers.location).toBe(`${PREFIX}/verify-identity-optional?status=form-expired`);
    expect(api.createIdentityFeeCheckout).not.toHaveBeenCalled();
  });

  it('says so when the fee is already paid, and when a payment is in progress (409)', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status());
    const agent = request.agent(identityApp());
    let page = await agent.get(`${PREFIX}/verify-identity-optional`);
    api.createIdentityFeeCheckout.mockResolvedValueOnce({ data: { payment_required: false, already_paid: true } });
    let res = await agent.post(`${PREFIX}/verify-identity-optional/pay`).type('form').send({ form_token: formToken(page.text) });
    expect(res.headers.location).toBe(`${PREFIX}/verify-identity-optional?status=paid`);

    page = await agent.get(`${PREFIX}/verify-identity-optional`);
    api.createIdentityFeeCheckout.mockRejectedValueOnce(new ApiError('busy', 409, { errors: [{ code: 'PAYMENT_IN_PROGRESS' }] }));
    res = await agent.post(`${PREFIX}/verify-identity-optional/pay`).type('form').send({ form_token: formToken(page.text) });
    expect(res.headers.location).toBe(`${PREFIX}/verify-identity-optional?status=payment-in-progress`);

    const shown = await agent.get(`${PREFIX}/verify-identity-optional?status=payment-in-progress`);
    expect(decode(shown.text)).toContain(t('govuk_alpha_settings.card_payment.in_progress'));
  });

  it('on a success return the server has not confirmed, says it is confirming, with no Pay button', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status());
    const res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional?checkout=success&session_id=cs_test_123`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.card_payment.confirming_title'));
    expect(res.text).toContain(`href="${PREFIX}/verify-identity-optional?checkout=success"`);
    expect(res.text).not.toContain('/verify-identity-optional/pay');
  });

  it('on a confirmed success return, says payment was received and offers the ID check', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status({ payment_completed: true }));
    const res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional?checkout=success&session_id=cs_test_123`);
    const html = decode(res.text);
    expect(html).toContain(t('govuk_alpha_settings.identity.payment_received'));
    expect(html).toContain(t('govuk_alpha_settings.identity.start_button'));
  });

  it('on a cancelled return, says the member was not charged and still offers to pay', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status());
    const res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional?checkout=cancelled`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.card_payment.cancelled_body'));
    expect(res.text).toContain('/verify-identity-optional/pay');
  });

  it('starts the ID check and sends the member to Stripe Identity, returning to the callback page', async () => {
    api.getIdentityVerificationStatus.mockResolvedValue(status({ payment_completed: true }));
    api.startIdentityVerification.mockResolvedValue({ data: { redirect_url: 'https://verify.stripe.com/start/abc' } });
    const agent = request.agent(identityApp());
    const page = await agent.get(`${PREFIX}/verify-identity-optional`).set('Host', HOST);
    const res = await agent.post(`${PREFIX}/verify-identity-optional/start`).set('Host', HOST).type('form')
      .send({ form_token: formToken(page.text) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('https://verify.stripe.com/start/abc');
    expect(api.startIdentityVerification).toHaveBeenCalledWith('test-token', `http://${HOST}${PREFIX}/verify-identity-optional/callback`);
  });

  it('the callback page explains passed, processing and failed from the status call', async () => {
    api.getIdentityVerificationStatus.mockResolvedValueOnce(status({ payment_completed: true, latest_session: { id: 1, status: 'processing' } }));
    let res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional/callback`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.in_progress_title'));
    expect(res.text).toContain(`href="${PREFIX}/verify-identity-optional/callback"`);

    api.getIdentityVerificationStatus.mockResolvedValueOnce(status({ payment_completed: true, latest_session: { id: 1, status: 'created' } }));
    res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional/callback`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.in_progress_title'));

    api.getIdentityVerificationStatus.mockResolvedValueOnce(status({ payment_completed: true, latest_session: { id: 1, status: 'failed', failure_reason: 'Document expired' } }));
    res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional/callback`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.failed_title'));
    expect(res.text).toContain('Document expired');

    api.getIdentityVerificationStatus.mockResolvedValueOnce(status({ has_id_verified_badge: true, latest_session: { id: 1, status: 'passed' } }));
    res = await request(identityApp()).get(`${PREFIX}/verify-identity-optional/callback`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.identity.verified_title'));
  });

  it('is linked from the account page while the feature is on', () => {
    const on = buildAccountLinks({ tenant: {}, t }).map((link) => link.href);
    const off = buildAccountLinks({ tenant: { features: { identity_verification: false } }, t }).map((link) => link.href);
    expect(on).toContain('/verify-identity-optional');
    expect(off).not.toContain('/verify-identity-optional');
  });
});

describe('card donations', () => {
  beforeEach(() => {
    api.callVolunteeringApi.mockResolvedValue({ data: [] });
  });

  it('offers Card next to the pledge methods, with a single-use form token', async () => {
    const res = await request(donationsApp()).get(`${PREFIX}/volunteering/donations`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="donate-method-card"');
    expect(res.text).toContain('id="donate-method-bank_transfer"');
    expect(res.text).toContain('id="donate-method-paypal"');
    expect(res.text).toContain('id="donate-method-cash"');
    expect(formToken(res.text)).not.toBe('');
  });

  it('sends a card gift to the hosted checkout with the same fields and this page’s absolute address', async () => {
    api.createDonationCheckout.mockResolvedValue({ data: { checkout_url: STRIPE, donation_id: 77 } });
    const agent = request.agent(donationsApp());
    const page = await agent.get(`${PREFIX}/volunteering/donations`).set('Host', HOST);
    const res = await agent.post(`${PREFIX}/volunteering/donations`).set('Host', HOST).type('form').send({
      form_token: formToken(page.text),
      amount: '25.50',
      giving_day_id: '4',
      payment_method: 'card',
      message: 'For the garden',
      is_anonymous: '1'
    });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(STRIPE);
    expect(api.createDonationCheckout).toHaveBeenCalledWith('test-token', {
      amount: 25.5,
      currency: 'EUR',
      giving_day_id: 4,
      message: 'For the garden',
      is_anonymous: true,
      return_url: `http://${HOST}${PREFIX}/volunteering/donations`
    });

    const again = await agent.post(`${PREFIX}/volunteering/donations`).set('Host', HOST).type('form')
      .send({ form_token: formToken(page.text), amount: '25.50', payment_method: 'card' });
    expect(again.headers.location).toBe(STRIPE);
    expect(api.createDonationCheckout).toHaveBeenCalledTimes(1);

    // Back from Stripe: pending is "confirming", completed is a thank-you with the amount.
    api.getDonationCheckoutStatus.mockResolvedValueOnce({ data: { donation_id: 77, status: 'pending' } });
    let back = await agent.get(`${PREFIX}/volunteering/donations?checkout=success&session_id=cs_test_123`);
    expect(api.getDonationCheckoutStatus).toHaveBeenCalledWith('test-token', 77);
    expect(decode(back.text)).toContain(t('govuk_alpha_settings.card_payment.confirming_title'));
    expect(back.text).toContain(`href="${PREFIX}/volunteering/donations?checkout=success"`);

    api.getDonationCheckoutStatus.mockResolvedValueOnce({ data: { donation_id: 77, status: 'completed' } });
    back = await agent.get(`${PREFIX}/volunteering/donations?checkout=success&session_id=cs_test_123`);
    const html = decode(back.text);
    expect(html).toContain(t('govuk_alpha_volunteering.donations.card_success_title'));
    expect(html).toContain(t('govuk_alpha_volunteering.donations.card_success_message', { amount: '25.50 EUR' }));
  });

  it('says a failed card gift was not completed', async () => {
    api.createDonationCheckout.mockResolvedValue({ data: { checkout_url: STRIPE, donation_id: 78 } });
    api.getDonationCheckoutStatus.mockResolvedValue({ data: { status: 'failed' } });
    const agent = request.agent(donationsApp());
    const page = await agent.get(`${PREFIX}/volunteering/donations`);
    await agent.post(`${PREFIX}/volunteering/donations`).type('form').send({ form_token: formToken(page.text), amount: '5', payment_method: 'card' });
    const back = await agent.get(`${PREFIX}/volunteering/donations?checkout=success&session_id=x`);
    expect(decode(back.text)).toContain(t('govuk_alpha_volunteering.donations.card_payment_failed'));
  });

  it('says a cancelled card gift was not charged, without asking the server', async () => {
    const res = await request(donationsApp()).get(`${PREFIX}/volunteering/donations?checkout=cancelled`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.card_payment.cancelled_body'));
    expect(api.getDonationCheckoutStatus).not.toHaveBeenCalled();
  });

  it('keeps pledges on the pledge endpoint', async () => {
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 5 } });
    await request(donationsApp()).post(`${PREFIX}/volunteering/donations`).type('form').send({ amount: '10', payment_method: 'cash' });
    expect(api.createDonationCheckout).not.toHaveBeenCalled();
  });

  it('shows the API refusal when a card payment cannot be started', async () => {
    api.createDonationCheckout.mockRejectedValue(new ApiError('down', 500, {}));
    const agent = request.agent(donationsApp());
    const page = await agent.get(`${PREFIX}/volunteering/donations`);
    const res = await agent.post(`${PREFIX}/volunteering/donations`).type('form').send({ form_token: formToken(page.text), amount: '5', payment_method: 'card' });
    expect(res.headers.location).toBe(`${PREFIX}/volunteering/donations?status=card-failed#donate`);
    const shown = await agent.get(`${PREFIX}/volunteering/donations?status=card-failed`);
    expect(decode(shown.text)).toContain(t('govuk_alpha_settings.card_payment.start_failed'));
  });

  it('sends a signed-out card donor to sign in', async () => {
    const res = await request(donationsApp({ signedIn: false })).post(`${PREFIX}/volunteering/donations`).type('form').send({ amount: '5', payment_method: 'card' });
    expect(res.headers.location).toBe(`${PREFIX}/login?status=auth-required`);
    expect(api.createDonationCheckout).not.toHaveBeenCalled();
  });
});

describe('club dues', () => {
  const owed = { id: 8, organization_name: 'Choir', membership_year: 2026, amount_cents: 5000, currency: 'CHF', status: 'overdue', due_date: '2026-03-01' };

  it('offers Pay now per owed row, and no longer says card payment is unavailable', async () => {
    api.getMyVereinDues.mockResolvedValue({ data: { items: [owed, { ...owed, id: 9, status: 'paid' }] } });
    const res = await request(duesApp()).get(`${PREFIX}/me/verein-dues`);
    expect(res.text).toContain(`action="${PREFIX}/me/verein-dues/8/pay"`);
    expect(res.text).not.toContain(`action="${PREFIX}/me/verein-dues/9/pay"`);
    expect(decode(res.text)).toContain(t('govuk_alpha_organisations.verein.dues.pay_now'));
    expect(res.text).toContain('data-prevent-double-click="true"');
    expect(res.text).not.toMatch(/not available on this site/);
  });

  it('opens the hosted payment page with a 303, sending this page’s absolute address and no amount', async () => {
    api.getMyVereinDues.mockResolvedValue({ data: { items: [owed] } });
    api.createVereinDuesCheckout.mockResolvedValue({ data: { checkout_url: STRIPE } });
    const agent = request.agent(duesApp());
    const page = await agent.get(`${PREFIX}/me/verein-dues`).set('Host', HOST);
    const res = await agent.post(`${PREFIX}/me/verein-dues/8/pay`).set('Host', HOST).type('form')
      .send({ form_token: formToken(page.text), amount_cents: '1' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(STRIPE);
    expect(api.createVereinDuesCheckout).toHaveBeenCalledWith('test-token', 8, `http://${HOST}${PREFIX}/me/verein-dues`);

    const again = await agent.post(`${PREFIX}/me/verein-dues/8/pay`).set('Host', HOST).type('form').send({ form_token: formToken(page.text) });
    expect(again.headers.location).toBe(STRIPE);
    expect(api.createVereinDuesCheckout).toHaveBeenCalledTimes(1);
  });

  it('handles already paid and payment in progress', async () => {
    api.getMyVereinDues.mockResolvedValue({ data: { items: [owed] } });
    const agent = request.agent(duesApp());
    let page = await agent.get(`${PREFIX}/me/verein-dues`);
    api.createVereinDuesCheckout.mockResolvedValueOnce({ data: { already_paid: true } });
    let res = await agent.post(`${PREFIX}/me/verein-dues/8/pay`).type('form').send({ form_token: formToken(page.text) });
    expect(res.headers.location).toBe(`${PREFIX}/me/verein-dues?checkout=success&dues=8`);

    page = await agent.get(`${PREFIX}/me/verein-dues`);
    api.createVereinDuesCheckout.mockRejectedValueOnce(new ApiError('busy', 409, { errors: [{ code: 'PAYMENT_IN_PROGRESS' }] }));
    res = await agent.post(`${PREFIX}/me/verein-dues/8/pay`).type('form').send({ form_token: formToken(page.text) });
    expect(res.headers.location).toBe(`${PREFIX}/me/verein-dues?status=payment-in-progress`);
    const shown = await agent.get(`${PREFIX}/me/verein-dues?status=payment-in-progress`);
    expect(decode(shown.text)).toContain(t('govuk_alpha_settings.card_payment.in_progress'));
  });

  it('on return, asks the server: paid, confirming, or cancelled', async () => {
    api.getMyVereinDues.mockResolvedValue({ data: { items: [owed] } });

    api.getVereinDuesCheckoutStatus.mockResolvedValueOnce({ data: { dues_id: 8, status: 'overdue' } });
    let res = await request(duesApp()).get(`${PREFIX}/me/verein-dues?checkout=success&dues=8&session_id=cs_1`);
    expect(api.getVereinDuesCheckoutStatus).toHaveBeenCalledWith('test-token', 8);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.card_payment.confirming_title'));
    expect(res.text).toContain(`href="${PREFIX}/me/verein-dues?checkout=success&amp;dues=8"`);

    api.getVereinDuesCheckoutStatus.mockResolvedValueOnce({ data: { dues_id: 8, status: 'paid' } });
    res = await request(duesApp()).get(`${PREFIX}/me/verein-dues?checkout=success&dues=8&session_id=cs_1`);
    expect(decode(res.text)).toContain(t('govuk_alpha_organisations.verein.dues.payment_success'));
    expect(res.text).not.toContain(`action="${PREFIX}/me/verein-dues/8/pay"`);

    api.getVereinDuesCheckoutStatus.mockClear();
    res = await request(duesApp()).get(`${PREFIX}/me/verein-dues?checkout=cancelled&dues=8`);
    expect(decode(res.text)).toContain(t('govuk_alpha_settings.card_payment.cancelled_body'));
    expect(api.getVereinDuesCheckoutStatus).not.toHaveBeenCalled();
  });
});

describe('member premium return address', () => {
  it('sends the absolute accessible address to checkout and portal, then 303s to Stripe', async () => {
    api.createMemberPremiumCheckout.mockResolvedValue({ data: { checkout_url: STRIPE } });
    api.createMemberPremiumPortal.mockResolvedValue({ data: { portal_url: 'https://billing.stripe.com/p/session/x' } });

    let res = await request(premiumApp()).post(`${PREFIX}/premium/subscribe`).set('Host', HOST).type('form').send({ tier_id: '7', interval: 'year' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(STRIPE);
    expect(api.createMemberPremiumCheckout).toHaveBeenCalledWith('test-token', {
      tier_id: 7,
      interval: 'yearly',
      return_url: `http://${HOST}${PREFIX}/premium/return?status=success`
    });

    res = await request(premiumApp()).post(`${PREFIX}/premium/portal`).set('Host', HOST).type('form').send({});
    expect(res.status).toBe(303);
    expect(api.createMemberPremiumPortal).toHaveBeenCalledWith('test-token', { return_url: `http://${HOST}${PREFIX}/premium/manage` });
  });

  it('treats Stripe’s cancel address as cancelled, not success', async () => {
    const res = await request(premiumApp()).get(`${PREFIX}/premium/return?status=success&cancelled=1`);
    expect(res.headers.location).toBe(`${PREFIX}/premium?status=checkout-cancelled`);
    expect(api.getMemberPremiumMe).not.toHaveBeenCalled();
  });

  it('shows success only once the server reports a plan; otherwise pending', async () => {
    api.getMemberPremiumMe.mockResolvedValueOnce({ data: { subscription: null, entitled_tier: null } });
    let res = await request(premiumApp()).get(`${PREFIX}/premium/return?status=success&session_id=cs_1`);
    expect(decode(res.text)).toContain(t('polish_commerce.premium_pending_title'));

    api.getMemberPremiumMe.mockResolvedValueOnce({ data: { entitled_tier: { tier_name: 'Champion' } } });
    res = await request(premiumApp()).get(`${PREFIX}/premium/return?status=success&session_id=cs_1`);
    expect(decode(res.text)).toContain(t('polish_commerce.premium_success_title'));
  });
});
