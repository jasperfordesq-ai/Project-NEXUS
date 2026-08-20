// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';

import {
  getEventAttendanceRoster,
  transitionEventAttendance,
  type EventAttendanceAction,
  type EventAttendanceRosterPerson,
} from '@/lib/api/events';
import { ApiResponseError } from '@/lib/api/client';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SearchInput from '@/components/ui/SearchInput';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import EventOfflineCheckinCard from '@/components/events/EventOfflineCheckinCard';

type AttendanceFilter = 'all' | 'not_checked_in' | 'checked_in' | 'checked_out' | 'no_show';

const FILTERS: AttendanceFilter[] = [
  'all',
  'not_checked_in',
  'checked_in',
  'checked_out',
  'no_show',
];

function newMutationKey(eventId: number, memberId: number, action: EventAttendanceAction, version: number): string {
  return `mobile-attendance-${eventId}-${memberId}-${action}-v${version}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function EventAttendanceScreen() {
  return (
    <ModalErrorBoundary>
      <EventAttendanceScreenInner />
    </ModalErrorBoundary>
  );
}

function EventAttendanceScreenInner() {
  const { t } = useTranslation(['events', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const eventId = Number(id);
  const safeEventId = Number.isFinite(eventId) && eventId > 0 ? eventId : 0;
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [activeMutation, setActiveMutation] = useState<string | null>(null);
  const mutationKeys = useRef(new Map<string, string>());

  const rosterApi = useApi(
    () => getEventAttendanceRoster(safeEventId, {
      page,
      search,
      attendanceState: filter === 'all' ? null : filter,
    }),
    [safeEventId, page, search, filter],
    { enabled: safeEventId > 0 },
  );
  const roster = rosterApi.data;
  const people = roster?.data ?? [];
  const meta = roster?.meta ?? null;

  useEffect(() => {
    mutationKeys.current.clear();
    setPage(1);
    setDraftSearch('');
    setSearch('');
    setFilter('all');
  }, [safeEventId]);

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

  async function runAttendanceAction(person: EventAttendanceRosterPerson, action: EventAttendanceAction) {
    const expectedVersion = person.attendance.version ?? 0;
    const operationId = `${person.member.id}:${action}:${expectedVersion}`;
    const idempotencyKey = mutationKeys.current.get(operationId)
      ?? newMutationKey(safeEventId, person.member.id, action, expectedVersion);
    mutationKeys.current.set(operationId, idempotencyKey);
    setActiveMutation(operationId);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await transitionEventAttendance(safeEventId, person.member.id, {
        action,
        expectedVersion,
        idempotencyKey,
      });
      mutationKeys.current.delete(operationId);
      showToast({
        title: t('attendance.updated'),
        description: t(`attendance.actions.${action}`),
        variant: 'success',
      });
      rosterApi.refresh();
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409) {
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
      }
    } finally {
      setActiveMutation(null);
    }
  }

  function requestAction(person: EventAttendanceRosterPerson, action: EventAttendanceAction) {
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

        <EventOfflineCheckinCard eventId={safeEventId} />

        <Surface variant="secondary" className="gap-3 rounded-panel-inner p-4">
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

        {meta ? (
          <View className="flex-row flex-wrap gap-2" accessibilityLabel={t('attendance.metricsLabel')}>
            <Metric label={t('attendance.metrics.confirmed')} value={meta.metrics.confirmed} />
            <Metric label={t('attendance.metrics.checked_in')} value={meta.metrics.checked_in} />
            <Metric label={t('attendance.metrics.checked_out')} value={meta.metrics.checked_out} />
            <Metric label={t('attendance.metrics.no_show')} value={meta.metrics.no_show} />
          </View>
        ) : null}

        {rosterApi.isLoading && !roster ? (
          <View className="items-center py-10"><LoadingSpinner /></View>
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
      </ScrollView>
      {confirmDialog}
    </SafeAreaView>
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
}: {
  person: EventAttendanceRosterPerson;
  activeMutation: string | null;
  onAction: (person: EventAttendanceRosterPerson, action: EventAttendanceAction) => void;
}) {
  const { t } = useTranslation(['events', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const name = person.member.display_name ?? t('attendance.memberFallback', { id: person.member.id });
  const actions: EventAttendanceAction[] = [
    ...(person.management_actions.check_in ? ['check_in' as const] : []),
    ...(person.management_actions.check_out ? ['check_out' as const] : []),
    ...(person.management_actions.no_show ? ['no_show' as const] : []),
  ];

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
                  isDisabled={activeMutation !== null}
                  accessibilityLabel={t('attendance.actionLabel', { action: t(`attendance.actions.${action}`), name })}
                  accessibilityState={{ busy }}
                  onPress={() => onAction(person, action)}
                >
                  {busy ? <Spinner size="sm" /> : (
                    <Ionicons
                      name={action === 'check_in' ? 'log-in-outline' : action === 'check_out' ? 'log-out-outline' : 'person-remove-outline'}
                      size={16}
                      color={action === 'check_in' ? '#fff' : action === 'no_show' ? theme.error : primary}
                    />
                  )}
                  <HeroButton.Label>{t(`attendance.actions.${action}`)}</HeroButton.Label>
                </HeroButton>
              );
            })}
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}
