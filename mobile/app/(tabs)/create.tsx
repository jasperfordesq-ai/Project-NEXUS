// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { router, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import LoadingSpinner from '@/components/ui/LoadingSpinner';

/**
 * The Create tab is a doorway, not a screen: tapping it opens the quick-create chooser.
 *
 * 🔴 It used to `return null` while the redirect fired. That renders literally nothing — a
 * blank white rectangle with no top bar — so if the redirect were ever slow or failed to run,
 * the tab would look like the app had broken. Every comparable redirect shim in this codebase
 * (`marketplace-promotions`, `marketplace-saved-searches`, and five others) draws a spinner on
 * the app's own background instead; this one was the outlier.
 *
 * Nothing measured it as broken. It is a "cannot be seen to be working" defect rather than a
 * reproducible fault, which is the same class as the invisible-icon and blank-More-screen
 * findings from the visual audit — cheap to make honest, so it is made honest.
 */
export default function CreateTabFallback() {
  useEffect(() => {
    router.replace('/(modals)/quick-create' as Href);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <LoadingSpinner />
    </SafeAreaView>
  );
}
