// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Who is on a shift and who turned up — for the people who manage its opportunity.
 *
 * Two server lists, shown together: the roster (approved volunteers with their check-in
 * state, group bookings, waitlist) and the check-in log. Until this screen an organiser's
 * phone could show "1 of 2 places taken" and no names, and attendance appeared nowhere.
 *
 * Opened from the shift list with the shift's label and whether it has started: before it
 * starts, a volunteer with no check-in is "Coming", not "Not checked in".
 */

import { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Surface } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import {
  getShiftCheckIns,
  getShiftRoster,
  shiftTimeToDate,
  unwrapList,
  type RosterPerson,
  type ShiftCheckIn,
  type ShiftRoster,
} from '@/lib/api/volunteeringOrganiser';
import { isRefusalStatus } from '@/lib/api/refusal';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatTime(value: string): string {
  const date = shiftTimeToDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

const EMPTY_SUMMARY: ShiftRoster['summary'] = { signed_up: 0, checked_in: 0, no_show: 0, group_places: 0, waiting: 0 };

function PersonLine({ person, children, testID }: { person: RosterPerson; children?: React.ReactNode; testID?: string }) {
  const { t } = useTranslation('volunteeringOrganiser');
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  return (
    <View testID={testID} className={`${largeText ? 'gap-2' : 'flex-row items-center gap-3'} py-2`}>
      <View className="flex-row items-center gap-3">
        <Avatar uri={person.avatar_url ?? undefined} name={person.name} size={36} decorative />
        <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }}>{person.name}</Text>
      </View>
      <View className={`${largeText ? '' : 'ml-auto'} flex-row flex-wrap items-center gap-2`}>
        {children}
        <HeroButton
          isIconOnly
          size="sm"
          variant="ghost"
          accessibilityLabel={t('roster.openProfile', { name: person.name })}
          onPress={() => router.push({ pathname: '/(modals)/member-profile', params: { id: String(person.id) } })}
        >
          <Ionicons name="person-outline" size={16} color={theme.textSecondary} />
        </HeroButton>
      </View>
    </View>
  );
}

function SectionHeading({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} accessibilityRole="header">
      {children}
    </Text>
  );
}

function ShiftRosterScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ shiftId?: string; label?: string; started?: string }>();
  const shiftId = parseId(params.shiftId);
  const label = firstParam(params.label) ?? '';
  const hasStarted = firstParam(params.started) === '1';
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;

  const rosterApi = useApi(() => (shiftId ? getShiftRoster(shiftId) : Promise.reject(new Error('invalid-shift'))), [shiftId], { enabled: Boolean(shiftId) });
  const checkInsApi = useApi(() => (shiftId ? getShiftCheckIns(shiftId) : Promise.reject(new Error('invalid-shift'))), [shiftId], { enabled: Boolean(shiftId) });

  const refreshAll = useCallback(() => {
    rosterApi.refresh();
    checkInsApi.refresh();
  }, [checkInsApi, rosterApi]);

  const roster = rosterApi.data?.data ?? null;
  const summary = roster?.summary ?? EMPTY_SUMMARY;
  const checkIns = useMemo(() => unwrapList<ShiftCheckIn>(checkInsApi.data?.data, 'checkins'), [checkInsApi.data]);

  if (!shiftId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('roster.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="people-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  if (isRefusalStatus(rosterApi.errorStatus)) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('roster.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="lock-closed-outline" title={t('roster.notYoursTitle')} subtitle={t('roster.notYoursHint')} testID="shift-roster-refused" />
      </SafeAreaView>
    );
  }

  const statusLabel = (status: ShiftRoster['volunteers'][number]['check_in_status']): string => {
    if (status === 'checked_in') return t('roster.status.checked_in');
    if (status === 'checked_out') return t('roster.status.checked_out');
    if (status === 'no_show') return t('roster.status.no_show');
    return hasStarted ? t('roster.status.notCheckedIn') : t('roster.status.notYet');
  };
  const statusColour = (status: ShiftRoster['volunteers'][number]['check_in_status']) =>
    status === 'checked_in' || status === 'checked_out' ? theme.success : status === 'no_show' ? theme.error : theme.textSecondary;

  const figures: { key: keyof ShiftRoster['summary']; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: 'signed_up', label: t('roster.summary.signedUp'), icon: 'people-outline' },
    { key: 'checked_in', label: t('roster.summary.checkedIn'), icon: 'checkmark-circle-outline' },
    { key: 'no_show', label: t('roster.summary.noShow'), icon: 'close-circle-outline' },
    { key: 'group_places', label: t('roster.summary.groupPlaces'), icon: 'people-circle-outline' },
    { key: 'waiting', label: t('roster.summary.waiting'), icon: 'hourglass-outline' },
  ];

  const nobody = roster && roster.volunteers.length === 0 && roster.groups.length === 0 && roster.waitlist.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('roster.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={rosterApi.isLoading && Boolean(roster)} onRefresh={refreshAll} tintColor={primary} colors={[primary]} />}
        contentContainerClassName="gap-4 px-4 pb-8"
      >
        {label ? (
          <Text className="text-base font-semibold" style={{ color: theme.text }} testID="shift-roster-label">{label}</Text>
        ) : null}

        {rosterApi.isLoading && !roster ? <LoadingSpinner /> : null}
        {rosterApi.error && !roster ? (
          <EmptyState icon="cloud-offline-outline" title={t('roster.loadError')} actionLabel={t('common:buttons.retry')} onAction={refreshAll} testID="shift-roster-error" />
        ) : null}
        {roster ? <RefreshFailedNotice error={rosterApi.error} onRetry={refreshAll} isRetrying={rosterApi.isLoading} testID="shift-roster-refresh-failed" /> : null}

        {roster ? (
          <View testID="shift-roster-summary" className={`gap-2 ${largeText ? '' : 'flex-row flex-wrap'}`}>
            {figures.map((figure) => (
              <Surface key={figure.key} variant="secondary" className={`${largeText ? 'w-full' : 'min-w-[46%] flex-1'} gap-1 rounded-panel-inner p-3`}>
                <View className="flex-row items-center gap-2">
                  <Ionicons name={figure.icon} size={16} color={theme.textSecondary} />
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>{String(summary[figure.key])}</Text>
                </View>
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{figure.label}</Text>
              </Surface>
            ))}
          </View>
        ) : null}

        {nobody ? <EmptyState icon="people-outline" title={t('roster.empty')} testID="shift-roster-empty" /> : null}

        {roster && !nobody ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-2 p-4">
              <SectionHeading>{t('roster.volunteersHeading')}</SectionHeading>
              {roster.volunteers.length === 0 ? (
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('roster.noVolunteers')}</Text>
              ) : roster.volunteers.map((entry) => (
                <PersonLine key={entry.user.id} person={entry.user} testID={`shift-roster-volunteer-${entry.user.id}`}>
                  <View className="items-end gap-0.5">
                    <Chip size="sm" variant="secondary" color="default">
                      <Ionicons name="ellipse" size={9} color={statusColour(entry.check_in_status)} />
                      <Chip.Label>{statusLabel(entry.check_in_status)}</Chip.Label>
                    </Chip>
                    {entry.checked_in_at ? (
                      <Text className="text-xs" style={{ color: theme.textMuted }}>{t('roster.checkedInAt', { time: formatTime(entry.checked_in_at) })}</Text>
                    ) : null}
                  </View>
                </PersonLine>
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {roster && roster.groups.length > 0 ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <SectionHeading>{t('roster.groupsHeading')}</SectionHeading>
              {roster.groups.map((group) => (
                <View key={group.id} className="gap-1" testID={`shift-roster-group-${group.id}`}>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-base font-semibold" style={{ color: theme.text }}>{group.group_name}</Text>
                    <Chip size="sm" variant="secondary" color="default">
                      <Chip.Label>{t('roster.groupPlaces', { n: group.reserved_slots })}</Chip.Label>
                    </Chip>
                  </View>
                  {group.leader ? (
                    <Text className="text-xs" style={{ color: theme.textMuted }}>{t('roster.groupLeader', { name: group.leader.name })}</Text>
                  ) : null}
                  {group.members.map((member) => <PersonLine key={member.id} person={member} />)}
                </View>
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {roster && roster.waitlist.length > 0 ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-2 p-4">
              <SectionHeading>{t('roster.waitlistHeading')}</SectionHeading>
              {roster.waitlist.map((entry) => (
                <PersonLine key={entry.user.id} person={entry.user} testID={`shift-roster-waitlist-${entry.user.id}`}>
                  <Text className="text-xs" style={{ color: theme.textMuted }}>{t('roster.waitlistPosition', { position: entry.position })}</Text>
                </PersonLine>
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {roster ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-2 p-4">
              <SectionHeading>{t('roster.checkInsHeading')}</SectionHeading>
              {checkInsApi.isLoading && !checkInsApi.data ? <LoadingSpinner /> : null}
              {checkInsApi.error && !checkInsApi.data ? (
                <RefreshFailedNotice error={t('roster.checkInsError')} onRetry={checkInsApi.refresh} isRetrying={checkInsApi.isLoading} testID="shift-roster-checkins-error" />
              ) : null}
              {checkInsApi.data && checkIns.length === 0 ? (
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('roster.checkInsEmpty')}</Text>
              ) : null}
              {checkIns.map((entry) => (
                <PersonLine key={entry.id} person={entry.user} testID={`shift-roster-checkin-${entry.id}`}>
                  <View className="items-end gap-0.5">
                    <Chip size="sm" variant="secondary" color="default">
                      <Ionicons name="ellipse" size={9} color={entry.status === 'no_show' ? theme.error : theme.success} />
                      <Chip.Label>{t(`roster.status.${entry.status}`, { defaultValue: entry.status })}</Chip.Label>
                    </Chip>
                    {entry.checked_in_at ? (
                      <Text className="text-xs" style={{ color: theme.textMuted }}>{t('roster.checkedInAt', { time: formatTime(entry.checked_in_at) })}</Text>
                    ) : null}
                    {entry.checked_out_at ? (
                      <Text className="text-xs" style={{ color: theme.textMuted }}>{t('roster.checkedOutAt', { time: formatTime(entry.checked_out_at) })}</Text>
                    ) : null}
                  </View>
                </PersonLine>
              ))}
            </HeroCard.Body>
          </HeroCard>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ShiftRosterRoute() {
  return (
    <ModalErrorBoundary>
      <ShiftRosterScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(ShiftRosterRoute, 'volunteering-shift-roster');
