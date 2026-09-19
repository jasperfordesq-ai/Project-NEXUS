// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from 'heroui-native';
import { Button } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import SearchInput from '@/components/ui/SearchInput';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { getEventPeople, type EventPeopleQuery } from '@/lib/api/eventPeople';
import { isRefusalStatus } from '@/lib/api/refusal';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useEventPeopleOperations } from '@/lib/hooks/useEventPeopleOperations';
import EventPeopleConfirmation from './EventPeopleConfirmation';
import EventPeopleInvitations from './EventPeopleInvitations';
import EventPeopleHistory from './EventPeopleHistory';
import EventPeopleExport from './EventPeopleExport';

const filters = {
  registration_state: ['all', 'none', 'invited', 'pending', 'confirmed', 'declined', 'cancelled'],
  waitlist_state: ['all', 'none', 'active', 'waiting', 'offered', 'accepted', 'expired', 'cancelled'],
  attendance_state: ['all', 'not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show'],
  engagement_state: ['all', 'none', 'interested'],
} as const;
const sorts = [
  ['name', 'asc'], ['name', 'desc'], ['registration_changed', 'desc'], ['queue_rank', 'asc'], ['attendance_changed', 'desc'],
] as const;

/** Organiser roster with explicit, durably recoverable registration changes. */
export default function EventPeopleRoster({ eventId }: { eventId: number }) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return <PeopleRosterContent key={`${tenant?.id}:${user?.id}:${eventId}`} eventId={eventId} />;
}

function PeopleRosterContent({ eventId }: { eventId: number }) {
  const { t } = useTranslation(['events', 'common', 'event_communications']);
  const { user } = useAuth();
  const { tenant } = useTenant();
  const [query, setQuery] = useState<EventPeopleQuery>({ page: 1 });
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showInvitations, setShowInvitations] = useState(false);
  const validId = Number.isSafeInteger(eventId) && eventId > 0;
  const roster = useApi(() => getEventPeople(eventId, query), [eventId, query], { enabled: validId, clearOnRefusal: true });
  const data = roster.data;
  const [selected, setSelected] = useState<number[]>([]);
  const [action, setAction] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [historyTarget, setHistoryTarget] = useState<number | null>(null);
  const permitted = data?.meta.projection === 'full' && data.meta.capabilities.manage_registration === true
    && !roster.isLoading && !roster.error;
  const operation = useEventPeopleOperations({ tenantId: Number(tenant?.id), userId: Number(user?.id), eventId }, Boolean(permitted), () => {
    setSelected([]); setAction(null); roster.refresh();
  });
  useEffect(() => { setSelected([]); setAction(null); setHistoryTarget(null); }, [query]);
  const selectedPeople = (data?.data ?? []).filter(person => selected.includes(person.member.id));
  const staleRegistration = (userId: number, version: number | null) => operation.saved?.status === 'acknowledged'
    && operation.saved.outcomes.some(item => item.userId === userId && item.success && item.version > (version ?? -1));
  const available = (candidate: 'approve' | 'reject' | 'cancel') => selectedPeople.length > 0
    && selectedPeople.length === selected.length && selectedPeople.every(person =>
      candidate in person.management_actions && person.management_actions[candidate as keyof typeof person.management_actions] === true
      && 'version' in person.registration && person.registration.version !== null
      && !staleRegistration(person.member.id, person.registration.version));
  const targets = selectedPeople.map(person => ({ userId: person.member.id,
    version: 'version' in person.registration ? person.registration.version ?? 0 : 0 }));
  const selectable = (data?.data ?? []).filter(person => person.management_actions && 'approve' in person.management_actions
    && (person.management_actions.approve || person.management_actions.reject || person.management_actions.cancel)
    && 'version' in person.registration && person.registration.version !== null
    && !staleRegistration(person.member.id, person.registration.version)).map(person => person.member.id);
  const pageSelected = selectable.length > 0 && selectable.every(id => selected.includes(id));
  const applySearch = () => setQuery(current => ({ ...current, page: 1, search: search.trim() }));
  const p = 'manage.people';
  if (!validId) return <EmptyState icon="warning-outline" title={t('detail.invalidId')} />;
  return (
    <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={roster.isLoading && Boolean(data)} onRefresh={roster.refresh} />}>
      <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t(`${p}.title`)}</Text>
      <SearchInput value={search} onChangeText={value => {
        setSearch(Array.from(value).slice(0, 100).join(''));
        if (!value) setQuery(current => ({ ...current, page: 1, search: undefined }));
      }} placeholder={t(`${p}.search_placeholder`)} clearLabel={t(`${p}.clear_search`)} accessibilityLabel={t(`${p}.search_label`)}
        returnKeyType="search" onSubmitEditing={applySearch} />
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={applySearch}><Button.Label>{t('common:search')}</Button.Label></Button>
        <Button variant="secondary" onPress={() => setShowFilters(value => !value)} accessibilityState={{ expanded: showFilters }}>
          <Button.Label>{t('common:filter')}</Button.Label>
        </Button>
      </View>
      {showFilters ? <View className="gap-3">
        {Object.entries(filters).map(([key, values]) => (
          <View key={key} className="gap-2">
            <Text className="font-semibold text-foreground">{t(`${p}.${key.replace('_state', '')}_filter`)}</Text>
            <ScrollView horizontal contentContainerClassName="gap-2" showsHorizontalScrollIndicator={false}>
              {values.map(value => <Chip key={value} onPress={() => setQuery(current => ({ ...current, [key]: value === 'all' ? null : value, page: 1 }))}
                variant={(query[key as keyof typeof filters] ?? 'all') === value ? 'primary' : 'soft'}
                color={(query[key as keyof typeof filters] ?? 'all') === value ? 'accent' : 'default'}
                accessibilityState={{ selected: (query[key as keyof typeof filters] ?? 'all') === value }}>
                <Chip.Label>{t(`${p}.filter_options.${value}`)}</Chip.Label>
              </Chip>)}
            </ScrollView>
          </View>
        ))}
        <Text className="font-semibold text-foreground">{t(`${p}.sort_label`)}</Text>
        {sorts.map(([sort, direction]) => <Button key={`${sort}_${direction}`} variant="secondary"
          accessibilityState={{ selected: (query.sort ?? 'name') === sort && (query.direction ?? 'asc') === direction }}
          onPress={() => setQuery(current => ({ ...current, sort, direction, page: 1 }))}>
          <Button.Label>{t(`${p}.sorts.${sort}_${direction}`)}</Button.Label>
        </Button>)}
      </View> : null}
      <RefreshFailedNotice error={data ? roster.error : null} onRetry={roster.refresh} isRetrying={roster.isLoading} />
      {data?.meta.capabilities?.export_people ? <EventPeopleExport key={JSON.stringify(query)} eventId={eventId} query={query}
        total={data.meta.total} disabled={roster.isLoading || Boolean(roster.error) || operation.busy || operation.saved?.status === 'pending'} /> : null}
      {data?.meta.projection === 'full' && data.meta.capabilities.manage_registration ? <View className="gap-2">
        <Button variant="secondary" isDisabled={operation.busy} accessibilityState={{ expanded: showInvitations }} onPress={() => setShowInvitations(value => !value)}>
          <Button.Label>{t(`${p}.invite_title`)}</Button.Label>
        </Button>
        {showInvitations ? <EventPeopleInvitations blocked={operation.blocked} onInvite={intent => operation.submit(intent)} /> : null}
      </View> : null}
      {data?.meta.projection === 'full' && data.meta.capabilities.manage_registration && (operation.storageFailed || operation.saved?.status === 'pending') ? <Card variant="secondary"><Card.Body className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-semibold text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_title' : 'recovery_title'}`)}</Text>
        <Text className="text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'}`)}</Text>
        {operation.operationFailed ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">{t(`${p}.action_error`)}</Text> : null}
        <Button isDisabled={operation.busy || !permitted} onPress={() => {
          if (operation.storageFailed) void operation.reload();
          else void operation.submit().catch(() => undefined);
        }}><Button.Label>{t(`event_communications:${operation.storageFailed ? 'recovery_reload' : 'recovery_button'}`)}</Button.Label></Button>
      </Card.Body></Card> : null}
      {data?.meta.projection === 'full' && data.meta.capabilities.manage_registration && operation.saved?.status === 'acknowledged' ? <View className="gap-2" accessibilityLiveRegion="polite">
        <Text className="text-foreground">{t(`${p}.action_success`, { count: operation.saved.outcomes.filter(item => item.success).length })}</Text>
        {operation.saved.outcomes.filter(item => !item.success).map(item => <Text key={item.userId} className="text-danger">
          {data.data.find(person => person.member.id === item.userId)?.member.display_name ?? t(`${p}.member_fallback`, { id: item.userId })}: {t(`${p}.action_error`)}
        </Text>)}
      </View> : null}
      {data?.meta.projection === 'full' && data.meta.capabilities.manage_registration && selectable.length > 0 ?
        <Button variant="secondary" isDisabled={operation.blocked} accessibilityState={{ selected: pageSelected }} onPress={() => {
          setAction(null); setSelected(pageSelected ? [] : selectable);
        }}><Button.Label>{t(`${p}.select_page`)}</Button.Label></Button> : null}
      {selected.length > 0 && data ? <View className="gap-2">
        <Text className="text-foreground">{t(`${p}.selected_count`, { count: selected.length })}</Text>
        <View className="flex-row flex-wrap gap-2">{(['approve', 'reject', 'cancel'] as const).map(candidate =>
          <Button key={candidate} variant="secondary" isDisabled={operation.blocked || !available(candidate)} onPress={() => setAction(candidate)}>
            <Button.Label>{t(`${p}.actions.${candidate}`)}</Button.Label>
          </Button>)}</View>
        {action ? <EventPeopleConfirmation action={action} targets={targets} disabled={operation.blocked || !available(action)}
          onConfirm={intent => operation.submit(intent)} onCancel={() => setAction(null)} /> : null}
      </View> : null}
      {roster.isLoading && !data ? <LoadingSpinner /> : isRefusalStatus(roster.errorStatus) ? (
        <EmptyState icon="lock-closed-outline" title={t('manage.access_denied_title')} testID="event-people-refused" />
      ) : !data ? <EmptyState icon="warning-outline" title={t(`${p}.load_error_title`)} subtitle={roster.error ?? undefined}
        actionLabel={t('common:buttons.retry')} onAction={roster.refresh} /> : data.data.length === 0 ? (
        <EmptyState icon="people-outline" title={t(`${p}.empty`)} />
      ) : data.data.map(person => (
        <Card key={person.member.id} variant="secondary"><Card.Body className="gap-2 p-4">
          <Text className="text-base font-semibold text-foreground">{person.member.display_name ?? t(`${p}.member_fallback`, { id: person.member.id })}</Text>
          {data.meta.projection === 'full' && data.meta.capabilities.manage_registration
            && 'approve' in person.management_actions && (person.management_actions.approve || person.management_actions.reject || person.management_actions.cancel) ?
            <Button variant="secondary" isDisabled={operation.blocked || staleRegistration(person.member.id, 'version' in person.registration ? person.registration.version : null)} accessibilityState={{ selected: selected.includes(person.member.id) }} onPress={() => {
              setAction(null);
              setSelected(current => current.includes(person.member.id) ? current.filter(id => id !== person.member.id) : [...current, person.member.id]);
            }}><Button.Label>{t(`${p}.select_member`, { name: person.member.display_name ?? t(`${p}.member_fallback`, { id: person.member.id }) })}</Button.Label></Button> : null}
          <Text className="text-foreground">{t(`${p}.columns.registration`)}: {t(`${p}.states.registration.${person.registration.state ?? 'none'}`)}</Text>
          {'waitlist' in person ? <Text className="text-foreground">{t(`${p}.columns.waitlist`)}: {t(`${p}.states.waitlist.${person.waitlist.state ?? 'none'}`)}
            {person.waitlist.position ? ` · ${t(`${p}.queue_position`, { position: person.waitlist.position })}` : ''}</Text> : null}
          <Text className="text-foreground">{t(`${p}.columns.attendance`)}: {t(`${p}.states.attendance.${person.attendance.state}`)}</Text>
          {data.meta.capabilities?.view_history ? <Button variant="secondary" onPress={() => setHistoryTarget(person.member.id)}>
            <Button.Label>{t(`${p}.actions.history`)}</Button.Label></Button> : null}
          {data.meta.capabilities?.view_history && historyTarget === person.member.id ? <EventPeopleHistory eventId={eventId} userId={person.member.id}
            name={person.member.display_name ?? t(`${p}.member_fallback`, { id: person.member.id })} onClose={() => setHistoryTarget(null)} /> : null}
        </Card.Body></Card>
      ))}
      {data ? <View className="gap-2" accessibilityLabel={t(`${p}.pagination_aria`)}>
        <Text className="text-muted-foreground" accessibilityLiveRegion="polite">{t(`${p}.pagination_summary`, {
          start: data.data.length ? (data.meta.current_page - 1) * data.meta.per_page + 1 : 0,
          end: data.data.length ? (data.meta.current_page - 1) * data.meta.per_page + data.data.length : 0,
          total: data.meta.total,
        })}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Button variant="secondary" isDisabled={roster.isLoading || data.meta.current_page <= 1} onPress={() => setQuery(current => ({ ...current, page: data.meta.current_page - 1 }))}><Button.Label>{t('attendance.previous')}</Button.Label></Button>
          <Button variant="secondary" isDisabled={roster.isLoading || !data.meta.has_more || data.meta.current_page >= 400} onPress={() => setQuery(current => ({ ...current, page: Math.min(400, data.meta.current_page + 1) }))}><Button.Label>{t('attendance.next')}</Button.Label></Button>
        </View>
      </View> : null}
    </ScrollView>
  );
}
