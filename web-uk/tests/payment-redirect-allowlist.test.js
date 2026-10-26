// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The accessible site redirects a member to a payment page the API returned. The
 * three card payments are always Stripe Checkout, so only an https address on
 * checkout.stripe.com is followed (26 Oct 2026).
 */

const { safeStripeCheckoutUrl, safeCheckoutUrl } = require('../src/lib/payment-form-token');

describe('payment page redirect allowlist', () => {
  it('follows a Stripe Checkout address', () => {
    const url = 'https://checkout.stripe.com/c/pay/cs_test_123#fid';
    expect(safeStripeCheckoutUrl(url)).toBe(url);
  });

  it.each([
    'https://evil.example/c/pay/cs_test_123',
    'https://checkout.stripe.com.evil.example/c/pay/x',
    'http://checkout.stripe.com/c/pay/x',
    'https://billing.stripe.com/p/session/x',
    '//checkout.stripe.com/c/pay/x',
    'javascript:alert(1)',
    '',
    null
  ])('refuses %p', (value) => {
    expect(safeStripeCheckoutUrl(value)).toBe('');
  });

  it('keeps the broader https rule for an identity provider page', () => {
    expect(safeCheckoutUrl('https://verify.stripe.com/start/abc')).toBe('https://verify.stripe.com/start/abc');
    expect(safeCheckoutUrl('http://verify.stripe.com/start/abc')).toBe('');
  });
});
