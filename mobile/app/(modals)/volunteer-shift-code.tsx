// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's OWN check-in code for a shift they hold: a QR of the check-in URL (what
 * the website's `ShiftCheckinPanel` encodes) plus the code as text, so an organiser can
 * scan it or type it. `volunteer-checkin.tsx` is the other half — the organiser's
 * verify screen a scanned link opens — and is untouched.
 *
 * The status line is the server's word, not the app's: the organiser's scan changes it,
 * so a Refresh button re-reads it rather than guessing.
 */

import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { withRouteGate } from '@/components/withRouteGate';
import { isRefusalStatus } from '@/lib/api/refusal';
import { getShiftCheckIn, volunteerSwitchOn, type ShiftCheckInStatus } from '@/lib/api/volunteeringVolunteer';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;

function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function statusKey(status: ShiftCheckInStatus): 'pending' | 'checked_in' | 'checked_out' | 'no_show' {
  return status === 'checked_in' || status === 'checked_out' || status === 'no_show' ? status : 'pending';
}

function ShiftCodeScreen() {
  const { id = '', title = '' } = useLocalSearchParams<{ id?: string; title?: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${id}`}>
      <ShiftCodeContent shiftId={Number(id)} title={typeof title === 'string' ? title : ''} />
    </ModalErrorBoundary>
  );
}

function ShiftCodeContent({ shiftId, title }: { shiftId: number; title: string }) {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'enable_qr_checkin');
  const validId = Number.isFinite(shiftId) && shiftId > 0;

  const codeApi = useApi(() => getShiftCheckIn(shiftId), [shiftId], { enabled: switchedOn && validId });
  const checkIn = codeApi.data?.data ?? null;
  const refused = !validId || (codeApi.errorStatus !== null && isRefusalStatus(codeApi.errorStatus));
  const key = checkIn ? statusKey(checkIn.status) : 'pending';
  const tone = key === 'checked_in' ? theme.success : key === 'checked_out' ? primary : key === 'no_show' ? theme.error : theme.warning;

  if (!switchedOn) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('volunteeringVolunteer:code.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
        <EmptyState
          icon="qr-code-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:code.switchedOff')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="shift-code-switched-off"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('volunteeringVolunteer:code.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}
        refreshControl={(
          <RefreshControl refreshing={codeApi.isLoading && checkIn !== null} onRefresh={codeApi.refresh} tintColor={primary} colors={[primary]} />
        )}
      >
        {title ? (
          <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 2}>{title}</Text>
        ) : null}
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {t('volunteeringVolunteer:code.intro')}
        </Text>

        {refused ? (
          <EmptyState
            icon="qr-code-outline"
            title={t('volunteeringVolunteer:code.notYours')}
            actionLabel={t('volunteeringVolunteer:unavailable.back')}
            onAction={() => router.push(VOLUNTEERING_HUB)}
            testID="shift-code-refused"
          />
        ) : codeApi.error && !checkIn ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="items-center gap-3 p-6">
              <Ionicons name="warning-outline" size={28} color={theme.error} />
              <Text className="text-center text-sm" style={{ color: theme.textSecondary }} accessibilityRole="alert">
                {codeApi.error}
              </Text>
              <HeroButton variant="secondary" onPress={codeApi.refresh} testID="shift-code-retry">
                <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : !checkIn ? (
          <ListSkeleton rows={2} testID="shift-code-skeleton" />
        ) : (
          <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.3) }}>
            <View className="h-1" style={{ backgroundColor: tone }} />
            <HeroCard.Body className="items-center gap-4 p-5">
              <View
                className="rounded-panel-inner bg-white p-3"
                accessible
                accessibilityLabel={t('volunteeringVolunteer:code.qrLabel')}
                testID="shift-code-qr-frame"
              >
                <QRCode value={checkIn.qr_url} size={220} color="#000000" backgroundColor="#ffffff" ecl="M" />
              </View>

              <View className="w-full items-center gap-1">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('volunteeringVolunteer:code.codeHeading')}
                </Text>
                <Text selectable className="text-center font-mono text-sm" style={{ color: theme.text }} testID="shift-code-token">
                  {checkIn.qr_token}
                </Text>
              </View>

              <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default" testID="shift-code-status">
                <Ionicons name={key === 'checked_in' ? 'checkmark-circle-outline' : key === 'checked_out' ? 'log-out-outline' : 'time-outline'} size={12} color={tone} />
                <Chip.Label>{t(`volunteeringVolunteer:code.status.${key}`)}</Chip.Label>
              </Chip>

              {checkIn.checked_in_at ? (
                <Text className="text-xs" style={{ color: theme.textMuted }}>
                  {t('volunteeringVolunteer:code.checkedInAt', { time: formatDateTime(checkIn.checked_in_at) ?? '' })}
                </Text>
              ) : null}
              {checkIn.checked_out_at ? (
                <Text className="text-xs" style={{ color: theme.textMuted }}>
                  {t('volunteeringVolunteer:code.checkedOutAt', { time: formatDateTime(checkIn.checked_out_at) ?? '' })}
                </Text>
              ) : null}

              <HeroButton variant="secondary" size={largeText ? 'md' : 'sm'} isDisabled={codeApi.isLoading} onPress={codeApi.refresh} testID="shift-code-refresh">
                <Ionicons name="refresh-outline" size={16} color={primary} />
                <HeroButton.Label>{t('volunteeringVolunteer:code.refresh')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default withRouteGate(ShiftCodeScreen, 'volunteer-shift-code');
