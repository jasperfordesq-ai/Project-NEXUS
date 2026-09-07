// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { useTheme } from '@/lib/hooks/useTheme';

/**
 * Where the bank sends the member back after a 3-D Secure check.
 *
 * 🔴 Why this exists. `lib/payments/marketplacePayment.native.ts` hands Stripe
 * `nexus://marketplace-payment-return` as the return URL. Expo Router matched no screen at
 * that path, so the OS re-opening the app mid-payment pushed `+not-found` — "This page
 * doesn't exist", with a button offering to open the same path on the website — on top of
 * the listing while the payment sheet was still finishing (audit 2026-09-07, D/F-7).
 *
 * The payment itself is handled entirely by the Stripe SDK, which is listening for this
 * URL; there is nothing for this screen to do except exist, look like the app is working,
 * and get out of the way. It goes back to whatever the member was on — the listing or the
 * orders list — which is where the sheet's own result is reported.
 */
export default function MarketplacePaymentReturnScreen() {
  const theme = useTheme();

  useEffect(() => {
    // A tick, so the navigator has this screen mounted before it is popped; `canGoBack`
    // because a cold start on this URL has nothing behind it.
    const timer = setTimeout(() => {
      if (router.canGoBack()) router.back();
      else router.replace('/(modals)/marketplace-orders');
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} testID="marketplace-payment-return">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner />
      </View>
    </SafeAreaView>
  );
}
