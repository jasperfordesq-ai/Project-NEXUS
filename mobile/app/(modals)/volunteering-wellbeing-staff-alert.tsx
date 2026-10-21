// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Where a staff member lands from a wellbeing alert push (deep audit 21 Oct 2026,
 * finding 4).
 *
 * The server sends community staff a push whose link is a website staff page —
 * `/admin/volunteering/wellbeing?alert=N` for admins, `/broker/safeguarding/volunteering
 * ?alert=N` for brokers and coordinators. The member app is not a staff tool, so there is
 * no native alert page and there will not be one here. Before this screen the tap fell
 * back to the notification list (or, from the in-app list, did nothing), so a staff
 * member was never told where the alert actually is.
 *
 * This says it plainly and offers ONE way on: the same page on the community's website.
 * The address is built by the app from a constant path and a digits-only id
 * (`buildWebUrl`), never from the link itself.
 *
 * 🔴 Not verified on a device: `app.json` claims every `https://app.project-nexus.ie/*`
 * URL for this app, so Android may hand the page straight back to the app instead of a
 * browser. `+not-found`'s "Open in browser" has the same exposure. If that happens, the
 * App Link lands on `+not-found` (staff pages stay browser-only for App Links), not here.
 */

import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import AccentIcon from '@/components/ui/AccentIcon';
import AppTopBar from '@/components/ui/AppTopBar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { withRouteGate } from '@/components/withRouteGate';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { openExternalUrl } from '@/lib/utils/openExternalUrl';
import { buildWebUrl } from '@/lib/utils/webUrl';

const NOTIFICATIONS = '/(modals)/notifications' as Href;
const ALERT_ID = /^[1-9][0-9]{0,18}$/;
const STAFF_PAGES = {
  admin: '/admin/volunteering/wellbeing',
  broker: '/broker/safeguarding/volunteering',
} as const;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The website path for this alert. Only the two known pages and a numeric id can appear. */
function staffAlertWebPath(area: string | undefined, alert: string | undefined): string {
  const page = area === 'broker' ? STAFF_PAGES.broker : STAFF_PAGES.admin;
  return alert && ALERT_ID.test(alert) ? `${page}?alert=${alert}` : page;
}

function WellbeingStaffAlertContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const params = useLocalSearchParams<{ area?: string | string[]; alert?: string | string[] }>();
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();

  const webUrl = buildWebUrl(tenant?.slug, staffAlertWebPath(firstParam(params.area), firstParam(params.alert)));

  const openOnWebsite = useCallback(async () => {
    const outcome = await openExternalUrl(webUrl);
    if (outcome !== 'opened') {
      showToast({
        title: t('common:errors.alertTitle'),
        description: t('volunteeringVolunteer:staffAlert.openFailed'),
        variant: 'warning',
      });
    }
  }, [showToast, t, webUrl]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('volunteeringVolunteer:staffAlert.title')} backLabel={t('common:back')} fallbackHref={NOTIFICATIONS} />
      {/* Padding plus an intrinsic-height group: see +not-found.tsx for why this screen
          does not centre with flex-1 inside a safe-area-context SafeAreaView. */}
      <View className="px-8 pt-16">
        <View className="items-center gap-4">
          <Ionicons name="heart-circle-outline" size={48} color={primary} />
          <Text
            accessibilityRole="header"
            style={{ color: theme.text, fontSize: 18, fontWeight: '600', textAlign: 'center' }}
          >
            {t('volunteeringVolunteer:staffAlert.heading')}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
            {t('volunteeringVolunteer:staffAlert.body')}
          </Text>
        </View>
        <View className="mt-8 w-full gap-3">
          <HeroButton
            onPress={() => { void openOnWebsite(); }}
            accessibilityRole="link"
            accessibilityLabel={t('volunteeringVolunteer:staffAlert.open')}
            testID="wellbeing-staff-alert-open"
          >
            <AccentIcon name="open-outline" size={16} />
            <HeroButton.Label>{t('volunteeringVolunteer:staffAlert.open')}</HeroButton.Label>
          </HeroButton>
        </View>
      </View>
    </SafeAreaView>
  );
}

function WellbeingStaffAlertScreen() {
  return (
    <ModalErrorBoundary>
      <WellbeingStaffAlertContent />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(WellbeingStaffAlertScreen, 'volunteering-wellbeing-staff-alert');
