// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The five files in `lib/payments/` were the only entirely untested money path
 * in the client. They are small, which is exactly why they were skipped — and
 * also why a mistake in them is cheap to make and expensive to notice: every one
 * of the failure branches returns a *shaped result* rather than throwing, so a
 * broken payment looks to the caller like a payment the member declined.
 *
 * The platform-suffix split is the other reason to pin them. Metro resolves
 * `identityPayment.native.ts` on a device and `identityPayment.ts` on web, so
 * two files with the same export do completely different things — one opens
 * Stripe's payment sheet, the other bounces the member to the web app. A test
 * that imports "the module" tests only whichever one the bundler picked, so each
 * is imported here by its explicit path.
 *
 * Distinguishing `canceled` from `failed` is the behaviour that matters most: a
 * member who backs out of a payment must not be shown an error, and a payment
 * that genuinely failed must not be silently treated as a change of mind.
 */

const mockInitStripe = jest.fn();
const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();
const mockCreateURL = jest.fn();
const mockOpenURL = jest.fn();

jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: (...args: unknown[]) => mockInitStripe(...args),
  initPaymentSheet: (...args: unknown[]) => mockInitPaymentSheet(...args),
  presentPaymentSheet: (...args: unknown[]) => mockPresentPaymentSheet(...args),
}));

jest.mock('expo-linking', () => ({
  createURL: (...args: unknown[]) => mockCreateURL(...args),
}));

jest.mock('react-native', () => ({
  Linking: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));

jest.mock('@/lib/constants', () => ({
  APP_URL: 'https://app.example.test',
}));

import { presentIdentityPayment as presentIdentityNative } from './identityPayment.native';
import { presentIdentityPayment as presentIdentityWeb } from './identityPayment.web';
import { presentMarketplacePayment as presentMarketplaceNative } from './marketplacePayment.native';

/**
 * 🔴 The non-suffixed files must be required with an EXPLICIT `.ts` extension.
 *
 * `import ... from './identityPayment'` does NOT load `identityPayment.ts` under
 * Jest — the jest-expo preset resolves platform extensions and prefers
 * `identityPayment.native.ts`. Writing the bare specifier silently tested the
 * native module twice and reported the two non-suffixed files as 0% covered,
 * which is how this was noticed. An explicit extension bypasses the platform
 * preference and loads the file actually named.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const identityDefault = require('./identityPayment.ts') as typeof import('./identityPayment');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const marketplaceDefault = require('./marketplacePayment.ts') as typeof import('./marketplacePayment');

const identityOptions = {
  clientSecret: 'pi_secret_123',
  publishableKey: 'pk_test_123',
  merchantDisplayName: 'hOUR Timebank',
};

describe('identity verification payment on a device', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateURL.mockReturnValue('nexus://stripe-redirect');
    mockInitStripe.mockResolvedValue(undefined);
    mockInitPaymentSheet.mockResolvedValue({});
    mockPresentPaymentSheet.mockResolvedValue({});
  });

  it('refuses to open a payment sheet with no publishable key', async () => {
    // Calling initStripe with an undefined key throws inside the native module.
    // Returning `failed` first keeps that out of a crash report.
    await expect(
      presentIdentityNative({ ...identityOptions, publishableKey: undefined })
    ).resolves.toEqual({ status: 'failed' });

    expect(mockInitStripe).not.toHaveBeenCalled();
  });

  it('configures Stripe with a deep link back into the app', async () => {
    // Without a urlScheme, a bank's 3-D Secure page has no way to return the
    // member to the app and the payment appears to hang.
    await presentIdentityNative(identityOptions);

    expect(mockCreateURL).toHaveBeenCalledWith('stripe-redirect');
    expect(mockInitStripe).toHaveBeenCalledWith({
      publishableKey: 'pk_test_123',
      urlScheme: 'nexus://stripe-redirect',
    });
    expect(mockInitPaymentSheet).toHaveBeenCalledWith({
      merchantDisplayName: 'hOUR Timebank',
      paymentIntentClientSecret: 'pi_secret_123',
      returnURL: 'nexus://stripe-redirect',
    });
  });

  it('reports completion when the sheet closes cleanly', async () => {
    await expect(presentIdentityNative(identityOptions)).resolves.toEqual({ status: 'completed' });
  });

  it('surfaces the reason when the sheet cannot be prepared', async () => {
    mockInitPaymentSheet.mockResolvedValue({ error: { message: 'Invalid client secret' } });

    await expect(presentIdentityNative(identityOptions)).resolves.toEqual({
      status: 'failed',
      message: 'Invalid client secret',
    });
    expect(mockPresentPaymentSheet).not.toHaveBeenCalled();
  });

  it('treats a member backing out as canceled, not as an error', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled', message: 'cancelled' } });

    await expect(presentIdentityNative(identityOptions)).resolves.toEqual({ status: 'canceled' });
  });

  it('treats a declined card as failed, and keeps the reason', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Failed', message: 'Card declined' } });

    await expect(presentIdentityNative(identityOptions)).resolves.toEqual({
      status: 'failed',
      message: 'Card declined',
    });
  });
});

describe('identity verification payment on web', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenURL.mockResolvedValue(undefined);
  });

  it('redirects to the web app instead of opening a native sheet', async () => {
    await expect(presentIdentityWeb(identityOptions)).resolves.toEqual({ status: 'redirected' });

    expect(mockOpenURL).toHaveBeenCalledWith('https://app.example.test/settings/verify-identity');
    expect(mockInitStripe).not.toHaveBeenCalled();
  });

  it('behaves identically through the default (non-suffixed) entry point', async () => {
    // Metro picks this file when no platform-specific variant matches. If the two
    // ever diverge, a member on one platform gets a different journey.
    await expect(identityDefault.presentIdentityPayment(identityOptions)).resolves.toEqual({
      status: 'redirected',
    });

    expect(mockOpenURL).toHaveBeenCalledWith('https://app.example.test/settings/verify-identity');
    expect(mockInitStripe).not.toHaveBeenCalled();
  });
});

describe('marketplace payment on a device', () => {
  const marketplaceOptions = { clientSecret: 'pi_secret_456', merchantDisplayName: 'hOUR Timebank' };
  const originalKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateURL.mockReturnValue('nexus://marketplace-payment-return');
    mockInitStripe.mockResolvedValue(undefined);
    mockInitPaymentSheet.mockResolvedValue({});
    mockPresentPaymentSheet.mockResolvedValue({});
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_marketplace';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalKey;
  });

  it('reads its publishable key from the environment, not from the caller', async () => {
    // 🔴 Unlike the identity flow, this key is NOT a parameter. A build shipped
    // without EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY fails every marketplace payment
    // with no message, and nothing at the call site can supply it.
    await presentMarketplaceNative(marketplaceOptions);

    expect(mockInitStripe).toHaveBeenCalledWith({
      publishableKey: 'pk_test_marketplace',
      urlScheme: 'nexus://marketplace-payment-return',
    });
  });

  it('fails closed when the build has no publishable key', async () => {
    delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    await expect(presentMarketplaceNative(marketplaceOptions)).resolves.toEqual({ status: 'failed' });
    expect(mockInitStripe).not.toHaveBeenCalled();
  });

  it('uses its own return path, distinct from the identity flow', async () => {
    await presentMarketplaceNative(marketplaceOptions);

    expect(mockCreateURL).toHaveBeenCalledWith('marketplace-payment-return');
  });

  it('reports completion when the sheet closes cleanly', async () => {
    await expect(presentMarketplaceNative(marketplaceOptions)).resolves.toEqual({ status: 'completed' });
  });

  it('surfaces the reason when the sheet cannot be prepared', async () => {
    mockInitPaymentSheet.mockResolvedValue({ error: { message: 'Amount too small' } });

    await expect(presentMarketplaceNative(marketplaceOptions)).resolves.toEqual({
      status: 'failed',
      message: 'Amount too small',
    });
  });

  it('treats a member backing out as canceled', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled' } });

    await expect(presentMarketplaceNative(marketplaceOptions)).resolves.toEqual({ status: 'canceled' });
  });

  it('treats any other sheet error as failed', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Timeout', message: 'timed out' } });

    await expect(presentMarketplaceNative(marketplaceOptions)).resolves.toEqual({
      status: 'failed',
      message: 'timed out',
    });
  });

  it('redirects to the orders page through the non-native entry point', async () => {
    mockOpenURL.mockResolvedValue(undefined);

    await expect(
      marketplaceDefault.presentMarketplacePayment(marketplaceOptions)
    ).resolves.toEqual({ status: 'redirected' });
    expect(mockOpenURL).toHaveBeenCalledWith('https://app.example.test/marketplace/orders');
  });
});
