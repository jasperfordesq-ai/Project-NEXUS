// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ComponentType } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import { useOptionalTenantCapabilities } from '@/lib/context/TenantContext';
import { useTheme } from '@/lib/hooks/useTheme';
import { isRouteAllowed, requirementForRoute } from '@/lib/navigation/routeRequirements';

/**
 * The screen shown instead of a module the community has switched off.
 *
 * Refuses rather than redirects: a member who followed a link deserves to know the
 * community does not offer this, not to be silently moved somewhere else. Back returns to
 * wherever they came from, or Home when there is nowhere to return to.
 */
export function RouteUnavailable({ testID = 'route-unavailable' }: { testID?: string }) {
  const { t } = useTranslation(['common']);
  const theme = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} testID={testID}>
      <AppTopBar
        title={t('common:featureUnavailable.title')}
        backLabel={t('common:buttons.back')}
        fallbackHref="/(tabs)/home"
      />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('common:featureUnavailable.title')}
          subtitle={t('common:featureUnavailable.subtitle')}
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * Wrap a route screen so it refuses to render when its module is switched off.
 *
 * 🔴 Why every screen's default export goes through this. The React app gates about 150
 * routes with `<FeatureGate>`; until 2026-09-07 the native app gated its MENUS and five
 * authoring screens, so a deep link, a push notification, a shared URL or a screen pushed
 * from elsewhere opened modules the community had switched off. Hiding a menu entry is
 * not a gate.
 *
 * Which switch a screen needs is NOT decided here — it is looked up by route name in
 * `lib/navigation/routeRequirements.ts`, the same table the tab bar and the deep-link
 * store read, so the three can never disagree. A route with no entry there renders
 * unchanged; `app/routeGating.test.ts` makes sure "no entry" is a recorded decision and
 * not an omission.
 *
 * 🔴 This is a CLIENT-side courtesy, not a security boundary. The API is what actually
 * refuses a module (and for `courses`/`podcasts` it currently does not — see
 * `components/FeatureGate.tsx`). Never rely on this wrapper for authorisation.
 *
 * Unknown configuration (cold start, offline with no cache, a test with no provider)
 * allows the screen — see `isRouteAllowed`.
 *
 * Usage, at the bottom of a route file:
 *
 *     function EventDetailScreen() { … }
 *     export default withRouteGate(EventDetailScreen, 'event-detail');
 */
export function withRouteGate<P extends object>(Screen: ComponentType<P>, routeName: string): ComponentType<P> {
  const requirement = requirementForRoute(routeName);
  if (!requirement) {
    // Nothing to gate. Return the screen itself so the component tree, and every
    // existing test that inspects it, is unchanged.
    return Screen;
  }

  function GatedRoute(props: P) {
    const capabilities = useOptionalTenantCapabilities();
    if (!isRouteAllowed(capabilities, routeName)) {
      return <RouteUnavailable />;
    }
    return <Screen {...props} />;
  }
  GatedRoute.displayName = `withRouteGate(${Screen.displayName ?? Screen.name ?? routeName})`;
  return GatedRoute;
}

export default withRouteGate;
