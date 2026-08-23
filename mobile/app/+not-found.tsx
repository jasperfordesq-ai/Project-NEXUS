// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The fallback for a link this app cannot open.
 *
 * 🔴 Why it exists. `app.json` registers an autoVerify intent filter for ALL of
 * `https://app.project-nexus.ie/*`, so Android hands this app every URL on the
 * platform — including staff consoles and pages that only exist on the web. Until
 * this file was added there was no `+not-found` route, so anything the mapper in
 * `+native-intent.ts` declined fell through to Expo Router's own "Unmatched Route"
 * screen: a developer diagnostic, in English, with no way onward. A signed-in member
 * was simply left sitting on it, because `decideAuthRedirect` treats an unmatched
 * path as "a real route — preserve it".
 *
 * The important part is not the apology, it is the two exits: open what they actually
 * asked for in a browser, or get back into the app. Never a dead end.
 *
 * 🔴 Do not wrap this content in `flex-1 items-center justify-center`. Two earlier
 * versions did, and on a device the icon, title and subtitle rendered at zero size —
 * the view hierarchy showed nothing whatsoever between the top bar and the buttons,
 * which still rendered because they sit in their own child View. The layout here
 * (padding + an inner `items-center` group, with font size and weight given as inline
 * styles) renders correctly, verified on the emulator.
 *
 * 🔴 ISOLATED 2026-08-20, and it was the centring container — for a reason worth knowing,
 * because it affects a whole class of screens. `className` does NOTHING on this
 * SafeAreaView: it comes from `react-native-safe-area-context`, and uniwind only patches
 * className onto React Native's own components. So `className="flex-1"` on the
 * SafeAreaView never applied, the parent sized to its content, and any child sized with
 * `flex-1` — including `flex-1 items-center justify-center` — collapsed to zero height.
 * The same cause left the rewards/leaderboard and Goals screens completely blank. See
 * `components/safeAreaFlex.test.ts` and section 9.1 of docs/PRODUCTION_READINESS.md.
 *
 * The earlier note here was honest that three things changed at once and the culprit was
 * not isolated. It is now, so the layout below is safe on purpose rather than by luck:
 * padding plus an intrinsic-height group needs nothing from its parent.
 * `EmptyState` is NOT at fault: it renders correctly elsewhere (the Polls screen shows
 * icon, title and subtitle), and an early note in this file blaming it was wrong.
 */

import { useCallback } from 'react';
import { Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useTheme } from '@/lib/hooks/useTheme';

const WEB_ORIGIN = 'https://app.project-nexus.ie';

export default function NotFoundRoute() {
  return (
    <ModalErrorBoundary>
      <NotFoundScreen />
    </ModalErrorBoundary>
  );
}

function NotFoundScreen() {
  const { t } = useTranslation(['common']);
  const theme = useTheme();
  const pathname = usePathname();

  const openInBrowser = useCallback(() => {
    // The unmatched pathname IS the web path — that is exactly why Expo Router could
    // not match it — so it can be handed straight back to the browser, which gets the
    // member the real page instead of a generic home screen. Guarded because
    // Linking.openURL REJECTS on a device with no browser, and an unhandled rejection
    // here would take out the one screen offering a way forward.
    const suffix = pathname?.startsWith('/') ? pathname : `/${pathname ?? ''}`;
    void Linking.openURL(`${WEB_ORIGIN}${suffix}`).catch(() => undefined);
  }, [pathname]);

  const goHome = useCallback(() => {
    // replace(), not push(): the dead link must not stay in the back stack, or Back
    // returns the member to this same screen.
    router.replace('/(tabs)/home' as Href);
  }, []);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: theme.bg }}>
      {/* A SHORT title here, not the full sentence below: using one string for both
          made the member read the identical sentence twice. */}
      <AppTopBar
        title={t('common:notFound.shortTitle')}
        backLabel={t('common:buttons.back')}
        fallbackHref={'/(tabs)/home' as Href}
      />

      <View className="px-8 pt-16">
        <View className="items-center gap-4">
          <Ionicons name="compass-outline" size={48} color={theme.textMuted} />

          <Text
            style={{ color: theme.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }}
          >
            {t('common:notFound.title')}
          </Text>

          <Text
            style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }}
          >
            {t('common:notFound.subtitle')}
          </Text>
        </View>

        <View className="mt-8 w-full gap-3">
          <HeroButton onPress={openInBrowser} accessibilityLabel={t('common:notFound.openInBrowser')}>
            <HeroButton.Label>{t('common:notFound.openInBrowser')}</HeroButton.Label>
          </HeroButton>
          <HeroButton variant="secondary" onPress={goHome} accessibilityLabel={t('common:notFound.goHome')}>
            <HeroButton.Label>{t('common:notFound.goHome')}</HeroButton.Label>
          </HeroButton>
        </View>
      </View>
    </SafeAreaView>
  );
}
