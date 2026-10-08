// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's waiting lists — every full shift they are queued for, their position, and
 * the "claim" action once the server has told them a place is free.
 *
 * Joining happens on the opportunity (volunteering-detail.tsx), where the shift is; this
 * screen is where the member comes back to see where they stand. Mirrors the website's
 * `WaitlistTab.tsx` — same endpoints, same 48-hour claim window wording.
 */

import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { withRouteGate } from '@/components/withRouteGate';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  claimWaitlistPlace,
  getMyWaitlists,
  leaveWaitlist,
  volunteerSwitchOn,
  type WaitlistEntry,
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

function MyWaitlistsScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <MyWaitlistsContent />
    </ModalErrorBoundary>
  );
}

function MyWaitlistsContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'volunteering', 'common']);
  const { tenant } = useTenant();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_waitlist');

  const listApi = useApi(() => getMyWaitlists(), [], { enabled: switchedOn });
  const entries: WaitlistEntry[] = Array.isArray(listApi.data?.data) ? listApi.data.data : [];

  const [busyId, setBusyId] = useState<number | null>(null);
  const pending = useRef(false);

  async function claim(entry: WaitlistEntry) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(entry.id);
    try {
      await claimWaitlistPlace(entry.shift.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:waitlist.claimedTitle'), description: t('volunteeringVolunteer:waitlist.claimedBody'), variant: 'success' });
    } catch (err) {
      // The place may have gone to the next person while this was in flight, so the list
      // is reloaded either way — the server's answer is what the member should see.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:waitlist.claimError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setBusyId(null);
      listApi.refresh();
    }
  }

  function askToLeave(entry: WaitlistEntry) {
    confirm({
      title: t('volunteeringVolunteer:waitlist.leaveConfirmTitle'),
      message: t('volunteeringVolunteer:waitlist.leaveConfirmMessage'),
      confirmLabel: t('volunteeringVolunteer:waitlist.leave'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: `waitlist-confirm-leave-${entry.id}`,
      onConfirm: () => leave(entry),
    });
  }

  async function leave(entry: WaitlistEntry) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(entry.id);
    try {
      await leaveWaitlist(entry.shift.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:waitlist.leaveError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setBusyId(null);
      listApi.refresh();
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      {confirmDialog}
      <AppTopBar title={t('volunteeringVolunteer:waitlist.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      {!switchedOn ? (
        <EmptyState
          icon="hourglass-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="waitlist-switched-off"
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}
          refreshControl={(
            <RefreshControl refreshing={listApi.isLoading && entries.length > 0} onRefresh={listApi.refresh} tintColor={primary} colors={[primary]} />
          )}
        >
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('volunteeringVolunteer:waitlist.intro')}
          </Text>

          <RefreshFailedNotice error={listApi.error} onRetry={listApi.refresh} isRetrying={listApi.isLoading} testID="waitlist-error" />

          {listApi.isLoading && entries.length === 0 && !listApi.error ? (
            <ListSkeleton rows={3} testID="waitlist-skeleton" />
          ) : null}

          {!listApi.isLoading && !listApi.error && entries.length === 0 ? (
            <EmptyState
              icon="hourglass-outline"
              title={t('volunteeringVolunteer:waitlist.empty')}
              subtitle={t('volunteeringVolunteer:waitlist.emptyHint')}
              testID="waitlist-empty"
            />
          ) : null}

          {entries.map((entry) => {
            const free = entry.status === 'notified';
            const tone = free ? theme.success : primary;
            const date = formatDate(entry.shift.start_time);
            const start = formatTime(entry.shift.start_time);
            const end = formatTime(entry.shift.end_time);
            const busy = busyId === entry.id;
            return (
              <HeroCard key={entry.id} className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, free ? 0.4 : 0.14) }} testID={`waitlist-entry-${entry.id}`}>
                <View className="h-1" style={{ backgroundColor: tone }} />
                <HeroCard.Body className="gap-3 p-4">
                  <View className={`${largeText ? '' : 'flex-row items-start justify-between'} gap-3`} style={largeText ? { flexDirection: 'column' } : undefined}>
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 2}>
                        {entry.opportunity.title}
                      </Text>
                      <View className="mt-1 flex-row items-center gap-2">
                        <Avatar uri={entry.organization.logo_url ?? undefined} name={entry.organization.name} size={22} decorative />
                        <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={largeText ? 0 : 1}>
                          {entry.organization.name}
                        </Text>
                      </View>
                    </View>
                    <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default" style={largeText ? { alignSelf: 'stretch', minHeight: 44 } : undefined}>
                      <Ionicons name={free ? 'checkmark-circle-outline' : 'hourglass-outline'} size={12} color={tone} />
                      <Chip.Label>
                        {free ? t('volunteeringVolunteer:waitlist.spotAvailable') : t('volunteeringVolunteer:waitlist.position', { position: entry.position })}
                      </Chip.Label>
                    </Chip>
                  </View>

                  <View className="gap-1">
                    <Text className="text-sm" style={{ color: theme.text }}>
                      {date ?? t('volunteeringVolunteer:common.dateUnknown')}
                      {start && end ? ` · ${t('volunteeringVolunteer:common.timeRange', { start, end })}` : ''}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textMuted }}>
                      {[
                        entry.opportunity.location,
                        typeof entry.shift.capacity === 'number' ? t('volunteeringVolunteer:waitlist.capacity', { count: entry.shift.capacity }) : null,
                        t('volunteeringVolunteer:waitlist.joined', { date: formatDate(entry.joined_at) ?? '' }),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>

                  {free ? (
                    <Text className="text-sm leading-5" style={{ color: theme.success }}>
                      {t('volunteeringVolunteer:waitlist.claimHint')}
                    </Text>
                  ) : null}

                  <View className={`${largeText ? '' : 'flex-row flex-wrap'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
                    {free ? (
                      <HeroButton
                        className={largeText ? 'w-full' : 'flex-1'}
                        size={largeText ? 'md' : 'sm'}
                        isDisabled={busyId !== null}
                        onPress={() => void claim(entry)}
                        testID={`waitlist-claim-${entry.id}`}
                        accessibilityLabel={t('volunteeringVolunteer:waitlist.claimLabel', { title: entry.opportunity.title })}
                        accessibilityState={{ busy }}
                      >
                        {busy ? <Spinner size="sm" /> : null}
                        <HeroButton.Label>{t('volunteeringVolunteer:waitlist.claim')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                    <HeroButton
                      className={largeText ? 'w-full' : 'flex-1'}
                      size={largeText ? 'md' : 'sm'}
                      variant="secondary"
                      onPress={() => router.push({ pathname: '/(modals)/volunteering-detail', params: { id: String(entry.opportunity.id) } })}
                      accessibilityLabel={t('volunteering:openOpportunityLabel', { title: entry.opportunity.title })}
                    >
                      <Ionicons name="open-outline" size={16} color={primary} />
                      <HeroButton.Label>{t('volunteering:viewOpportunity')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton
                      className={largeText ? 'w-full' : 'flex-1'}
                      size={largeText ? 'md' : 'sm'}
                      variant="danger-soft"
                      isDisabled={busyId !== null}
                      onPress={() => askToLeave(entry)}
                      testID={`waitlist-leave-${entry.id}`}
                      accessibilityLabel={t('volunteeringVolunteer:waitlist.leaveLabel', { title: entry.opportunity.title })}
                    >
                      <HeroButton.Label>{t('volunteeringVolunteer:waitlist.leave')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                </HeroCard.Body>
              </HeroCard>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default withRouteGate(MyWaitlistsScreen, 'volunteering-my-waitlists');
