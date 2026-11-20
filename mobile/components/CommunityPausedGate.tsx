// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Replaces the app with a "this community is paused" screen while the selected
 * community is paused for non-payment.
 *
 * Two signals, either is enough: the tenant bootstrap's `billing_paused: true`, and a
 * `403 COMMUNITY_PAUSED` refusal recorded by `lib/api/client.ts` in
 * `communityPausedStore` (the bootstrap the app holds may be a cached copy from before
 * the pause). The website's equivalent is `react-frontend/src/pages/public/CommunityPausedPage.tsx`,
 * and the wording matches it.
 *
 * 🔴 It never says why. Members are not told the pause is about money; the reason is for
 * the community's admins, in the website's admin panel.
 *
 * 🔴 It REPLACES the app rather than overlaying it, like `UpdateRequiredGate`: an overlay
 * leaves screens mounted underneath, still polling and collecting refusals. The screen
 * itself makes no requests, so nothing here can loop. It never signs anyone out on its
 * own; the sign-out button is the member's choice.
 *
 * The one way through is the community picker, so a member who belongs to another
 * community can move. The picker loads its list anonymously, so it works while the
 * paused community refuses everything else.
 */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';

import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import { communityPausedStore } from '@/lib/billing/communityPausedStore';
import { useAuthContext } from '@/lib/context/AuthContext';
import { useTenantContext } from '@/lib/context/TenantContext';
import { isTenantSelectionPath } from '@/lib/navigation/authRedirect';
import { TENANT_PICKER_HREF } from '@/lib/navigation/tenantMismatch';
import { releaseSplash } from '@/lib/ui/splash';

export default function CommunityPausedGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(['common']);
  const { isAuthenticated, logout } = useAuthContext();
  const { tenant, tenantSlug } = useTenantContext();
  const pathname = usePathname();
  const pausedSlug = useSyncExternalStore(
    communityPausedStore.subscribe,
    communityPausedStore.getSnapshot,
    communityPausedStore.getSnapshot,
  );
  const [openingPicker, setOpeningPicker] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /*
    A fresh bootstrap that no longer says paused means the community was restored, so a
    pause learned from an earlier refusal is forgotten. Only a CHANGE of bootstrap counts:
    the one present at mount may be a cached copy from before the pause, and clearing on it
    would hide a pause the server has just reported.
  */
  const previousTenant = useRef(tenant);
  useEffect(() => {
    if (previousTenant.current === tenant) return;
    previousTenant.current = tenant;
    if (tenant && tenant.billing_paused !== true) {
      communityPausedStore.clear(tenant.slug);
    }
  }, [tenant]);

  const onPicker = isTenantSelectionPath(pathname);
  const isPaused =
    (tenant?.slug === tenantSlug && tenant?.billing_paused === true) || pausedSlug === tenantSlug;
  const showScreen = isPaused && !onPicker && !openingPicker;

  // The navigator is mounted again for the picker; navigate once it is there.
  useEffect(() => {
    if (!openingPicker) return;
    if (onPicker) {
      setOpeningPicker(false);
      return;
    }
    router.replace(TENANT_PICKER_HREF as Parameters<typeof router.replace>[0]);
  }, [openingPicker, onPicker]);

  // The root navigator normally releases the splash once a screen is up; it is not
  // mounted while this screen is shown.
  useEffect(() => {
    if (showScreen) void releaseSplash();
  }, [showScreen]);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }, [logout, signingOut]);

  const handleChooseCommunity = useCallback(() => setOpeningPicker(true), []);

  if (!showScreen) return <>{children}</>;

  const name = tenant?.slug === tenantSlug ? tenant?.name?.trim() : '';
  const title = name
    ? t('common:communityPaused.title', { community: name })
    : t('common:communityPaused.titleUnnamed');

  return (
    <View className="flex-1 items-center justify-center bg-background" testID="community-paused-screen">
      <EmptyState icon="pause-circle-outline" title={title} subtitle={t('common:communityPaused.body')} />
      <View className="w-full items-center gap-3 px-8">
        {isAuthenticated ? (
          <Button
            fullWidth
            onPress={() => void handleSignOut()}
            isLoading={signingOut}
            disabled={signingOut}
            testID="community-paused-sign-out"
            accessibilityLabel={t('common:communityPaused.signOut')}
          >
            {t('common:communityPaused.signOut')}
          </Button>
        ) : null}
        <Button
          variant={isAuthenticated ? 'ghost' : 'solid'}
          fullWidth
          onPress={handleChooseCommunity}
          disabled={signingOut}
          testID="community-paused-choose-community"
          accessibilityLabel={t('common:communityPaused.chooseAnother')}
        >
          {t('common:communityPaused.chooseAnother')}
        </Button>
      </View>
    </View>
  );
}
