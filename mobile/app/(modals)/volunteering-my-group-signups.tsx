// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group sign-ups — a group leader reserves places on a shift and adds the people coming.
 *
 * 🔴 ALPHA, and OFF everywhere unless an admin opts the community in
 * (`volunteering.tab_group_signups`, owner decision 2026-10-06). `volunteerSwitchOn`
 * reads an absent key as off for this one switch alone.
 *
 * What the server offers, and therefore what this screen offers (read 2026-10-08):
 * reserve (`shifts/{id}/group-reserve`), add a member, remove a member, cancel — all for
 * the leader or a group manager. There is NO endpoint for a member to leave: the remove
 * route refuses a non-leader even for their own row. So a member sees who to ask rather
 * than a button that cannot work. Members added here are not told, cannot check in and
 * earn no hours yet; the screen says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import AccentIcon from '@/components/ui/AccentIcon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { withRouteGate } from '@/components/withRouteGate';
import { describeApiError } from '@/lib/api/describeApiError';
import { getMembers, type Member } from '@/lib/api/members';
import { getOpportunities, getOpportunityShifts, type VolunteerShift } from '@/lib/api/volunteering';
import {
  addGroupReservationMember,
  cancelGroupReservation,
  getGroupReservations,
  getMyGroupsForReservation,
  leadableGroups,
  removeGroupReservationMember,
  reserveGroupPlaces,
  volunteerSwitchOn,
  type GroupReservation,
  type LeadableGroup,
} from '@/lib/api/volunteeringVolunteer';
import * as Haptics from '@/lib/haptics';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';

const VOLUNTEERING_HUB = '/(modals)/volunteering' as Href;
const SEARCH_MIN = 2;
const SEARCH_DEBOUNCE_MS = 300;

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

function statusKey(status: string): 'active' | 'confirmed' | 'pending' | 'cancelled' | 'completed' {
  return status === 'confirmed' || status === 'pending' || status === 'cancelled' || status === 'completed' ? status : 'active';
}

function memberStatusKey(status: string): 'confirmed' | 'cancelled' | 'pending' | 'declined' {
  return status === 'cancelled' || status === 'pending' || status === 'declined' ? status : 'confirmed';
}

function MyGroupSignupsScreen() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? 'no-tenant'}:${user?.id ?? 'no-user'}`}>
      <MyGroupSignupsContent />
    </ModalErrorBoundary>
  );
}

function MyGroupSignupsContent() {
  const { t } = useTranslation(['volunteeringVolunteer', 'common']);
  const { tenant } = useTenant();
  const { user } = useAuth();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const switchedOn = volunteerSwitchOn(tenant?.volunteering_config, 'tab_group_signups');

  const listApi = useApi(() => getGroupReservations(), [], { enabled: switchedOn });
  const reservations: GroupReservation[] = Array.isArray(listApi.data?.data) ? listApi.data.data : [];

  const [busyId, setBusyId] = useState<number | null>(null);
  const pending = useRef(false);

  // ---- reserve sheet ----------------------------------------------------------------
  const [reserveOpen, setReserveOpen] = useState(false);
  const [groups, setGroups] = useState<LeadableGroup[] | null>(null);
  const [opportunities, setOpportunities] = useState<{ id: number; title: string }[] | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [shifts, setShifts] = useState<VolunteerShift[] | null>(null);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState('');
  const [slots, setSlots] = useState('1');
  const [notes, setNotes] = useState('');
  const [reserving, setReserving] = useState(false);
  const shiftsRequest = useRef(0);

  async function openReserve() {
    setReserveOpen(true);
    setGroupId('');
    setOpportunityId('');
    setShiftId('');
    setShifts(null);
    setSlots('1');
    setNotes('');
    setOptionsError(null);
    setGroups(null);
    setOpportunities(null);
    try {
      const [groupsResponse, opportunitiesResponse] = await Promise.all([
        getMyGroupsForReservation(),
        getOpportunities(null),
      ]);
      const mine = leadableGroups(groupsResponse, user?.id ?? null);
      setGroups(mine);
      setOpportunities((opportunitiesResponse?.data ?? []).map((item) => ({ id: item.id, title: item.title })));
      if (mine.length === 1) setGroupId(String(mine[0]!.id));
    } catch (err) {
      setGroups([]);
      setOpportunities([]);
      setOptionsError(describeApiError(err, t('volunteeringVolunteer:group.optionsError')));
    }
  }

  async function chooseOpportunity(value: string) {
    setOpportunityId(value);
    setShiftId('');
    setShifts(null);
    setShiftsError(null);
    const request = ++shiftsRequest.current;
    try {
      const response = await getOpportunityShifts(Number(value));
      if (request !== shiftsRequest.current) return;
      const now = Date.now();
      setShifts((response?.data ?? []).filter((shift) => new Date(shift.start_time).getTime() > now));
    } catch (err) {
      if (request !== shiftsRequest.current) return;
      setShifts([]);
      setShiftsError(describeApiError(err, t('volunteeringVolunteer:group.shiftsError')));
    }
  }

  function warn(description: string) {
    showToast({ title: t('common:errors.alertTitle'), description, variant: 'warning' });
  }

  async function submitReserve() {
    if (pending.current) return;
    if (!groupId || !shiftId || slots.trim() === '') return warn(t('volunteeringVolunteer:group.reserveValidation'));
    const count = Number(slots.trim());
    if (!Number.isInteger(count) || count < 1) return warn(t('volunteeringVolunteer:group.slotsInvalid'));
    pending.current = true;
    setReserving(true);
    try {
      await reserveGroupPlaces(Number(shiftId), { group_id: Number(groupId), reserved_slots: count, notes: notes.trim() || undefined });
      setReserveOpen(false);
      listApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:group.reservedTitle'), description: t('volunteeringVolunteer:group.reservedBody'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:group.reserveError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setReserving(false);
    }
  }

  // ---- add member sheet -------------------------------------------------------------
  const [addFor, setAddFor] = useState<GroupReservation | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Member[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequest = useRef(0);

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const runSearch = useCallback(async (text: string) => {
    const request = ++searchRequest.current;
    try {
      const response = await getMembers(0, text);
      if (request !== searchRequest.current) return;
      setResults(response.data ?? []);
      setSearchError(null);
    } catch (err) {
      if (request !== searchRequest.current) return;
      setResults([]);
      setSearchError(describeApiError(err, t('volunteeringVolunteer:group.searchError')));
    }
  }, [t]);

  function handleQuery(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const text = value.trim();
    if (text.length < SEARCH_MIN) {
      searchRequest.current += 1;
      setResults(null);
      setSearchError(null);
      return;
    }
    searchTimer.current = setTimeout(() => { void runSearch(text); }, SEARCH_DEBOUNCE_MS);
  }

  function openAdd(reservation: GroupReservation) {
    setAddFor(reservation);
    setQuery('');
    setResults(null);
    setSearchError(null);
  }

  async function addMember(member: Member) {
    if (!addFor || pending.current) return;
    pending.current = true;
    setAdding(member.id);
    try {
      await addGroupReservationMember(addFor.id, member.id);
      setAddFor(null);
      listApi.refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:group.addedTitle'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:group.addError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setAdding(null);
    }
  }

  // ---- remove / cancel --------------------------------------------------------------
  function askRemove(reservation: GroupReservation, member: GroupReservation['members'][number]) {
    confirm({
      title: t('volunteeringVolunteer:group.removeConfirmTitle', { name: member.name }),
      message: t('volunteeringVolunteer:group.removeConfirmMessage'),
      confirmLabel: t('volunteeringVolunteer:group.removeMember'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: `group-confirm-remove-${reservation.id}-${member.id}`,
      onConfirm: () => runRemove(reservation, member.id),
    });
  }

  async function runRemove(reservation: GroupReservation, userId: number) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(reservation.id);
    try {
      await removeGroupReservationMember(reservation.id, userId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:group.removeError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setBusyId(null);
      listApi.refresh();
    }
  }

  function askCancel(reservation: GroupReservation) {
    confirm({
      title: t('volunteeringVolunteer:group.cancelConfirmTitle'),
      message: t('volunteeringVolunteer:group.cancelConfirmMessage'),
      confirmLabel: t('volunteeringVolunteer:group.cancel'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: `group-confirm-cancel-${reservation.id}`,
      onConfirm: () => runCancel(reservation),
    });
  }

  async function runCancel(reservation: GroupReservation) {
    if (pending.current) return;
    pending.current = true;
    setBusyId(reservation.id);
    try {
      await cancelGroupReservation(reservation.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('volunteeringVolunteer:group.cancelledTitle'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('volunteeringVolunteer:group.cancelError')), variant: 'danger' });
    } finally {
      pending.current = false;
      setBusyId(null);
      listApi.refresh();
    }
  }

  if (!switchedOn) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('volunteeringVolunteer:group.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
        <EmptyState
          icon="people-outline"
          title={t('volunteeringVolunteer:unavailable.title')}
          subtitle={t('volunteeringVolunteer:unavailable.body')}
          actionLabel={t('volunteeringVolunteer:unavailable.back')}
          onAction={() => router.push(VOLUNTEERING_HUB)}
          testID="group-switched-off"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      {confirmDialog}
      <AppTopBar title={t('volunteeringVolunteer:group.title')} backLabel={t('common:back')} fallbackHref={VOLUNTEERING_HUB} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}
        refreshControl={(
          <RefreshControl refreshing={listApi.isLoading && reservations.length > 0} onRefresh={listApi.refresh} tintColor={primary} colors={[primary]} />
        )}
      >
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:group.intro')}</Text>
        <Surface variant="secondary" className="flex-row items-start gap-2 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: withAlpha(theme.warning, 0.3) }}>
          <Ionicons name="flask-outline" size={16} color={theme.warning} />
          <Text className="min-w-0 flex-1 text-xs leading-4" style={{ color: theme.text }}>{t('volunteeringVolunteer:group.alpha')}</Text>
        </Surface>

        <HeroButton onPress={() => void openReserve()} testID="group-reserve">
          <AccentIcon name="add-outline" size={16} />
          <HeroButton.Label>{t('volunteeringVolunteer:group.reserve')}</HeroButton.Label>
        </HeroButton>

        <RefreshFailedNotice error={listApi.error} onRetry={listApi.refresh} isRetrying={listApi.isLoading} testID="group-error" />

        {listApi.isLoading && reservations.length === 0 && !listApi.error ? <ListSkeleton rows={2} testID="group-skeleton" /> : null}

        {!listApi.isLoading && !listApi.error && reservations.length === 0 ? (
          <EmptyState icon="people-outline" title={t('volunteeringVolunteer:group.empty')} testID="group-empty" />
        ) : null}

        {reservations.map((reservation) => {
          const key = statusKey(reservation.status);
          const tone = key === 'cancelled' ? theme.textMuted : key === 'pending' ? theme.warning : theme.success;
          const live = key !== 'cancelled' && key !== 'completed';
          const members = reservation.members ?? [];
          const activeMembers = members.filter((member) => memberStatusKey(member.status) !== 'cancelled');
          const full = typeof reservation.max_members === 'number' && activeMembers.length >= reservation.max_members;
          const date = formatDate(reservation.shift?.start_time);
          const start = formatTime(reservation.shift?.start_time);
          const end = formatTime(reservation.shift?.end_time);
          const busy = busyId === reservation.id;
          return (
            <HeroCard key={reservation.id} className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.25), opacity: live ? 1 : 0.75 }} testID={`group-reservation-${reservation.id}`}>
              <View className="h-1" style={{ backgroundColor: tone }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className={`${largeText ? '' : 'flex-row items-start justify-between'} gap-3`} style={largeText ? { flexDirection: 'column' } : undefined}>
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 2}>{reservation.group_name}</Text>
                    <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={largeText ? 0 : 2}>
                      {[reservation.opportunity?.title, reservation.organization?.name].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {reservation.is_leader ? (
                      <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default">
                        <Ionicons name="star-outline" size={12} color={primary} />
                        <Chip.Label>{t('volunteeringVolunteer:group.leader')}</Chip.Label>
                      </Chip>
                    ) : null}
                    <Chip size={largeText ? 'md' : 'sm'} variant="secondary" color="default">
                      <Ionicons name="ellipse" size={9} color={tone} />
                      <Chip.Label>{t(`volunteeringVolunteer:group.status.${key}`)}</Chip.Label>
                    </Chip>
                  </View>
                </View>

                <Text className="text-sm" style={{ color: theme.text }}>
                  {date ?? t('volunteeringVolunteer:common.dateUnknown')}
                  {start && end ? ` · ${t('volunteeringVolunteer:common.timeRange', { start, end })}` : ''}
                </Text>
                <Text className="text-xs" style={{ color: theme.textMuted }}>
                  {[reservation.opportunity?.location, t('volunteeringVolunteer:group.created', { date: formatDate(reservation.created_at) ?? '' })].filter(Boolean).join(' · ')}
                </Text>

                <View className="gap-2">
                  <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                    {typeof reservation.max_members === 'number'
                      ? t('volunteeringVolunteer:group.members', { count: activeMembers.length, max: reservation.max_members })
                      : t('volunteeringVolunteer:group.membersNoMax', { count: activeMembers.length })}
                  </Text>
                  {members.map((member) => {
                    const memberKey = memberStatusKey(member.status);
                    return (
                      <View key={member.id} className="flex-row items-center gap-3" testID={`group-member-${reservation.id}-${member.id}`}>
                        <Avatar uri={member.avatar_url ?? undefined} name={member.name} size={28} decorative />
                        <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.text }} numberOfLines={largeText ? 0 : 1}>{member.name}</Text>
                        <Text className="text-xs" style={{ color: memberKey === 'confirmed' ? theme.success : theme.textMuted }}>
                          {t(`volunteeringVolunteer:group.memberStatus.${memberKey}`)}
                        </Text>
                        {reservation.is_leader && live && memberKey !== 'cancelled' ? (
                          <HeroButton
                            size="sm"
                            variant="danger-soft"
                            isDisabled={busyId !== null}
                            onPress={() => askRemove(reservation, member)}
                            testID={`group-remove-${reservation.id}-${member.id}`}
                            accessibilityLabel={t('volunteeringVolunteer:group.removeLabel', { name: member.name })}
                          >
                            <HeroButton.Label>{t('volunteeringVolunteer:group.removeMember')}</HeroButton.Label>
                          </HeroButton>
                        ) : null}
                      </View>
                    );
                  })}
                </View>

                {reservation.is_leader && live ? (
                  <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
                    <HeroButton
                      className={largeText ? 'w-full' : 'flex-1'}
                      size={largeText ? 'md' : 'sm'}
                      variant="secondary"
                      isDisabled={busyId !== null || full}
                      onPress={() => openAdd(reservation)}
                      testID={`group-add-member-${reservation.id}`}
                    >
                      <Ionicons name="person-add-outline" size={16} color={primary} />
                      <HeroButton.Label>{full ? t('volunteeringVolunteer:group.full') : t('volunteeringVolunteer:group.addMember')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton
                      className={largeText ? 'w-full' : 'flex-1'}
                      size={largeText ? 'md' : 'sm'}
                      variant="danger-soft"
                      isDisabled={busyId !== null}
                      onPress={() => askCancel(reservation)}
                      testID={`group-cancel-${reservation.id}`}
                      accessibilityState={{ busy }}
                    >
                      {busy ? <Spinner size="sm" /> : null}
                      <HeroButton.Label>{t('volunteeringVolunteer:group.cancel')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                ) : null}

                {!reservation.is_leader && live ? (
                  <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} testID={`group-member-notice-${reservation.id}`}>
                    {t('volunteeringVolunteer:group.memberNotice')}
                  </Text>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          );
        })}
      </ScrollView>

      <BottomSheet visible={reserveOpen} onClose={() => { if (!reserving) setReserveOpen(false); }} dismissible={!reserving} scrollable title={t('volunteeringVolunteer:group.reserveTitle')}>
        <View className="gap-4 p-4">
          {groups === null || opportunities === null ? (
            <ListSkeleton rows={2} testID="group-options-skeleton" />
          ) : (
            <>
              {optionsError ? <Text className="text-sm" style={{ color: theme.error }}>{optionsError}</Text> : null}
              {groups.length === 0 ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} testID="group-no-groups">{t('volunteeringVolunteer:group.noGroups')}</Text>
              ) : (
                <ChoiceChips
                  label={t('volunteeringVolunteer:group.groupLabel')}
                  options={groups.map((group) => ({ value: String(group.id), label: group.name }))}
                  selected={groupId}
                  onSelect={(value) => { if (value) setGroupId(value); }}
                  testID="group-pick-group"
                />
              )}
              <ChoiceChips
                label={t('volunteeringVolunteer:group.opportunityLabel')}
                options={opportunities.map((item) => ({ value: String(item.id), label: item.title }))}
                selected={opportunityId}
                onSelect={(value) => { if (value) void chooseOpportunity(value); }}
                testID="group-pick-opportunity"
              />
              {opportunityId ? (
                shifts === null ? (
                  <ListSkeleton rows={1} testID="group-shifts-skeleton" />
                ) : shiftsError ? (
                  <Text className="text-sm" style={{ color: theme.error }}>{shiftsError}</Text>
                ) : shifts.length === 0 ? (
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:group.shiftsEmpty')}</Text>
                ) : (
                  <ChoiceChips
                    label={t('volunteeringVolunteer:group.shiftLabel')}
                    options={shifts.map((shift) => {
                      const shiftDate = formatDate(shift.start_time) ?? '';
                      const spots = typeof shift.spots_available === 'number' ? ` · ${t('volunteeringVolunteer:group.spots', { count: shift.spots_available })}` : '';
                      return { value: String(shift.id), label: `${shiftDate} ${formatTime(shift.start_time) ?? ''}${spots}`.trim() };
                    })}
                    selected={shiftId}
                    onSelect={(value) => { if (value) setShiftId(value); }}
                    testID="group-pick-shift"
                  />
                )
              ) : null}
              <Input
                label={t('volunteeringVolunteer:group.slotsLabel')}
                value={slots}
                onChangeText={setSlots}
                keyboardType="number-pad"
                accessibilityLabel={t('volunteeringVolunteer:group.slotsLabel')}
                editable={!reserving}
                testID="group-slots"
              />
              <Input
                label={t('volunteeringVolunteer:group.notesLabel')}
                value={notes}
                onChangeText={setNotes}
                multiline
                className="min-h-[72px] text-base"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                accessibilityLabel={t('volunteeringVolunteer:group.notesLabel')}
                editable={!reserving}
                testID="group-notes"
              />
              <View className={`${largeText ? '' : 'flex-row'} gap-2`} style={largeText ? { flexDirection: 'column' } : undefined}>
                <HeroButton className={largeText ? 'w-full' : 'flex-1'} variant="secondary" isDisabled={reserving} onPress={() => setReserveOpen(false)}>
                  <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className={largeText ? 'w-full' : 'flex-1'} isDisabled={reserving || groups.length === 0} onPress={() => void submitReserve()} testID="group-reserve-submit" accessibilityState={{ busy: reserving }}>
                  {reserving ? <Spinner size="sm" /> : null}
                  <HeroButton.Label>{t('volunteeringVolunteer:group.reserveSubmit')}</HeroButton.Label>
                </HeroButton>
              </View>
            </>
          )}
        </View>
      </BottomSheet>

      <BottomSheet visible={addFor !== null} onClose={() => { if (adding === null) setAddFor(null); }} dismissible={adding === null} scrollable title={t('volunteeringVolunteer:group.addMemberTitle')}>
        <View className="gap-3 p-4">
          <Input
            value={query}
            onChangeText={handleQuery}
            placeholder={t('volunteeringVolunteer:group.searchPlaceholder')}
            placeholderTextColor={theme.textMuted}
            helper={t('volunteeringVolunteer:group.searchHint')}
            autoCorrect={false}
            autoCapitalize="words"
            accessibilityLabel={t('volunteeringVolunteer:group.searchPlaceholder')}
            editable={adding === null}
            testID="group-member-search"
          />
          {searchError ? <Text className="text-sm" style={{ color: theme.error }}>{searchError}</Text> : null}
          {results && results.length === 0 && !searchError ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('volunteeringVolunteer:group.searchEmpty')}</Text>
          ) : null}
          {results?.map((member) => (
            <HeroButton
              key={member.id}
              variant="secondary"
              className="justify-start"
              isDisabled={adding !== null}
              onPress={() => void addMember(member)}
              testID={`group-member-pick-${member.id}`}
              accessibilityLabel={t('volunteeringVolunteer:group.addLabel', { name: member.name || member.first_name })}
              accessibilityState={{ busy: adding === member.id }}
            >
              {adding === member.id ? <Spinner size="sm" /> : <Avatar uri={member.avatar ?? member.avatar_url ?? undefined} name={member.name || member.first_name} size={24} decorative />}
              <HeroButton.Label>{member.name || member.first_name}</HeroButton.Label>
            </HeroButton>
          ))}
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

export default withRouteGate(MyGroupSignupsScreen, 'volunteering-my-group-signups');
