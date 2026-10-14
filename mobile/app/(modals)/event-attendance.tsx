// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import AccentIcon from '@/components/ui/AccentIcon';
import { useTranslation } from 'react-i18next';
import { Alert, Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { Button as HeroButton } from '@/components/ui/NativeButton';

import {
  getEventAttendanceRoster,
  transitionEventAttendance,
  type EventAttendanceAction,
  type EventAttendanceRosterPerson,
} from '@/lib/api/events';
import { ApiResponseError } from '@/lib/api/client';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SearchInput from '@/components/ui/SearchInput';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import EventOfflineCheckinCard from '@/components/events/EventOfflineCheckinCard';
import { isRefusalStatus } from '@/lib/api/refusal';
import { withRouteGate } from '@/components/withRouteGate';

type AttendanceFilter = 'all' | 'not_checked_in' | 'checked_in' | 'checked_out' | 'no_show';
type AttendanceConfirmation = Awaited<ReturnType<typeof transitionEventAttendance>>['data']['mutation'];

const FILTERS: AttendanceFilter[] = [
  'all',
  'not_checked_in',
  'checked_in',
  'checked_out',
  'no_show',
];

/**
 * 🔴 Every 409 used to become one "Roster changed" toast. For a too-early event that told
 * the volunteer on the door that somebody else had edited the record, when the truth was
 * "check-in opens 30 minutes before the start" (audit E-105, 2026-10-13). Each refusal the
 * API can send now gets its own sentence that says what to do next; the version conflict
 * keeps the refresh-and-retry treatment.
 */
const REFUSAL_MESSAGES: Record<string, { title: string; description: string }> = {
  EVENT_ATTENDANCE_TOO_EARLY: { title: 'attendance.refusals.tooEarlyTitle', description: 'attendance.refusals.tooEarly' },
  EVENT_ATTENDANCE_WINDOW_CLOSED: { title: 'attendance.refusals.windowClosedTitle', description: 'attendance.refusals.windowClosed' },
  EVENT_ATTENDANCE_REGISTRATION_REQUIRED: { title: 'attendance.refusals.notRegisteredTitle', description: 'attendance.refusals.notRegistered' },
  EVENT_REGISTRATION_UNAVAILABLE: { title: 'attendance.refusals.eventUnavailableTitle', description: 'attendance.refusals.eventUnavailable' },
  EVENT_REGISTRATION_REASON_REQUIRED: { title: 'attendance.undoReasonRequiredTitle', description: 'attendance.undoReasonRequired' },
};

function newMutationKey(eventId: number, memberId: number, action: EventAttendanceAction, version: number): string {
  return `mobile-attendance-${eventId}-${memberId}-${action}-v${version}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function EventAttendanceScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${id ?? 'invalid'}`}>
      <EventAttendanceScreenInner />
    </ModalErrorBoundary>
  );
}

function EventAttendanceScreenInner() {
  const { t } = useTranslation(['events', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const eventId = Number(id);
  const safeEventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(eventId) ? eventId : 0;
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [activeMutation, setActiveMutation] = useState<string | null>(null);
  /** The member whose Undo reason box is open, if any. */
  const [undoTarget, setUndoTarget] = useState<number | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const mutationKeys = useRef(new Map<string, string>());
  const mutationPendingRef = useRef(false);
  const isMountedRef = useRef(true);
  const confirmationsRef = useRef(new Map<number, AttendanceConfirmation>());
  const [confirmations, setConfirmations] = useState(confirmationsRef.current);

  const rosterApi = useApi(
    () => getEventAttendanceRoster(safeEventId, {
      page,
      search,
      attendanceState: filter === 'all' ? null : filter,
    }),
    [safeEventId, page, search, filter],
    { enabled: safeEventId > 0, clearOnRefusal: true },
  );
  const roster = rosterApi.data;
  const awaitingCurrentRoster = (roster?.data ?? []).some(person =>
    (confirmations.get(person.member.id)?.attendance_version ?? 0) > (person.attendance.version ?? 0));
  const people = (roster?.data ?? []).map(person => {
    const confirmed = confirmations.get(person.member.id);
    if (!confirmed || confirmed.attendance_version <= (person.attendance.version ?? 0)) return person;
    const updated: EventAttendanceRosterPerson = { ...person };
    updated.attendance = {
        id: confirmed.attendance_id,
        state: confirmed.to_state,
        version: confirmed.attendance_version,
        changed_at: confirmed.changed_at,
        checked_in_at: confirmed.checked_in_at,
        checked_out_at: confirmed.checked_out_at,
    };
    // The mutation confirms state, but only a fresh roster grants subsequent actions.
    updated.management_actions = { ...person.management_actions, check_in: false, check_out: false, no_show: false, undo_attendance: false };
    return updated;
  }).filter(person => filter === 'all' || person.attendance.state === filter);
  const meta = roster?.meta ?? null;

  useEffect(() => {
    mutationKeys.current.clear();
    setPage(1);
    setDraftSearch('');
    setSearch('');
    setFilter('all');
    setUndoTarget(null);
    setUndoReason('');
  }, [safeEventId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  function applySearch() {
    setPage(1);
    setSearch(draftSearch.trim());
  }

  function changeFilter(next: AttendanceFilter) {
    if (next === filter) return;
    void Haptics.selectionAsync();
    setPage(1);
    setFilter(next);
  }

  function successDescription(action: EventAttendanceAction, mutation: AttendanceConfirmation): string {
    if (action === 'check_in' && mutation.credit_status === 'already_settled') {
      return t('attendance.creditAlreadySettled');
    }
    if (action === 'check_in' && mutation.credit_status === 'settled') {
      return t('attendance.creditSettled');
    }
    if (action === 'undo') return t('attendance.undoRecorded');
    return t(`attendance.actions.${action}`);
  }

  async function runAttendanceAction(person: EventAttendanceRosterPerson, action: EventAttendanceAction, reason?: string) {
    if (!isMountedRef.current || mutationPendingRef.current) return;
    if ((confirmationsRef.current.get(person.member.id)?.attendance_version ?? 0) > (person.attendance.version ?? 0)) return;
    mutationPendingRef.current = true;
    const expectedVersion = person.attendance.version ?? 0;
    const operationId = `${person.member.id}:${action}:${expectedVersion}`;
    const idempotencyKey = mutationKeys.current.get(operationId)
      ?? newMutationKey(safeEventId, person.member.id, action, expectedVersion);
    mutationKeys.current.set(operationId, idempotencyKey);
    setActiveMutation(operationId);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await transitionEventAttendance(safeEventId, person.member.id, {
        action,
        expectedVersion,
        idempotencyKey,
        ...(reason ? { reason } : {}),
      });
      mutationKeys.current.delete(operationId);
      if (!isMountedRef.current) return;
      confirmationsRef.current = new Map(confirmationsRef.current).set(person.member.id, result.data.mutation);
      setConfirmations(confirmationsRef.current);
      if (action === 'undo') {
        setUndoTarget(null);
        setUndoReason('');
      }
      showToast({
        title: t('attendance.updated'),
        description: successDescription(action, result.data.mutation),
        variant: 'success',
      });
      rosterApi.refresh();
    } catch (error) {
      if (!isMountedRef.current) return;
      const code = error instanceof ApiResponseError ? error.code : undefined;
      const refusal = code ? REFUSAL_MESSAGES[code] : undefined;
      if (refusal) {
        // The server said no for a reason the volunteer can act on: say it, and show the
        // roster the server now holds (its `management_actions` explain which buttons apply).
        mutationKeys.current.delete(operationId);
        showToast({ title: t(refusal.title), description: t(refusal.description), variant: 'warning' });
        rosterApi.refresh();
      } else if (error instanceof ApiResponseError && error.status === 409) {
        mutationKeys.current.delete(operationId);
        showToast({
          title: t('attendance.conflictTitle'),
          description: t('attendance.conflictDescription'),
          variant: 'warning',
        });
        rosterApi.refresh();
      } else {
        showToast({
          title: t('attendance.updateErrorTitle'),
          description: t('attendance.updateErrorDescription'),
          variant: 'danger',
        });
        // 🔴 Refresh even on an unexpected failure. A contract-drift throw happens AFTER
        // the server has committed the transition, so leaving the roster untouched showed
        // an organiser "Not checked in" for somebody who was checked in — and their only
        // reasonable next move was to tap again. Whatever went wrong, the roster the
        // organiser is looking at must be the server's state, not the state before the
        // attempt.
        rosterApi.refresh();
      }
    } finally {
      mutationPendingRef.current = false;
      if (isMountedRef.current) setActiveMutation(null);
    }
  }

  function requestAction(person: EventAttendanceRosterPerson, action: EventAttendanceAction) {
    if (action === 'undo') {
      // Undo needs a reason: open the reason box on this person's card instead of sending.
      setUndoTarget(person.member.id);
      setUndoReason('');
      return;
    }
    if (action !== 'no_show') {
      void runAttendanceAction(person, action);
      return;
    }
    const name = person.member.display_name ?? t('attendance.memberFallback', { id: person.member.id });
    confirm({
      title: t('attendance.noShowTitle'),
      message: t('attendance.noShowDescription', { name }),
      confirmLabel: t('attendance.actions.no_show'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => runAttendanceAction(person, action),
    });
  }

  function submitUndo(person: EventAttendanceRosterPerson) {
    const reason = undoReason.trim();
    if (!reason) {
      showToast({
        title: t('attendance.undoReasonRequiredTitle'),
        description: t('attendance.undoReasonRequired'),
        variant: 'warning',
      });
      return;
    }
    void runAttendanceAction(person, 'undo', reason);
  }

  const fallbackHref = safeEventId > 0
    ? ({ pathname: '/(modals)/event-detail', params: { id: String(safeEventId) } } as Href)
    : ('/(tabs)/events' as Href);

  if (safeEventId <= 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('attendance.title')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/events" />
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm text-muted-foreground">{t('detail.invalidId')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={t('attendance.title')}
        backLabel={t('common:buttons.back')}
        fallbackHref={fallbackHref}
        rightAction={{
          accessibilityLabel: t('attendance.refresh'),
          icon: 'refresh-outline',
          onPress: rosterApi.refresh,
        }}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-10"
        refreshControl={(
          <RefreshControl
            refreshing={rosterApi.isLoading && roster !== null}
            onRefresh={rosterApi.refresh}
            tintColor={primary}
            colors={[primary]}
          />
        )}
      >
        <HeroCard variant="default">
          <HeroCard.Body className="gap-2 px-4 py-4">
            <Text className="text-xl font-bold" style={{ color: theme.text }}>{t('attendance.title')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('attendance.subtitle')}</Text>
          </HeroCard.Body>
        </HeroCard>

        <HowCheckinWorksPanel />

        <Surface variant="secondary" className="gap-3 rounded-panel-inner p-4">
          <Text className="text-base font-bold" style={{ color: theme.text }} accessibilityRole="header">
            {t('attendance.byNameTitle')}
          </Text>
          <SearchInput
            value={draftSearch}
            onChangeText={(value) => {
              setDraftSearch(value);
              if (value === '' && search !== '') {
                setPage(1);
                setSearch('');
              }
            }}
            onSubmitEditing={applySearch}
            placeholder={t('attendance.searchPlaceholder')}
            clearLabel={t('attendance.clearSearch')}
            accessibilityLabel={t('attendance.searchLabel')}
            returnKeyType="search"
            disabled={rosterApi.isLoading}
            containerClassName="mb-0"
          />
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t('attendance.searchHint')}</Text>
          <HeroButton variant="secondary" onPress={applySearch} isDisabled={rosterApi.isLoading}>
            <Ionicons name="search-outline" size={17} color={primary} />
            <HeroButton.Label>{t('attendance.search')}</HeroButton.Label>
          </HeroButton>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {FILTERS.map((option) => (
              <Chip
                key={option}
                size="sm"
                variant={filter === option ? 'primary' : 'soft'}
                color={filter === option ? 'accent' : 'default'}
                onPress={() => changeFilter(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === option }}
              >
                <Chip.Label>{t(`attendance.filters.${option}`)}</Chip.Label>
              </Chip>
            ))}
          </ScrollView>
        </Surface>

        {meta && !awaitingCurrentRoster ? (
          <View className="flex-row flex-wrap gap-2" accessibilityLabel={t('attendance.metricsLabel')}>
            <Metric label={t('attendance.metrics.confirmed')} value={meta.metrics.confirmed} />
            <Metric label={t('attendance.metrics.checked_in')} value={meta.metrics.checked_in} />
            <Metric label={t('attendance.metrics.checked_out')} value={meta.metrics.checked_out} />
            <Metric label={t('attendance.metrics.no_show')} value={meta.metrics.no_show} />
          </View>
        ) : null}

        {rosterApi.isLoading && !roster ? (
          <View className="items-center py-10"><LoadingSpinner /></View>
        ) : rosterApi.error && isRefusalStatus(rosterApi.errorStatus) ? (
        /*
          🔴 A refusal is not a failure. This organiser-only screen answered a 403 with
          "could not load" and a Try again button that can never work: the member is
          not the organiser, or no longer is. Same treatment as job-analytics and
          job-pipeline (audit 2026-09-07, E/F-9), applied here 2026-09-08.
        */
          <HeroCard variant="secondary" testID="event-attendance-refused">
            <HeroCard.Body className="items-center gap-2 px-4 py-6">
              <Ionicons name="lock-closed-outline" size={30} color={theme.textMuted} />
              <Text className="text-center text-base font-semibold" style={{ color: theme.text }}>
                {t('common:errors.notAvailableTitle')}
              </Text>
              <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>
                {t('common:errors.notAvailableHint')}
              </Text>
            </HeroCard.Body>
          </HeroCard>
        ) : rosterApi.error ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('attendance.loadErrorTitle')}</Alert.Title>
              <Alert.Description>{t('attendance.loadErrorDescription')}</Alert.Description>
            </Alert.Content>
            <HeroButton size="sm" variant="danger-soft" onPress={rosterApi.refresh}>
              <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
            </HeroButton>
          </Alert>
        ) : people.length === 0 ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="items-center gap-2 px-4 py-6">
              <Ionicons name="people-outline" size={30} color={theme.textMuted} />
              <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{t('attendance.empty')}</Text>
            </HeroCard.Body>
          </HeroCard>
        ) : (
          <View className="gap-3">
            <Text className="text-sm" style={{ color: theme.textSecondary }} accessibilityLiveRegion="polite">
              {t('attendance.resultCount', { count: meta?.total ?? people.length })}
            </Text>
            {people.map((person) => (
              <AttendancePersonCard
                key={person.member.id}
                person={person}
                activeMutation={activeMutation}
                onAction={requestAction}
                undoOpen={undoTarget === person.member.id}
                undoReason={undoReason}
                onUndoReasonChange={setUndoReason}
                onUndoSubmit={() => submitUndo(person)}
                onUndoCancel={() => { setUndoTarget(null); setUndoReason(''); }}
              />
            ))}
          </View>
        )}

        {meta && meta.total_pages > 1 ? (
          <View className="flex-row items-center justify-between gap-3" accessibilityLabel={t('attendance.paginationLabel')}>
            <HeroButton
              className="min-w-0 flex-1"
              variant="secondary"
              isDisabled={page <= 1 || rosterApi.isLoading}
              onPress={() => setPage((current) => Math.max(1, current - 1))}
            >
              <HeroButton.Label>{t('attendance.previous')}</HeroButton.Label>
            </HeroButton>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>
              {t('attendance.pageSummary', { page, total: meta.total_pages })}
            </Text>
            <HeroButton
              className="min-w-0 flex-1"
              variant="secondary"
              isDisabled={!meta.has_more || rosterApi.isLoading}
              onPress={() => setPage((current) => current + 1)}
            >
              <HeroButton.Label>{t('attendance.next')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : null}

        <View className="gap-1 pt-2">
          <Text className="text-base font-bold" style={{ color: theme.text }} accessibilityRole="header">
            {t('attendance.offlineSectionTitle')}
          </Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('attendance.offlineSectionHint')}
          </Text>
        </View>
        <EventOfflineCheckinCard eventId={safeEventId} />
      </ScrollView>
      {confirmDialog}
    </SafeAreaView>
  );
}

/**
 * Plain-English explanation of check-in for the volunteer on the door (owner instruction,
 * E-105): who can use it, when it opens and closes, the three ways to record attendance
 * and what Undo does. Collapsed by default because the roster below is the busy part of
 * the page; the one-line summary stays visible.
 */
function HowCheckinWorksPanel() {
  const { t } = useTranslation(['events']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const [expanded, setExpanded] = useState(false);
  const steps = ['who', 'when', 'byName', 'byCode', 'offline', 'undo', 'credits'] as const;

  return (
    <HeroCard variant="secondary" testID="attendance-how-it-works">
      <HeroCard.Body className="gap-2 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={t('attendance.howItWorks.title')}
          accessibilityHint={t(expanded ? 'attendance.howItWorks.collapseHint' : 'attendance.howItWorks.expandHint')}
          onPress={() => setExpanded((current) => !current)}
          className="flex-row items-center gap-2"
        >
          <Ionicons name="help-circle-outline" size={20} color={primary} />
          <Text className="min-w-0 flex-1 text-base font-bold" style={{ color: theme.text }}>
            {t('attendance.howItWorks.title')}
          </Text>
          <Ionicons name={expanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={theme.textSecondary} />
        </Pressable>
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {t('attendance.howItWorks.summary')}
        </Text>
        {expanded ? (
          <View className="gap-2 pt-1" testID="attendance-how-it-works-steps">
            {steps.map((step, index) => (
              <View key={step} className="flex-row gap-2">
                <Text className="w-5 text-sm font-bold" style={{ color: primary }}>{index + 1}.</Text>
                <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.text }}>
                  {t(`attendance.howItWorks.steps.${step}`)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 rounded-panel-inner p-3">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="mt-1 text-xl font-bold text-foreground">{value}</Text>
    </Surface>
  );
}

function AttendancePersonCard({
  person,
  activeMutation,
  onAction,
  undoOpen,
  undoReason,
  onUndoReasonChange,
  onUndoSubmit,
  onUndoCancel,
}: {
  person: EventAttendanceRosterPerson;
  activeMutation: string | null;
  onAction: (person: EventAttendanceRosterPerson, action: EventAttendanceAction) => void;
  undoOpen: boolean;
  undoReason: string;
  onUndoReasonChange: (value: string) => void;
  onUndoSubmit: () => void;
  onUndoCancel: () => void;
}) {
  const { t } = useTranslation(['events', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const name = person.member.display_name ?? t('attendance.memberFallback', { id: person.member.id });
  const actions: EventAttendanceAction[] = [
    ...(person.management_actions.check_in ? ['check_in' as const] : []),
    ...(person.management_actions.check_out ? ['check_out' as const] : []),
    ...(person.management_actions.no_show ? ['no_show' as const] : []),
    ...(person.management_actions.undo_attendance ? ['undo' as const] : []),
  ];
  const undoBusy = activeMutation === `${person.member.id}:undo:${person.attendance.version ?? 0}`;

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <View className="flex-row items-center gap-3">
          <Avatar uri={person.member.avatar_url ?? undefined} name={name} size={42} />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{name}</Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {t(`attendance.states.${person.attendance.state}`)}
            </Text>
          </View>
          <Chip
            size="sm"
            variant="soft"
            color={person.attendance.state === 'checked_in' || person.attendance.state === 'attended'
              ? 'success'
              : person.attendance.state === 'no_show'
                ? 'danger'
                : 'default'}
          >
            <Chip.Label>{t(`attendance.states.${person.attendance.state}`)}</Chip.Label>
          </Chip>
        </View>

        {actions.length === 0 ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('attendance.noActions')}</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {actions.map((action) => {
              const operationId = `${person.member.id}:${action}:${person.attendance.version ?? 0}`;
              const busy = activeMutation === operationId;
              return (
                <HeroButton
                  key={action}
                  size="sm"
                  variant={action === 'no_show' ? 'danger-soft' : action === 'check_in' ? 'primary' : 'secondary'}
                  isDisabled={activeMutation !== null || (action === 'undo' && undoOpen)}
                  accessibilityLabel={t('attendance.actionLabel', { action: t(`attendance.actions.${action}`), name })}
                  accessibilityHint={action === 'undo' ? t('attendance.undoHint') : undefined}
                  accessibilityState={{ busy }}
                  onPress={() => onAction(person, action)}
                >
                  {busy ? <Spinner size="sm" /> : action === 'check_in' ? (
                    <AccentIcon name="log-in-outline" size={16} />
                  ) : (
                    <Ionicons
                      name={action === 'check_out' ? 'log-out-outline' : action === 'undo' ? 'arrow-undo-outline' : 'person-remove-outline'}
                      size={16}
                      color={action === 'no_show' ? theme.error : primary}
                    />
                  )}
                  <HeroButton.Label>{t(`attendance.actions.${action}`)}</HeroButton.Label>
                </HeroButton>
              );
            })}
          </View>
        )}

        {undoOpen ? (
          <Surface variant="tertiary" className="gap-2 rounded-panel-inner p-3" testID={`attendance-undo-${person.member.id}`}>
            <Text className="text-sm font-semibold" style={{ color: theme.text }}>
              {t('attendance.undoTitle', { name })}
            </Text>
            <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t('attendance.undoHint')}</Text>
            <TextArea
              label={t('attendance.undoReasonLabel')}
              value={undoReason}
              onChangeText={onUndoReasonChange}
              placeholder={t('attendance.undoReasonPlaceholder')}
              editable={!undoBusy}
            />
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" size="sm" variant="primary" isDisabled={activeMutation !== null} onPress={onUndoSubmit}>
                {undoBusy ? <Spinner size="sm" /> : null}
                <HeroButton.Label>{t('attendance.undoConfirm')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="secondary" isDisabled={undoBusy} onPress={onUndoCancel}>
                <HeroButton.Label>{t('attendance.undoCancel')}</HeroButton.Label>
              </HeroButton>
            </View>
          </Surface>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

export default withRouteGate(EventAttendanceScreen, 'event-attendance');
