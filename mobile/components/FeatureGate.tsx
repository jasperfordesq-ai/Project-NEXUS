// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

/**
 * Refuse a screen whose module the community has switched off.
 *
 * 🔴 Why this exists. The React app wraps every module route in
 * `<FeatureGate feature="courses" redirect="/">`; the native app had no equivalent,
 * and gated only the MENUS. Hiding a menu entry is not a gate — a deep link, a
 * notification, a shared URL or a screen pushed from elsewhere all bypass it. Until
 * 2026-09-06 that was invisible because the two newest module screens (the course
 * builder and the podcast studio) could only be reached from the "+" menu; the moment
 * `+native-intent.ts` learned to route `/courses/instructor` and `/podcasts/studio`,
 * an external link could open a builder for a module the community does not have.
 *
 * 🔴 This is a CLIENT-side courtesy, not a security boundary, and it must not be
 * mistaken for one. `courses` and `podcasts` default to `false`
 * (`TenantFeatureConfig::FEATURE_DEFAULTS`) yet neither `CourseController` nor
 * `PodcastController` — nor their routes — actually enforces the flag, despite both
 * files' own doc comments claiming they are "gated by the per-tenant feature flag".
 * The real fix is `->middleware('feature:courses')` on those route blocks, which is a
 * production authorisation change and is recorded for the owner rather than made here.
 *
 * Shows the module as unavailable rather than redirecting: a member who followed a
 * link deserves to know the community does not offer this, not to be silently moved
 * somewhere else.
 */
interface FeatureGateProps {
  /** Tenant feature flag, e.g. `courses`. Checked with `hasFeature`. */
  feature?: string;
  /** Tenant module flag, e.g. `feed`. Checked with `hasModule`. */
  module?: string;
  /** Title for the top bar while refusing, so the screen is not a blank rectangle. */
  title: string;
  /** Where Back goes when there is nothing to go back to. */
  fallbackHref: string;
  children: ReactNode;
}

export default function FeatureGate({ feature, module, title, fallbackHref, children }: FeatureGateProps) {
  const { t } = useTranslation(['common']);
  const { hasFeature, hasModule } = useTenant();
  const theme = useTheme();

  const allowed = (!feature || hasFeature(feature)) && (!module || hasModule(module));
  if (allowed) return <>{children}</>;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('common:buttons.back')} fallbackHref={fallbackHref as never} />
      <View className="flex-1 justify-center">
        <EmptyState
          icon="lock-closed-outline"
          title={t('common:featureUnavailable.title')}
          subtitle={t('common:featureUnavailable.subtitle')}
        />
      </View>
    </SafeAreaView>
  );
}
