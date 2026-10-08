// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The organiser's shifts for one opportunity: upcoming and past one-off shifts, the
 * repeating patterns that generate them, and the way into each shift's roster.
 *
 * Mirrors the website's ShiftManager (react-frontend/src/components/volunteering/
 * ShiftManager.tsx). Until this screen the app could only SHOW shifts to volunteers;
 * nothing on a phone could create, change or remove one.
 *
 * Reached from the organisation dashboard's Opportunities tab. Adding and editing happen
 * on their own screens (volunteering-shift-form, volunteering-shift-pattern-form); this
 * list refreshes when it regains focus so a saved change shows without a manual pull.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import { FormHero } from '@/components/ui/FormSection';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import {
  deactivateRecurringPattern,
  deleteShift,
  getManagedShifts,
  getRecurringPatterns,
  shiftTimeToDate,
  unwrapList,
  type ManagedShift,
  type RecurringPattern,
} from '@/lib/api/volunteeringOrganiser';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusalStatus } from '@/lib/api/refusal';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

/** The volunteering module colour used by the quick-create menu and the volunteering list. */
const VOLUNTEERING_TONE = '#e11d48';

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatShiftDay(value: string): string {
  const date = shiftTimeToDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatShiftTimeRange(start: string, end: string): string {
  const from = shiftTimeToDate(start);
  const to = shiftTimeToDate(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return `${start} – ${end}`;
  const format = new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  return `${format.format(from)} – ${format.format(to)}`;
}

/** "09:00:00" (a pattern's clock time) → localised "09:00". */
function formatClock(clock: string): string {
  const [h = '0', m = '0'] = clock.split(':');
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(2024, 0, 1, Number(h), Number(m)));
}

/** Weekday names in the member's language. 2024-01-01 was a Monday, and the server stores Monday as 1. */
function weekdayName(iso: number): string {
  return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(new Date(2024, 0, iso));
}

function formatDateOnly(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function describePattern(pattern: RecurringPattern, t: (key: string) => string): string {
  const base = t(`shifts.frequency.${pattern.frequency}`);
  const usesDays = pattern.frequency === 'weekly' || pattern.frequency === 'biweekly';
  return usesDays && pattern.days_of_week.length > 0 ? `${base} · ${pattern.days_of_week.map(weekdayName).join(', ')}` : base;
}

function ShiftRow({ shift, isPast, busy, onRoster, onEdit, onRemove }: {
  shift: ManagedShift;
  isPast: boolean;
  busy: boolean;
  onRoster: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('volunteeringOrganiser');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const taken = shift.signup_count + (shift.reserved_count ?? 0);
  const label = `${formatShiftDay(shift.start_time)}, ${formatShiftTimeRange(shift.start_time, shift.end_time)}`;

  return (
    <HeroCard className="rounded-panel p-0" testID={`managed-shift-${shift.id}`}>
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} style={{ marginTop: 2 }} />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{formatShiftDay(shift.start_time)}</Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{formatShiftTimeRange(shift.start_time, shift.end_time)}</Text>
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip size="sm" variant="secondary" color="default">
            <Ionicons name="people-outline" size={12} color={theme.textSecondary} />
            <Chip.Label>
              {shift.capacity
                ? t('shifts.placesOf', { taken, capacity: shift.capacity })
                : t('shifts.signedUp', { n: taken })}
            </Chip.Label>
          </Chip>
          {shift.recurring_pattern_id ? (
            <Chip size="sm" variant="secondary" color="accent">
              <Ionicons name="repeat-outline" size={12} color={primary} />
              <Chip.Label>{t('shifts.repeatingChip')}</Chip.Label>
            </Chip>
          ) : null}
          {isPast ? (
            <Chip size="sm" variant="secondary" color="default">
              <Chip.Label>{t('shifts.startedChip')}</Chip.Label>
            </Chip>
          ) : null}
        </View>
        <View testID={`managed-shift-${shift.id}-actions`} className={`gap-2 ${largeText ? '' : 'flex-row flex-wrap'}`}>
          <HeroButton size="sm" variant="secondary" onPress={onRoster} accessibilityLabel={t('shifts.rosterLabel', { shift: label })} testID={`managed-shift-${shift.id}-roster`}>
            <Ionicons name="people-outline" size={16} color={primary} />
            <HeroButton.Label>{t('shifts.roster')}</HeroButton.Label>
          </HeroButton>
          {isPast ? null : (
            <>
              <HeroButton size="sm" variant="secondary" isDisabled={busy} onPress={onEdit} accessibilityLabel={t('shifts.editLabel', { shift: label })} testID={`managed-shift-${shift.id}-edit`}>
                <Ionicons name="create-outline" size={16} color={primary} />
                <HeroButton.Label>{t('shifts.edit')}</HeroButton.Label>
              </HeroButton>
              <HeroButton size="sm" variant="danger-soft" isDisabled={busy} onPress={onRemove} accessibilityLabel={t('shifts.removeLabel', { shift: label })} testID={`managed-shift-${shift.id}-remove`}>
                <HeroButton.Label>{t('shifts.remove')}</HeroButton.Label>
              </HeroButton>
            </>
          )}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function ShiftListScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ opportunityId?: string; title?: string }>();
  const opportunityId = parseId(params.opportunityId);
  const opportunityTitle = firstParam(params.title) ?? '';
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [showPast, setShowPast] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const actionPending = useRef(false);
  const hasFocusedOnceRef = useRef(false);

  const shiftsApi = useApi(
    () => (opportunityId ? getManagedShifts(opportunityId) : Promise.reject(new Error('invalid-opportunity'))),
    [opportunityId],
    { enabled: Boolean(opportunityId) },
  );
  const patternsApi = useApi(
    () => (opportunityId ? getRecurringPatterns(opportunityId) : Promise.reject(new Error('invalid-opportunity'))),
    [opportunityId],
    { enabled: Boolean(opportunityId) },
  );

  const refreshAll = useCallback(() => {
    shiftsApi.refresh();
    patternsApi.refresh();
  }, [patternsApi, shiftsApi]);

  // A shift saved on the form screen must show here when the member comes back, without a pull.
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      refreshAll();
    }, [refreshAll]),
  );

  const shifts = useMemo(() => unwrapList<ManagedShift>(shiftsApi.data?.data, 'shifts'), [shiftsApi.data]);
  const patterns = useMemo(() => unwrapList<RecurringPattern>(patternsApi.data?.data, 'patterns').filter((p) => p.is_active), [patternsApi.data]);
  // The community has repeating shifts switched off: hide that half quietly, as the website does.
  const repeatingOff = patternsApi.errorCode === 'FEATURE_DISABLED';

  const now = Date.now();
  const { upcoming, past } = useMemo(() => {
    const sorted = [...shifts].sort((a, b) => shiftTimeToDate(a.start_time).getTime() - shiftTimeToDate(b.start_time).getTime());
    return {
      upcoming: sorted.filter((s) => shiftTimeToDate(s.start_time).getTime() > now),
      past: sorted.filter((s) => shiftTimeToDate(s.start_time).getTime() <= now).reverse(),
    };
  }, [shifts, now]);

  async function runAction(key: string, action: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusyId(key);
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshAll();
    } finally {
      actionPending.current = false;
      setBusyId(null);
    }
  }

  function askRemove(shift: ManagedShift) {
    confirm({
      title: t('shifts.removeTitle'),
      message: `${formatShiftDay(shift.start_time)} · ${formatShiftTimeRange(shift.start_time, shift.end_time)}\n${shift.signup_count > 0
        ? t('shifts.removeBody', { count: shift.signup_count })
        : t('shifts.removeBodyNone')}`,
      confirmLabel: t('shifts.removeConfirm'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: 'shift-remove-confirm',
      onConfirm: () => runAction(`shift-${shift.id}`, async () => {
        try {
          const result = await deleteShift(shift.id);
          const affected = result?.data?.affected_volunteers ?? 0;
          showToast({
            title: affected > 0 ? t('shifts.removedAffected', { count: affected }) : t('shifts.removed'),
            variant: 'success',
          });
        } catch (err) {
          // The server's own refusal ("the shift has started") is the useful sentence here.
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('shifts.removeFailed')), variant: 'danger' });
        }
      }),
    });
  }

  function askStop(pattern: RecurringPattern) {
    confirm({
      title: t('shifts.stopTitle'),
      message: t('shifts.stopBody'),
      confirmLabel: t('shifts.stopConfirm'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: 'pattern-stop-confirm',
      onConfirm: () => runAction(`pattern-${pattern.id}`, async () => {
        try {
          const result = await deactivateRecurringPattern(pattern.id);
          showToast({ title: t('shifts.patternStopped', { count: result?.data?.future_shifts_removed ?? 0 }), variant: 'success' });
        } catch (err) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('shifts.stopFailed')), variant: 'danger' });
        }
      }),
    });
  }

  function openForm(shiftId?: number) {
    if (!opportunityId) return;
    router.push({
      pathname: '/(modals)/volunteering-shift-form',
      params: { opportunityId: String(opportunityId), ...(shiftId ? { shiftId: String(shiftId) } : {}) },
    } as Href);
  }

  function openPatternForm(patternId?: number) {
    if (!opportunityId) return;
    router.push({
      pathname: '/(modals)/volunteering-shift-pattern-form',
      params: { opportunityId: String(opportunityId), ...(patternId ? { patternId: String(patternId) } : {}) },
    } as Href);
  }

  function openRoster(shift: ManagedShift, started: boolean) {
    router.push({
      pathname: '/(modals)/volunteering-shift-roster',
      params: {
        shiftId: String(shift.id),
        label: `${formatShiftDay(shift.start_time)}, ${formatShiftTimeRange(shift.start_time, shift.end_time)}`,
        started: started ? '1' : '0',
      },
    } as Href);
  }

  if (!opportunityId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('shifts.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="calendar-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  // A 403/404 on the shift list is "not yours", not "try again" — Retry can never succeed.
  if (isRefusalStatus(shiftsApi.errorStatus)) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('shifts.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="lock-closed-outline" title={t('shifts.notYoursTitle')} subtitle={t('shifts.notYoursHint')} testID="shift-list-refused" />
      </SafeAreaView>
    );
  }

  const initialLoading = shiftsApi.isLoading && !shiftsApi.data;
  const loadFailed = Boolean(shiftsApi.error) && !shiftsApi.data;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('shifts.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={shiftsApi.isLoading && Boolean(shiftsApi.data)} onRefresh={refreshAll} tintColor={primary} colors={[primary]} />}
        contentContainerClassName="gap-4 px-4 pb-8"
      >
        <FormHero icon="calendar-outline" eyebrow={opportunityTitle || undefined} title={t('shifts.title')} subtitle={t('shifts.intro')} tone={VOLUNTEERING_TONE}>
          <View className="flex-row flex-wrap gap-2">
            <HeroButton size="sm" onPress={() => openForm()} testID="shift-list-add">
              <Ionicons name="add-outline" size={16} color={theme.bg} />
              <HeroButton.Label>{t('shifts.addShift')}</HeroButton.Label>
            </HeroButton>
            {repeatingOff ? null : (
              <HeroButton size="sm" variant="secondary" onPress={() => openPatternForm()} testID="shift-list-add-repeating">
                <Ionicons name="repeat-outline" size={16} color={primary} />
                <HeroButton.Label>{t('shifts.addRepeating')}</HeroButton.Label>
              </HeroButton>
            )}
          </View>
        </FormHero>

        {initialLoading ? <LoadingSpinner /> : null}

        {loadFailed ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('shifts.loadError')}
            actionLabel={t('common:buttons.retry')}
            onAction={refreshAll}
            testID="shift-list-error"
          />
        ) : null}

        {shiftsApi.data ? <RefreshFailedNotice error={shiftsApi.error} onRetry={refreshAll} isRetrying={shiftsApi.isLoading} testID="shift-list-refresh-failed" /> : null}

        {shiftsApi.data ? (
          <View className="gap-3">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} accessibilityRole="header">
              {t('shifts.upcomingHeading')}
            </Text>
            {upcoming.length === 0 ? (
              <EmptyState icon="calendar-outline" title={t('shifts.noUpcoming')} testID="shift-list-empty" />
            ) : upcoming.map((shift) => (
              <ShiftRow
                key={shift.id}
                shift={shift}
                isPast={false}
                busy={busyId !== null}
                onRoster={() => openRoster(shift, false)}
                onEdit={() => openForm(shift.id)}
                onRemove={() => askRemove(shift)}
              />
            ))}
          </View>
        ) : null}

        {past.length > 0 ? (
          <View className="gap-3">
            <HeroButton size="sm" variant="ghost" onPress={() => setShowPast((v) => !v)} testID="shift-list-toggle-past">
              <Ionicons name={showPast ? 'chevron-up-outline' : 'chevron-down-outline'} size={16} color={theme.textSecondary} />
              <HeroButton.Label style={{ color: theme.textSecondary }}>
                {showPast ? t('shifts.hidePast') : t('shifts.showPast', { count: past.length })}
              </HeroButton.Label>
            </HeroButton>
            {showPast ? past.map((shift) => (
              <ShiftRow
                key={shift.id}
                shift={shift}
                isPast
                busy={busyId !== null}
                onRoster={() => openRoster(shift, true)}
                onEdit={() => undefined}
                onRemove={() => undefined}
              />
            )) : null}
          </View>
        ) : null}

        {!repeatingOff && patterns.length > 0 ? (
          <View className="gap-3">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} accessibilityRole="header">
              {t('shifts.patternsHeading')}
            </Text>
            {patterns.map((pattern) => {
              const summary = describePattern(pattern, t);
              return (
                <HeroCard key={pattern.id} className="rounded-panel p-0" testID={`managed-pattern-${pattern.id}`}>
                  <HeroCard.Body className="gap-3 p-4">
                    <View className="flex-row items-start gap-3">
                      <Ionicons name="repeat-outline" size={18} color={theme.textSecondary} style={{ marginTop: 2 }} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-base font-semibold" style={{ color: theme.text }}>{summary}</Text>
                        <Text className="text-sm" style={{ color: theme.textSecondary }}>
                          {`${formatClock(pattern.start_time)} – ${formatClock(pattern.end_time)} · ${t('shifts.placesPerShift', { count: pattern.capacity })}`}
                        </Text>
                        {pattern.end_date ? (
                          <Text className="text-xs" style={{ color: theme.textMuted }}>{t('shifts.until', { date: formatDateOnly(pattern.end_date) })}</Text>
                        ) : null}
                      </View>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      <HeroButton size="sm" variant="secondary" isDisabled={busyId !== null} onPress={() => openPatternForm(pattern.id)} accessibilityLabel={t('shifts.patternEditLabel', { pattern: summary })} testID={`managed-pattern-${pattern.id}-edit`}>
                        <Ionicons name="create-outline" size={16} color={primary} />
                        <HeroButton.Label>{t('shifts.patternEdit')}</HeroButton.Label>
                      </HeroButton>
                      <HeroButton size="sm" variant="danger-soft" isDisabled={busyId !== null} onPress={() => askStop(pattern)} accessibilityLabel={t('shifts.stopPatternLabel', { pattern: summary })} testID={`managed-pattern-${pattern.id}-stop`}>
                        <HeroButton.Label>{t('shifts.stopPattern')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                  </HeroCard.Body>
                </HeroCard>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function ShiftListRoute() {
  return (
    <ModalErrorBoundary>
      <ShiftListScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(ShiftListRoute, 'volunteering-shift-list');
