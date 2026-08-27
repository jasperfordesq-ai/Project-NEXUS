// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as ExpoLinking from 'expo-linking';
import { initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native';
import { APP_SCHEME } from '@/lib/constants';

type PaymentResult =
  | { status: 'completed' }
  | { status: 'canceled' }
  | { status: 'failed'; message?: string };

interface PresentMarketplacePaymentOptions {
  clientSecret: string;
  merchantDisplayName: string;
}

export async function presentMarketplacePayment({
  clientSecret,
  merchantDisplayName,
}: PresentMarketplacePaymentOptions): Promise<PaymentResult> {
  const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return { status: 'failed' };
  }

  const returnURL = ExpoLinking.createURL('marketplace-payment-return');
  await initStripe({
    publishableKey,
    urlScheme: APP_SCHEME,
  });

  const initResult = await initPaymentSheet({
    merchantDisplayName,
    paymentIntentClientSecret: clientSecret,
    returnURL,
  });

  if (initResult.error) {
    return { status: 'failed', message: initResult.error.message };
  }

  const paymentResult = await presentPaymentSheet();
  if (paymentResult.error) {
    return paymentResult.error.code === 'Canceled'
      ? { status: 'canceled' }
      : { status: 'failed', message: paymentResult.error.message };
  }

  return { status: 'completed' };
}
