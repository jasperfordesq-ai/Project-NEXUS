// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Urgent shift requests ("emergency alerts" on the server): an organiser's call for
 * someone to fill a shift at short notice, sent to volunteers whose skills match. The
 * member accepts or declines; accepting puts them on the shift and tells the organiser.
 * Mirrors the website's `EmergencyAlertsTab.tsx`.
 *
 * 🔴 The answer travels as `response`, not `action` — see the API module.
 */

import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useAppToast } from '@/components/ui/AppToast';
import { withRouteGate } from '@/components/withRouteGate';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  emergencyAlertItems,
  getEmergencyAlerts,
  respondToEmergencyAlert,
  volunteerSwitchOn,
  type EmergencyAlert,
} from '@/lib/api/volunteeringVolunteer';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

function priorityKey(priority: string): 'normal' | 'urgent' | 'critical' {
  return priority === 'urgent' || priority === 'critical' ? priority : 'normal';
}

function MyAlertsScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <MyAlertsContent />
    </ModalErrorBoundary>
  );
}

function MyAlertsContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_alerts');

  const alertsApi = useApi(() => getEmergencyAlerts(), [], { enabled: switchedOn });
  const alerts = emergencyAlertItems(alertsApi.data);
  const pendingCount = alerts.filter((alert) => alert.my_response === 'pending').length;

  const [busyId, setBusyId] = useState<number | null>(null);
  const pending = useRef(false);

  async function respond(alert: EmergencyAlert, response: 'accepted' | 'declined') {
    if (pending.current) return;
    pending.current = true;
    setBusyId(alert.id);
    try {
      await respondToEmergencyAlert(alert.id, response);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: t(response === 'accepted' ? 'volunteeringVolunteer:alerts.acceptedTitle' : 'volunteeringVolunteer:alerts.declinedTitle'),
        description: t(response === 'accepted' ? 'volunteeringVolunteer:alerts.acceptedBody' : 'volunteeringVolunteer:alerts.declinedBody'),
        variant: 'success',
      });
    } catch (err) {
      // An expired or filled request answers 400/404; the list is reloaded either way so
      // the member sees what the server now says rather than a stale button.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:alerts.respondError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setBusyId(null);
      alertsApi.refresh();
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('volunteeringVolunteer:alerts.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      {!switchedOn ? (
        <EmptyState
          icon="megaphone-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="alerts-switched-off"
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}
          refreshControl={(
            <RefreshControl refreshing={alertsApi.isLoading && alerts.length > 0} onRefresh={alertsApi.refresh} tintColor={primary} colors={[primary]} />
          )}
        >
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:alerts.intro')}</Text>
            {pendingCount > 0 ? (
              <Chip size="sm" variant="secondary" color="default" testID="alerts-pending-count">
                <Ionicons name="notifications-outline" size={12} color={theme.warning} />
                <Chip.Label>{t('volunteeringVolunteer:alerts.pendingCount', { count: pendingCount })}</Chip.Label>
              </Chip>
            ) : null}
          </View>

          <RefreshFailedNotice error={alertsApi.error} onRetry={alertsApi.refresh} isRetrying={alertsApi.isLoading} testID="alerts-error" />

          {alertsApi.isLoading && alerts.length === 0 && !alertsApi.error ? <ListSkeleton rows={3} testID="alerts-skeleton" /> : null}

          {!alertsApi.isLoading && !alertsApi.error && alerts.length === 0 ? (
            <EmptyState icon="megaphone-outline" title={t('volunteeringVolunteer:alerts.empty')} testID="alerts-empty" />
          ) : null}

          {alerts.map((alert) => {
            const priority = priorityKey(alert.priority);
            const tone = priority === 'critical' ? theme.error : priority === 'urgent' ? theme.warning : primary;
            const unanswered = alert.my_response === 'pending';
            const busy = busyId === alert.id;
            const date = formatDate(alert.shift?.start_time);
            const start = formatTime(alert.shift?.start_time);
            const end = formatTime(alert.shift?.end_time);
            return (
              <HeroCard key={alert.id} className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.3) }} testID={`alert-${alert.id}`}>
                <View className="h-1" style={{ backgroundColor: tone }} />
                <HeroCard.Body className="gap-3 p-4">
                  <View className={`${largeText ? '' : 'flex-row items-start justify-between'} gap-3`} style={largeText ? { flexDirection: 'column' } : undefined}>
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 2}>{alert.opportunity?.title}</Text>
                      <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={largeText ? 0 : 1}>
                        {[alert.organization?.name, alert.opportunity?.location].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default">
                      <Ionicons name="flash-outline" size={12} color={tone} />
                      <Chip.Label>{t(`volunteeringVolunteer:alerts.priority.${priority}`)}</Chip.Label>
                    </Chip>
                  </View>

                  <Text className="text-sm leading-5" style={{ color: theme.text }}>{alert.message}</Text>

                  <Text className="text-sm" style={{ color: theme.textSecondary }}>
                    {date ?? t('volunteeringVolunteer:common.dateUnknown')}
                    {start && end ? ` · ${t('volunteeringVolunteer:common.timeRange', { start, end })}` : ''}
                  </Text>

                  {alert.required_skills?.length ? (
                    <View className="gap-1">
                      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:alerts.skills')}</Text>
                      <View className="flex-row flex-wrap gap-2">
                        {alert.required_skills.map((skill) => (
                          <Chip key={skill} size={largeText ? 'md' : 'sm'} variant="secondary" color="default">
                            <Chip.Label>{skill}</Chip.Label>
                          </Chip>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {alert.coordinator?.name ? (
                    <Text className="text-xs" style={{ color: theme.textMuted }}>
                      {t('volunteeringVolunteer:alerts.from', { name: alert.coordinator.name })}
                    </Text>
                  ) : null}
                  {alert.expires_at ? (
                    <Text className="text-xs" style={{ color: theme.textMuted }}>
                      {t('volunteeringVolunteer:alerts.expires', { date: `${formatDate(alert.expires_at) ?? ''} ${formatTime(alert.expires_at) ?? ''}`.trim() })}
                    </Text>
                  ) : null}

                  {unanswered ? (
                    <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
                      <HeroButton
                        className={largeText ? 'w-full' : 'flex-1'}
                        size={largeText ? 'md' : 'sm'}
                        isDisabled={busyId !== null}
                        onPress={() => void respond(alert, 'accepted')}
                        testID={`alert-accept-${alert.id}`}
                        accessibilityLabel={t('volunteeringVolunteer:alerts.acceptLabel', { title: alert.opportunity?.title ?? '' })}
                        accessibilityState={{ busy }}
                      >
                        {busy ? <Spinner size="sm" /> : null}
                        <HeroButton.Label>{t('volunteeringVolunteer:alerts.accept')}</HeroButton.Label>
                      </HeroButton>
                      <HeroButton
                        className={largeText ? 'w-full' : 'flex-1'}
                        size={largeText ? 'md' : 'sm'}
                        variant="danger-soft"
                        isDisabled={busyId !== null}
                        onPress={() => void respond(alert, 'declined')}
                        testID={`alert-decline-${alert.id}`}
                        accessibilityLabel={t('volunteeringVolunteer:alerts.declineLabel', { title: alert.opportunity?.title ?? '' })}
                      >
                        <HeroButton.Label>{t('volunteeringVolunteer:alerts.decline')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                  ) : (
                    <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default" testID={`alert-answer-${alert.id}`}>
                      <Ionicons name={alert.my_response === 'accepted' ? 'checkmark-circle-outline' : 'close-circle-outline'} size={12} color={alert.my_response === 'accepted' ? theme.success : theme.textMuted} />
                      <Chip.Label>{t(alert.my_response === 'accepted' ? 'volunteeringVolunteer:alerts.accepted' : 'volunteeringVolunteer:alerts.declined')}</Chip.Label>
                    </Chip>
                  )}
                </HeroCard.Body>
              </HeroCard>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default withRouteGate(MyAlertsScreen, 'volunteering-my-alerts');
