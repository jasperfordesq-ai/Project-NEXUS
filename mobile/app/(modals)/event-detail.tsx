// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';

import {
  acceptEventWaitlistOffer,
  getEvent,
  getEventAgenda,
  getEventAttendees,
  getEventOnlineLink,
  getEventPolls,
  getEventRecurrenceCapabilities,
  getEventReminders,
  deleteEventReminders,
  joinEventWaitlist,
  leaveEventWaitlist,
  removeRsvp,
  rsvpEvent,
  publishEvent,
  submitEventForReview,
  updateEventReminders,
  voteEventPoll,
} from '@/lib/api/events';
import type {
  CanonicalEvent,
  EventAgenda,
  EventAttendee,
  EventMetrics,
  EventPoll,
  EventRelationship,
  EventReminderPreferences,
  EventReminderRule,
} from '@/lib/api/events';
import { ApiResponseError } from '@/lib/api/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import Avatar from '@/components/ui/Avatar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatEventSchedule } from '@/lib/utils/eventDateTime';
import EventSafetyCard from '@/components/events/EventSafetyCard';
import { EventAnalyticsSummaryCard } from '@/components/events/EventAnalyticsSummaryCard';
import EventCheckinCredentialCard from '@/components/events/EventCheckinCredentialCard';
import EventRegistrationPanel from '@/components/events/EventRegistrationPanel';
import { EventAgendaEnterprisePanel } from '@/components/events/EventAgendaEnterprisePanel';
import {
  canUseRecurrenceDefinitionBlueprints,
  isRecurrenceDefinitionBlueprintCandidate,
} from '@/lib/events/recurrenceBlueprints';

const WEB_URL = 'https://app.project-nexus.ie';
const REMINDER_OPTIONS = [60, 1440, 10080] as const;

function eventMutationKey(action: 'accept-offer', eventId: number): string {
  return `${action}-${eventId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function EventDetailScreen() {
  return (
    <ModalErrorBoundary>
      <EventDetailScreenInner />
    </ModalErrorBoundary>
  );
}

function EventDetailScreenInner() {
  const { t } = useTranslation([
    'events',
    'common',
    'event_templates',
    'event_tickets',
    'event_communications',
    'event_recurrence_blueprints',
  ]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const eventId = Number(id);
  const safeEventId = Number.isFinite(eventId) && eventId > 0 ? eventId : 0;
  const { data, isLoading, refresh } = useApi(() => getEvent(safeEventId), [safeEventId], { enabled: safeEventId > 0 });
  const remindersApi = useApi(() => getEventReminders(safeEventId), [safeEventId], { enabled: safeEventId > 0 && !!user });
  const event = data?.data ?? null;
  const canLoadRoster = Boolean(event?.permissions.manage_people);
  const attendeesApi = useApi(
    () => getEventAttendees(safeEventId, { perPage: 50, status: 'all' }),
    [safeEventId, canLoadRoster],
    { enabled: safeEventId > 0 && canLoadRoster },
  );
  const pollsApi = useApi(() => getEventPolls(safeEventId), [safeEventId], { enabled: safeEventId > 0 });
  const agendaApi = useApi(
    () => getEventAgenda(safeEventId),
    [safeEventId, event?.id, Boolean(user)],
    { enabled: safeEventId > 0 && event?.id === safeEventId && !!user },
  );

  const [relationship, setRelationship] = useState<EventRelationship | null>(null);
  const [metrics, setMetrics] = useState<EventMetrics | null>(null);
  const [updating, setUpdating] = useState(false);
  const [safetyRefreshSignal, setSafetyRefreshSignal] = useState(0);
  const [analyticsRefreshSignal, setAnalyticsRefreshSignal] = useState(0);
  const [registrationRefreshSignal, setRegistrationRefreshSignal] = useState(0);
  const acceptOfferMutationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setRelationship(null);
    setMetrics(null);
    acceptOfferMutationKeyRef.current = null;
  }, [safeEventId]);

  if (safeEventId <= 0) {
    return (
      <ScreenShell title={t('detailTitle')} backLabel={t('detail.goBack')}>
        <CenteredState text={t('detail.invalidId')} />
      </ScreenShell>
    );
  }

  if (isLoading && !event) {
    return (
      <ScreenShell title={t('detailTitle')} backLabel={t('detail.goBack')}>
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      </ScreenShell>
    );
  }

  if (!event) {
    return (
      <ScreenShell title={t('detailTitle')} backLabel={t('detail.goBack')}>
        <CenteredState text={t('detail.notFound')} />
      </ScreenShell>
    );
  }

  const currentRelationship = relationship ?? event.relationship;
  const currentMetrics = metrics ?? event.metrics;
  const currentRsvp = currentRelationship.registration.state === 'confirmed'
    ? 'going'
    : currentRelationship.engagement.state === 'interested'
      ? 'interested'
      : null;
  const counts = {
    going: currentMetrics.confirmed_count,
    interested: currentMetrics.interested_count,
  };
  const formattedSchedule = formatEventSchedule(event.schedule, dateLocale());
  const dateStr = formattedSchedule.dateLabel ?? '-';
  const timeStr = formattedSchedule.allDay
    ? t('allDay')
    : formattedSchedule.timeLabel ?? '-';
  const accent = event.category?.colour ?? '#F59E0B';
  const coverImage = resolveImageUrl(event.primary_image?.url);
  const lifecycleChip = event.schedule.publication_state === 'archived'
    ? { label: t('archived'), color: 'default' as const }
    : event.schedule.publication_state === 'pending_review'
      ? { label: t('pendingReview'), color: 'warning' as const }
      : event.schedule.publication_state === 'draft'
        ? { label: t('draft'), color: 'default' as const }
        : event.schedule.operational_state === 'cancelled'
          ? { label: t('cancelled'), color: 'danger' as const }
          : event.schedule.operational_state === 'postponed'
            ? { label: t('postponed'), color: 'warning' as const }
            : event.schedule.operational_state === 'completed'
              ? { label: t('completed'), color: 'success' as const }
              : null;
  const onlineLink = getEventOnlineLink(event);
  const attendeeData = Array.isArray(attendeesApi.data?.data) ? attendeesApi.data.data : [];
  const attendees = attendeeData;
  const currentWaitlistPosition = currentRelationship.registration.waitlist_position;
  const hasActiveWaitlistOffer = currentRelationship.registration.state === 'offered';
  const hasWaitlistAction = currentRelationship.registration.can_join_waitlist
    || currentRelationship.registration.can_leave_waitlist;
  const showGoingAction = !hasActiveWaitlistOffer && (currentRelationship.registration.can_register
    || currentRelationship.registration.can_withdraw
    || currentRsvp === 'going');
  const showInterestedAction = !hasActiveWaitlistOffer && (currentRelationship.engagement.can_change
    || currentRsvp === 'interested');
  const hasParticipationActions = currentRelationship.registration.can_register
    || currentRelationship.registration.can_withdraw
    || currentRelationship.engagement.can_change
    || hasWaitlistAction
    || hasActiveWaitlistOffer;
  const canOpenTickets = Boolean(user && (
    currentRelationship.registration.state === 'confirmed'
    || event.permissions.edit
    || event.permissions.manage_registration
  ));
  const footerBottomPadding = Math.max(16, insets.bottom + 12);
  const footerReservedSpace = hasParticipationActions
    ? footerBottomPadding + (hasActiveWaitlistOffer ? 176 : hasWaitlistAction ? 124 : 88)
    : 24;

  async function handleShare() {
    if (!event) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: t('detail.shareMessage', { title: event.title, url: `${WEB_URL}/events/${event.id}` }),
      });
    } catch {
      // User cancelled native share.
    }
  }

  async function handleRsvp(status: 'going' | 'interested') {
    if (!event) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (currentRsvp === status) {
      confirm({
        title: t('common:buttons.confirm'),
        message: t('confirmCancelRsvp'),
        confirmLabel: t('common:yes'),
        cancelLabel: t('common:no'),
        variant: 'danger',
        onConfirm: async () => {
          setUpdating(true);
          try {
            await removeRsvp(event.id);
            setRelationship(null);
            setMetrics(null);
            refresh();
          } catch {
            showToast({ title: t('common:errors.alertTitle'), description: t('rsvpError'), variant: 'danger' });
          } finally {
            setUpdating(false);
          }
        },
      });
      return;
    }

    setUpdating(true);
    try {
      const result = await rsvpEvent(event.id, status);
      setRelationship(result.data.relationship);
      setMetrics(result.data.metrics);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('rsvpError'), variant: 'danger' });
    } finally {
      setUpdating(false);
    }
  }

  function openEditEvent() {
    if (!event) return;
    router.push({ pathname: '/(modals)/edit-event', params: { id: String(event.id) } } as unknown as Href);
  }

  function openAttendanceWorkspace() {
    if (!event) return;
    router.push({ pathname: '/(modals)/event-attendance', params: { id: String(event.id) } } as unknown as Href);
  }

  function openEventTemplates() {
    router.push('/(modals)/event-templates' as Href);
  }

  function openEventLifecycleHistory() {
    if (!event) return;
    router.push({
      pathname: '/(modals)/event-lifecycle-history',
      params: { id: String(event.id) },
    } as unknown as Href);
  }

  function openEventTickets() {
    if (!event) return;
    router.push({ pathname: '/(modals)/event-tickets', params: { id: String(event.id) } } as unknown as Href);
  }

  function openEventCommunications() {
    if (!event) return;
    router.push({ pathname: '/(modals)/event-communications', params: { id: String(event.id) } } as unknown as Href);
  }

  function handleRefresh() {
    refresh();
    setSafetyRefreshSignal((value) => value + 1);
    setAnalyticsRefreshSignal((value) => value + 1);
    setRegistrationRefreshSignal((value) => value + 1);
    remindersApi.refresh();
    attendeesApi.refresh();
    pollsApi.refresh();
    agendaApi.refresh();
  }

  async function changeWaitlist(leaving: boolean) {
    if (!event || updating) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUpdating(true);
    try {
      if (leaving) {
        await leaveEventWaitlist(event.id);
        refresh();
        return;
      }

      await joinEventWaitlist(event.id);
      refresh();
    } catch {
      showToast({
        title: t('common:errors.alertTitle'),
        description: t(leaving
          ? hasActiveWaitlistOffer
            ? 'detail.offerDeclineError'
            : 'detail.leaveWaitlistError'
          : 'detail.joinWaitlistError'),
        variant: 'danger',
      });
    } finally {
      setUpdating(false);
    }
  }

  function handlePublication(action: 'submit_for_review' | 'publish') {
    if (!event || updating) return;
    const label = t(action === 'submit_for_review' ? 'detail.submitForReview' : 'detail.publishEvent');
    confirm({
      title: label,
      message: t(action === 'submit_for_review'
        ? 'detail.submitForReviewConfirm'
        : 'detail.publishEventConfirm'),
      confirmLabel: label,
      cancelLabel: t('common:buttons.cancel'),
      variant: 'primary',
      onConfirm: () => performPublication(action),
    });
  }

  async function performPublication(action: 'submit_for_review' | 'publish') {
    if (!event || updating) return;
    setUpdating(true);
    try {
      if (action === 'submit_for_review') {
        await submitEventForReview(event.id);
      } else {
        await publishEvent(event.id);
      }
      showToast({
        title: t(action === 'submit_for_review'
          ? 'detail.submittedForReview'
          : 'detail.publishedSuccessfully'),
        variant: 'success',
      });
      refresh();
    } catch {
      showToast({
        title: t('common:errors.alertTitle'),
        description: t('detail.publicationFailed'),
        variant: 'danger',
      });
    } finally {
      setUpdating(false);
    }
  }

  function handleToggleWaitlist() {
    if (!event || updating) return;
    if (!currentRelationship.registration.can_leave_waitlist) {
      void changeWaitlist(false);
      return;
    }

    const decliningOffer = hasActiveWaitlistOffer;
    confirm({
      title: t(decliningOffer
        ? 'detail.offerDeclineConfirmTitle'
        : 'detail.leaveWaitlistConfirmTitle'),
      message: t(decliningOffer
        ? 'detail.offerDeclineConfirmDescription'
        : 'detail.leaveWaitlistConfirmDescription'),
      confirmLabel: t(decliningOffer ? 'detail.declineOffer' : 'detail.leaveWaitlist'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => changeWaitlist(true),
    });
  }

  async function handleAcceptWaitlistOffer() {
    if (!event || updating || !hasActiveWaitlistOffer) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUpdating(true);
    try {
      acceptOfferMutationKeyRef.current ??= eventMutationKey('accept-offer', event.id);
      await acceptEventWaitlistOffer(event.id, acceptOfferMutationKeyRef.current);
      acceptOfferMutationKeyRef.current = null;
      setRelationship({
        ...currentRelationship,
        registration: {
          ...currentRelationship.registration,
          state: 'confirmed',
          waitlist_position: null,
          can_register: false,
          can_withdraw: true,
          can_join_waitlist: false,
          can_leave_waitlist: false,
        },
        capacity: {
          ...currentRelationship.capacity,
          confirmed: currentRelationship.capacity.confirmed + 1,
          waitlist_count: Math.max(0, currentRelationship.capacity.waitlist_count - 1),
        },
      });
      setMetrics({
        ...currentMetrics,
        confirmed_count: currentMetrics.confirmed_count + 1,
        waitlist_count: Math.max(0, currentMetrics.waitlist_count - 1),
      });
      showToast({
        title: t('detail.offerAvailable'),
        description: t('detail.offerAccepted'),
        variant: 'success',
      });
      refresh();
    } catch {
      showToast({
        title: t('common:errors.alertTitle'),
        description: t('detail.offerAcceptError'),
        variant: 'danger',
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('detailTitle')}
        backLabel={t('detail.goBack')}
        fallbackHref="/(tabs)/events"
        rightAction={{ accessibilityLabel: t('share'), icon: 'share-outline', onPress: handleShare }}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: footerReservedSpace, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />}
      >
        <HeroCard variant="default" className="overflow-hidden">
          <View className="h-1 w-full" style={{ backgroundColor: accent }} />
          {coverImage ? <Image source={{ uri: coverImage }} style={{ width: '100%', height: 180 }} contentFit="cover" /> : null}
          <HeroCard.Body className="gap-4 px-4 py-4">
            <View className="flex-row flex-wrap gap-2">
              {event.category ? (
                <Chip size="sm" variant="soft" color="warning">
                  <Ionicons name="pricetag-outline" size={12} color={accent} />
                  <Chip.Label>{event.category.name}</Chip.Label>
                </Chip>
              ) : null}
              {lifecycleChip ? (
                <Chip size="sm" variant="soft" color={lifecycleChip.color}>
                  <Chip.Label>{lifecycleChip.label}</Chip.Label>
                </Chip>
              ) : event.relationship.capacity.is_full ? (
                <Chip size="sm" variant="soft" color="danger">
                  <Chip.Label>{t('full')}</Chip.Label>
                </Chip>
              ) : null}
              {currentRsvp ? (
                <Chip size="sm" variant="soft" color="success">
                  <Ionicons name="checkmark-circle-outline" size={12} color={theme.success} />
                  <Chip.Label>{currentRsvp === 'going' ? t('going') : t('interested')}</Chip.Label>
                </Chip>
              ) : null}
            </View>

            <HeroCard.Title className="text-2xl leading-8">{event.title}</HeroCard.Title>
            {event.description ? (
              <HeroCard.Description className="text-sm leading-6">
                {stripHtml(event.description)}
              </HeroCard.Description>
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        <View className="flex-row gap-3">
          <DetailMetric icon="calendar-outline" label={t('detail.date')} value={dateStr} primary={primary} />
          <DetailMetric icon="time-outline" label={t('detail.time')} value={timeStr} primary={primary} />
        </View>

        {event.online_access.mode !== 'in_person' ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="videocam-outline" title={onlineLink ? t('onlineTapToJoin') : t('onlineEvent')} primary={primary} theme={theme} />
              {onlineLink ? (
                <HeroButton variant="secondary" onPress={() => void Linking.openURL(onlineLink)}>
                  <Ionicons name="open-outline" size={18} color={primary} />
                  <HeroButton.Label>{t('detail.joinOnline')}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {event.location.label ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="location-outline" title={t('detail.location')} primary={primary} theme={theme} />
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{event.location.label}</Text>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {event.series.named?.title ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-2 px-4 py-4">
              <SectionTitle icon="repeat-outline" title={event.series.named.title} primary={primary} theme={theme} />
              {event.series.named.description ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {event.series.named.description}
                </Text>
              ) : null}
              <Chip size="sm" variant="soft" color="default" className="self-start">
                <Chip.Label>{t('resultsCount', { count: event.series.named.event_count })}</Chip.Label>
              </Chip>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {user ? (
          <EventRegistrationPanel
            eventId={event.id}
            primary={primary}
            theme={theme}
            refreshSignal={registrationRefreshSignal}
          />
        ) : null}

        {user ? (
          <EventAgendaCard
            agenda={agendaApi.data?.data ?? null}
            isLoading={agendaApi.isLoading}
            error={agendaApi.error}
            onRefresh={agendaApi.refresh}
            locale={dateLocale()}
            primary={primary}
            theme={theme}
            t={t}
          />
        ) : null}

        {user && !event.permissions.edit ? (
          <EventSafetyCard
            eventId={event.id}
            primary={primary}
            theme={theme}
            refreshSignal={safetyRefreshSignal}
          />
        ) : null}

        <EventPollsCard
          polls={Array.isArray(pollsApi.data?.data) ? pollsApi.data.data : []}
          isLoading={pollsApi.isLoading}
          error={pollsApi.error}
          onRefresh={pollsApi.refresh}
          primary={primary}
          theme={theme}
          t={t}
        />

        <EventAttendeesCard
          attendees={attendees}
          counts={counts}
          waitlistPosition={currentWaitlistPosition}
          waitlistCount={currentMetrics.waitlist_count}
          canViewRoster={event.permissions.manage_people}
          isLoading={event.permissions.manage_people && attendeesApi.isLoading}
          error={event.permissions.manage_people ? attendeesApi.error : null}
          onRefresh={attendeesApi.refresh}
          primary={primary}
          theme={theme}
          t={t}
        />

        {event.organizer ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="person-circle-outline" title={t('detail.organizer')} primary={primary} theme={theme} />
              <View className="flex-row items-center gap-3">
                <Avatar uri={event.organizer.avatar_url ?? undefined} name={event.organizer.display_name ?? '?'} size={44} />
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>{event.organizer.display_name ?? t('common:unknown')}</Text>
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {event.permissions.edit ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="settings-outline" title={t('detail.ownerTools')} primary={primary} theme={theme} />
              {event.permissions.submit_for_review ? (
                <HeroButton isDisabled={updating} onPress={() => void handlePublication('submit_for_review')}>
                  {updating ? <Spinner size="sm" /> : <Ionicons name="send-outline" size={18} color="#fff" />}
                  <HeroButton.Label>{t('detail.submitForReview')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {event.permissions.publish ? (
                <HeroButton isDisabled={updating} onPress={() => void handlePublication('publish')}>
                  {updating ? <Spinner size="sm" /> : <Ionicons name="cloud-upload-outline" size={18} color="#fff" />}
                  <HeroButton.Label>{t('detail.publishEvent')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              <HeroButton variant="secondary" onPress={openEditEvent}>
                <Ionicons name="create-outline" size={18} color={primary} />
                <HeroButton.Label>{t('detail.edit')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={openEventTemplates}>
                <Ionicons name="copy-outline" size={18} color={primary} />
                <HeroButton.Label>{t('event_templates:templates.mobile.title')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={openEventLifecycleHistory}>
                <Ionicons name="time-outline" size={18} color={primary} />
                <HeroButton.Label>{t('lifecycleHistory.open')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {isRecurrenceDefinitionBlueprintCandidate(event) ? (
          <EventRecurrenceDefinitionTool event={event} primary={primary} theme={theme} t={t} />
        ) : null}

        {canOpenTickets ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle
                icon="ticket-outline"
                title={t('event_tickets:tickets.mobile.title')}
                primary={primary}
                theme={theme}
              />
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('event_tickets:tickets.mobile.gatewayDisabledDescription')}
              </Text>
              <HeroButton variant="secondary" onPress={openEventTickets}>
                <Ionicons name="ticket-outline" size={18} color={primary} />
                <HeroButton.Label>{t('event_tickets:tickets.mobile.catalogueTitle')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {event.permissions.broadcast ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle
                icon="megaphone-outline"
                title={t('event_communications:title')}
                primary={primary}
                theme={theme}
              />
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('event_communications:compose_description')}
              </Text>
              <HeroButton variant="secondary" onPress={openEventCommunications}>
                <Ionicons name="megaphone-outline" size={18} color={primary} />
                <HeroButton.Label>{t('event_communications:new_message')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {event.permissions.check_in ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="clipboard-outline" title={t('attendance.title')} primary={primary} theme={theme} />
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('attendance.detailCta')}
              </Text>
              <HeroButton variant="primary" onPress={openAttendanceWorkspace}>
                <Ionicons name="people-outline" size={18} color="#fff" />
                <HeroButton.Label>{t('attendance.openWorkspace')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {event.permissions.edit ? (
          <EventAnalyticsSummaryCard
            eventId={event.id}
            locale={dateLocale()}
            primary={primary}
            theme={theme}
            t={t}
            refreshSignal={analyticsRefreshSignal}
          />
        ) : null}

        {user && currentRelationship.registration.state === 'confirmed' ? (
          <>
            <EventCheckinCredentialCard eventId={event.id} />
            <EventReminderCard
              eventId={event.id}
              preferences={remindersApi.data?.data ?? null}
              isLoading={remindersApi.isLoading}
              error={remindersApi.error}
              onRefresh={remindersApi.refresh}
              primary={primary}
              theme={theme}
              t={t}
            />
          </>
        ) : null}
      </ScrollView>

      {hasParticipationActions ? (
        <Surface
          testID="event-rsvp-footer"
          variant="default"
          className="absolute bottom-0 left-0 right-0 border-t border-border p-4"
          style={{ paddingBottom: footerBottomPadding, backgroundColor: theme.bg }}
        >
          {hasActiveWaitlistOffer ? (
            <View className="gap-3" accessibilityLiveRegion="polite">
              <View className="gap-1">
                <Text className="font-semibold" style={{ color: theme.text }}>{t('detail.offerTitle')}</Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.offerDescription')}</Text>
              </View>
              <View className="flex-row gap-3">
                <HeroButton
                  className="flex-1"
                  variant="primary"
                  isDisabled={updating}
                  onPress={() => void handleAcceptWaitlistOffer()}
                  accessibilityLabel={t('detail.acceptOffer')}
                  accessibilityState={{ busy: updating }}
                >
                  {updating ? <Spinner size="sm" /> : <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />}
                  <HeroButton.Label>{t('detail.acceptOffer')}</HeroButton.Label>
                </HeroButton>
                <HeroButton
                  className="flex-1"
                  variant="secondary"
                  isDisabled={updating}
                  onPress={handleToggleWaitlist}
                  accessibilityLabel={t('detail.declineOffer')}
                  accessibilityState={{ busy: updating }}
                >
                  <Ionicons name="close-circle-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('detail.declineOffer')}</HeroButton.Label>
                </HeroButton>
              </View>
            </View>
          ) : (
            <>
              {showGoingAction || showInterestedAction ? (
                <View className="flex-row gap-3">
                  {showGoingAction ? (
                    <RsvpButton
                      label={t('going')}
                      icon="checkmark-circle"
                      selected={currentRsvp === 'going'}
                      primary={primary}
                      loading={updating}
                      disabled={updating || (currentRsvp === 'going'
                        ? !currentRelationship.registration.can_withdraw
                        : !currentRelationship.registration.can_register)}
                      onPress={() => void handleRsvp('going')}
                    />
                  ) : null}
                  {showInterestedAction ? (
                    <RsvpButton
                      label={t('interested')}
                      icon="star"
                      selected={currentRsvp === 'interested'}
                      primary={primary}
                      loading={updating}
                      disabled={updating || !currentRelationship.engagement.can_change}
                      onPress={() => void handleRsvp('interested')}
                    />
                  ) : null}
                </View>
              ) : null}
              {hasWaitlistAction ? (
                <HeroButton
                  className={showGoingAction || showInterestedAction ? 'mt-3' : undefined}
                  variant={currentRelationship.registration.can_leave_waitlist ? 'secondary' : 'primary'}
                  isDisabled={updating}
                  onPress={handleToggleWaitlist}
                  accessibilityLabel={currentRelationship.registration.can_leave_waitlist ? t('detail.leaveWaitlist') : t('detail.joinWaitlist')}
                  accessibilityState={{ busy: updating }}
                >
                  {updating ? <Spinner size="sm" /> : <Ionicons name="hourglass-outline" size={16} color={currentRelationship.registration.can_leave_waitlist ? primary : '#fff'} />}
                  <HeroButton.Label>
                    {currentRelationship.registration.can_leave_waitlist
                      ? t('detail.leaveWaitlist')
                      : t('detail.joinWaitlist')}
                  </HeroButton.Label>
                </HeroButton>
              ) : null}
            </>
          )}
        </Surface>
      ) : null}
      {confirmDialog}
    </SafeAreaView>
  );
}

function EventAgendaCard({
  agenda,
  isLoading,
  error,
  onRefresh,
  locale,
  primary,
  theme,
  t,
}: {
  agenda: EventAgenda | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  locale: string;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [sessionOverrides, setSessionOverrides] = useState<
    Record<number, EventAgenda['sessions'][number]>
  >({});

  useEffect(() => {
    if (!agenda || !Array.isArray(agenda.sessions)) {
      setSessionOverrides({});
      return;
    }

    const next: Record<number, EventAgenda['sessions'][number]> = {};
    for (const session of agenda.sessions) next[session.id] = session;
    setSessionOverrides(next);
  }, [agenda]);

  if (!agenda && isLoading) {
    return (
      <Surface
        variant="secondary"
        className="flex-row items-center gap-2 rounded-xl px-4 py-3"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('agenda.loading')}
      >
        <Spinner size="sm" />
        <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('agenda.loading')}</Text>
      </Surface>
    );
  }

  if (!agenda && error) {
    return (
      <Surface variant="secondary" className="gap-2 rounded-xl px-4 py-3">
        <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('agenda.loadError')}</Text>
        <HeroButton
          variant="secondary"
          size="sm"
          className="self-start"
          onPress={onRefresh}
          accessibilityLabel={t('agenda.retry')}
        >
          <Ionicons name="refresh-outline" size={16} color={primary} />
          <HeroButton.Label>{t('agenda.retry')}</HeroButton.Label>
        </HeroButton>
      </Surface>
    );
  }

  if (!agenda || !Array.isArray(agenda.sessions) || agenda.sessions.length === 0) return null;

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-4 px-4 py-4">
        <View className="flex-row items-center justify-between gap-3">
          <SectionTitle icon="list-outline" title={t('agenda.title')} primary={primary} theme={theme} />
          <Chip size="sm" variant="soft" color="accent">
            <Chip.Label>{t('agenda.sessionCount', { count: agenda.sessions.length })}</Chip.Label>
          </Chip>
        </View>

        <View className="gap-3">
          {agenda.sessions.map((serverSession) => {
            const session = sessionOverrides[serverSession.id] ?? serverSession;
            const startLabel = formatAgendaDateTime(session.start_at, agenda.timezone, locale);
            const endLabel = formatAgendaDateTime(session.end_at, agenda.timezone, locale);
            const typeLabel = t(`agenda.type.${session.type}`);
            const visibilityLabel = t(`agenda.visibility.${session.visibility}`);
            const speakerLabels = session.speakers.map((speaker) => {
              const name = speaker.display_name ?? t('agenda.speakerFallback');
              return speaker.role
                ? t('agenda.speakerWithRole', { name, role: speaker.role })
                : name;
            });
            return (
              <Surface
                key={session.id}
                variant="tertiary"
                className="gap-3 rounded-xl border border-border px-3 py-3"
              >
                <View className="gap-2">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }}>
                      {session.title}
                    </Text>
                    {session.status === 'cancelled' ? (
                      <Chip size="sm" variant="soft" color="danger">
                        <Chip.Label>{t('agenda.status.cancelled')}</Chip.Label>
                      </Chip>
                    ) : null}
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    <Chip size="sm" variant="soft" color="default">
                      <Chip.Label>{typeLabel}</Chip.Label>
                    </Chip>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={session.visibility === 'staff' ? 'warning' : session.visibility === 'registered' ? 'accent' : 'default'}
                    >
                      <Chip.Label>{visibilityLabel}</Chip.Label>
                    </Chip>
                  </View>
                  {session.description ? (
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                      {session.description}
                    </Text>
                  ) : null}
                </View>

                <View className="flex-row gap-3">
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }}>
                      {t('agenda.starts')}
                    </Text>
                    <Text className="text-sm font-medium" style={{ color: theme.text }}>{startLabel}</Text>
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }}>
                      {t('agenda.ends')}
                    </Text>
                    <Text className="text-sm font-medium" style={{ color: theme.text }}>{endLabel}</Text>
                  </View>
                </View>

                {session.track ? (
                  <View className="flex-row items-start gap-2">
                    <Ionicons name="layers-outline" size={16} color={primary} />
                    <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }}>
                      <Text className="font-semibold">{t('agenda.track')}: </Text>{session.track}
                    </Text>
                  </View>
                ) : null}
                {session.room ? (
                  <View className="flex-row items-start gap-2">
                    <Ionicons name="location-outline" size={16} color={primary} />
                    <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }}>
                      <Text className="font-semibold">{t('agenda.room')}: </Text>{session.room}
                    </Text>
                  </View>
                ) : null}
                {speakerLabels.length > 0 ? (
                  <View className="flex-row items-start gap-2">
                    <Ionicons name="mic-outline" size={16} color={primary} />
                    <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }}>
                      <Text className="font-semibold">{t('agenda.speakers')}: </Text>{speakerLabels.join(', ')}
                    </Text>
                  </View>
                ) : null}

                <EventAgendaEnterprisePanel
                  eventId={agenda.event_id}
                  session={session}
                  onSessionChange={(updatedSession) => {
                    if (updatedSession === null) {
                      onRefresh();
                      return;
                    }
                    setSessionOverrides((current) => ({
                      ...current,
                      [updatedSession.id]: updatedSession,
                    }));
                    onRefresh();
                  }}
                />
              </Surface>
            );
          })}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function formatAgendaDateTime(value: string, timeZone: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  let resolvedTimeZone = timeZone;
  try {
    new Intl.DateTimeFormat(locale, { timeZone }).format(date);
  } catch {
    resolvedTimeZone = 'UTC';
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: resolvedTimeZone,
  }).format(date);
}

function EventReminderCard({
  eventId,
  preferences,
  isLoading,
  error,
  onRefresh,
  primary,
  theme,
  t,
}: {
  eventId: number;
  preferences: EventReminderPreferences | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<EventReminderRule[]>([]);
  const [channels, setChannels] = useState({ email: true, in_app: true, web_push: true, fcm: true });
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (!preferences) return;
    setEnabled(preferences.overrides.reminders_enabled ?? preferences.resolved.reminders_enabled);
    setRules(preferences.rules.length > 0
      ? preferences.rules
      : preferences.limits.default_offsets_minutes.map((offset) => ({
        offset_minutes: offset,
        enabled: true,
        email_enabled: null,
        in_app_enabled: null,
        web_push_enabled: null,
        fcm_enabled: null,
        realtime_enabled: null,
      })));
    setChannels({
      email: preferences.overrides.email_enabled ?? preferences.resolved.channels.email,
      in_app: preferences.overrides.in_app_enabled ?? preferences.resolved.channels.in_app,
      web_push: preferences.overrides.web_push_enabled ?? preferences.resolved.channels.web_push,
      fcm: preferences.overrides.fcm_enabled ?? preferences.resolved.channels.fcm,
    });
  }, [preferences]);

  const selected = new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.offset_minutes));

  function toggleReminder(minutes: number) {
    setRules((current) => selected.has(minutes)
      ? current.filter((rule) => rule.offset_minutes !== minutes)
      : [...current, {
        offset_minutes: minutes,
        enabled: true,
        email_enabled: null,
        in_app_enabled: null,
        web_push_enabled: null,
        fcm_enabled: null,
        realtime_enabled: null,
      }].sort((left, right) => right.offset_minutes - left.offset_minutes));
  }

  function addCustom() {
    if (!preferences) return;
    const minutes = Number(custom);
    if (!Number.isInteger(minutes)
      || minutes < preferences.limits.minimum_offset_minutes
      || minutes > preferences.limits.maximum_offset_minutes) {
      setMessage(t('reminders.customBounds', {
        min: preferences.limits.minimum_offset_minutes,
        max: preferences.limits.maximum_offset_minutes,
      }));
      return;
    }
    if (!selected.has(minutes) && rules.length >= preferences.limits.maximum_rules) {
      setMessage(t('reminders.ruleLimit', { count: preferences.limits.maximum_rules }));
      return;
    }
    if (!selected.has(minutes)) toggleReminder(minutes);
    setCustom('');
    setMessage(null);
  }

  async function save() {
    if (!preferences) return;
    setSaving(true);
    setMessage(null);
    try {
      await updateEventReminders(
        eventId,
        {
          expected_revision: preferences.revision,
          overrides: {
            ...preferences.overrides,
            reminders_enabled: enabled,
            cadence: enabled ? 'instant' : preferences.overrides.cadence,
            email_enabled: channels.email,
            in_app_enabled: channels.in_app,
            web_push_enabled: channels.web_push,
            fcm_enabled: channels.fcm,
          },
          rules: rules.map((rule) => ({
            offset_minutes: rule.offset_minutes,
            enabled: rule.enabled,
            email_enabled: rule.email_enabled,
            in_app_enabled: rule.in_app_enabled,
            web_push_enabled: rule.web_push_enabled,
            fcm_enabled: rule.fcm_enabled,
            realtime_enabled: rule.realtime_enabled,
          })),
        },
      );
      setMessage(t('reminders.saved'));
      onRefresh();
    } catch (requestError) {
      if (requestError instanceof ApiResponseError && requestError.status === 409) {
        setMessage(t('reminders.conflictRefreshed'));
        onRefresh();
      } else {
        setMessage(t('reminders.error'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!preferences) return;
    setSaving(true);
    try {
      await deleteEventReminders(eventId, preferences.revision);
      setMessage(t('reminders.resetSuccess'));
      onRefresh();
    } catch (requestError) {
      if (requestError instanceof ApiResponseError && requestError.status === 409) {
        setMessage(t('reminders.conflictRefreshed'));
        onRefresh();
      } else {
        setMessage(t('reminders.error'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <SectionTitle icon="notifications-outline" title={t('reminders.title')} primary={primary} theme={theme} />
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {t('reminders.subtitle')}
        </Text>
        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <View className="gap-2">
            <Text className="text-sm text-danger">{t('reminders.loadError')}</Text>
            <HeroButton variant="secondary" size="sm" onPress={onRefresh}>
              <HeroButton.Label>{t('common:actions.retry')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : preferences ? (
          <View className="gap-3">
            <HeroButton
              size="sm"
              variant={enabled ? 'primary' : 'secondary'}
              isDisabled={saving}
              onPress={() => setEnabled((current) => !current)}
              accessibilityRole="switch"
              accessibilityState={{ checked: enabled, busy: saving }}
            >
              <Ionicons name={enabled ? 'notifications' : 'notifications-off-outline'} size={15} color={enabled ? '#fff' : primary} />
              <HeroButton.Label>{enabled ? t('reminders.enabled') : t('reminders.disabled')}</HeroButton.Label>
            </HeroButton>
            <Text className="text-xs font-semibold" style={{ color: theme.text }}>{t('reminders.timing')}</Text>
            <View className="flex-row flex-wrap gap-2">
            {REMINDER_OPTIONS.map((minutes) => {
              const selectedOption = selected.has(minutes);
              return (
                <HeroButton
                  key={minutes}
                  size="sm"
                  variant={selectedOption ? 'primary' : 'secondary'}
                  isDisabled={saving || !enabled}
                  onPress={() => toggleReminder(minutes)}
                  accessibilityLabel={t(`reminders.option.${minutes}`)}
                  accessibilityState={{ selected: selectedOption, busy: saving }}
                >
                  <Ionicons name={selectedOption ? 'notifications' : 'notifications-outline'} size={15} color={selectedOption ? '#fff' : primary} />
                  <HeroButton.Label>{t(`reminders.option.${minutes}`)}</HeroButton.Label>
                </HeroButton>
              );
            })}
            </View>
            <View className="flex-row items-center gap-2">
              <TextInput
                className="min-h-11 flex-1 rounded-xl border border-border px-3"
                style={{ color: theme.text }}
                value={custom}
                onChangeText={setCustom}
                keyboardType="number-pad"
                placeholder={t('reminders.customMinutes')}
                placeholderTextColor={theme.textSecondary}
                editable={!saving && enabled}
                accessibilityLabel={t('reminders.customMinutes')}
              />
              <HeroButton size="sm" variant="secondary" isDisabled={saving || !enabled} onPress={addCustom}>
                <HeroButton.Label>{t('reminders.addCustom')}</HeroButton.Label>
              </HeroButton>
            </View>
            {rules.filter((rule) => !REMINDER_OPTIONS.includes(rule.offset_minutes as typeof REMINDER_OPTIONS[number])).map((rule) => (
              <Chip
                key={rule.offset_minutes}
                color="accent"
                variant="secondary"
                disabled={saving || !enabled}
                onPress={() => toggleReminder(rule.offset_minutes)}
                accessibilityLabel={t('reminders.removeCustom', { count: rule.offset_minutes })}
              >
                <Chip.Label>{t('reminders.customValue', { count: rule.offset_minutes })}</Chip.Label>
                <Ionicons name="close" size={14} color={primary} />
              </Chip>
            ))}
            <Text className="text-xs font-semibold" style={{ color: theme.text }}>{t('reminders.channels')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(Object.keys(channels) as Array<keyof typeof channels>).map((channel) => (
                <HeroButton
                  key={channel}
                  size="sm"
                  variant={channels[channel] ? 'primary' : 'secondary'}
                  isDisabled={saving || !enabled}
                  onPress={() => setChannels((current) => ({ ...current, [channel]: !current[channel] }))}
                  accessibilityState={{ selected: channels[channel] }}
                >
                  <HeroButton.Label>{t(`reminders.channel.${channel}`)}</HeroButton.Label>
                </HeroButton>
              ))}
            </View>
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {t('reminders.resolved', { source: t(`reminders.source.${preferences.resolved.reminders_source}`) })}
            </Text>
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" variant="primary" isDisabled={saving} onPress={() => void save()}>
                <HeroButton.Label>{t('reminders.save')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant="secondary" isDisabled={saving} onPress={() => void reset()}>
                <HeroButton.Label>{t('reminders.reset')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        ) : null}
        {message ? (
          <Text className="text-xs text-muted-foreground" accessibilityLiveRegion="polite">{message}</Text>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function EventPollsCard({
  polls,
  isLoading,
  error,
  onRefresh,
  primary,
  theme,
  t,
}: {
  polls: EventPoll[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const { show: showToast } = useAppToast();
  const [localPolls, setLocalPolls] = useState<Record<number, EventPoll>>({});
  const [votingPollId, setVotingPollId] = useState<number | null>(null);
  const mergedPolls = polls.map((poll) => localPolls[poll.id] ?? poll).filter((poll) => poll.options?.length);

  async function handleVote(poll: EventPoll, optionId: number) {
    if (votingPollId !== null || poll.has_voted || poll.voted_option_id || poll.user_vote_option_id || poll.status === 'closed' || poll.is_active === false) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVotingPollId(poll.id);
    try {
      const result = await voteEventPoll(poll.id, optionId);
      setLocalPolls((prev) => ({ ...prev, [poll.id]: result.data }));
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('detail.pollVoteError'), variant: 'danger' });
    } finally {
      setVotingPollId(null);
    }
  }

  if (!isLoading && !error && mergedPolls.length === 0) return null;

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-4 px-4 py-4">
        <SectionTitle icon="stats-chart-outline" title={t('detail.eventPolls')} primary={primary} theme={theme} />
        {isLoading ? (
          <View className="flex-row items-center gap-2">
            <Spinner size="sm" />
            <Text className="text-xs text-muted-foreground">{t('detail.loadingPolls')}</Text>
          </View>
        ) : error ? (
          <View className="gap-2">
            <Text className="text-sm text-danger">{t('detail.pollsLoadError')}</Text>
            <HeroButton variant="secondary" size="sm" onPress={onRefresh}>
              <HeroButton.Label>{t('common:actions.retry')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : (
          <View className="gap-4">
            {mergedPolls.map((poll) => {
              const selectedOptionId = poll.voted_option_id ?? poll.user_vote_option_id ?? null;
              const showResults = !!selectedOptionId || poll.has_voted || poll.status === 'closed' || poll.is_active === false;
              return (
                <Surface key={poll.id} variant="tertiary" className="rounded-lg border border-border px-3 py-3">
                  <View className="gap-3">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }}>{poll.question}</Text>
                    {poll.description ? (
                      <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{poll.description}</Text>
                    ) : null}
                    {poll.options.map((option) => {
                      const label = option.text ?? option.label ?? t('detail.pollOptionFallback');
                      const selected = selectedOptionId === option.id;
                      return (
                        <HeroButton
                          key={option.id}
                          variant={selected ? 'primary' : 'secondary'}
                          size="sm"
                          isDisabled={votingPollId !== null || showResults}
                          onPress={() => void handleVote(poll, option.id)}
                          accessibilityLabel={label}
                          accessibilityState={{ selected, busy: votingPollId === poll.id }}
                        >
                          {votingPollId === poll.id ? <Spinner size="sm" /> : null}
                          <HeroButton.Label>
                            {showResults
                              ? t('detail.pollOptionResult', { label, percent: option.percentage ?? 0 })
                              : label}
                          </HeroButton.Label>
                        </HeroButton>
                      );
                    })}
                    <Text className="text-xs text-muted-foreground">
                      {t('detail.pollTotalVotes', { count: poll.total_votes ?? 0 })}
                    </Text>
                  </View>
                </Surface>
              );
            })}
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function EventAttendeesCard({
  attendees,
  counts,
  waitlistPosition,
  waitlistCount,
  canViewRoster,
  isLoading,
  error,
  onRefresh,
  primary,
  theme,
  t,
}: {
  attendees: EventAttendee[];
  counts: { going: number; interested: number };
  waitlistPosition: number | null;
  waitlistCount: number | null;
  canViewRoster: boolean;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const visibleAttendees = attendees.slice(0, 8);
  const hiddenCount = Math.max(0, counts.going + counts.interested - visibleAttendees.length);

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <SectionTitle icon="people-outline" title={t('detail.attendees')} primary={primary} theme={theme} />
        <Text className="text-sm" style={{ color: theme.textSecondary }}>
          {t('attendees', { going: counts.going, interested: counts.interested })}
        </Text>
        {waitlistPosition ? (
          <Chip size="sm" variant="soft" color="warning" className="self-start">
            <Ionicons name="hourglass-outline" size={12} color={theme.warning} />
            <Chip.Label>{t('detail.onWaitlistPosition', { position: waitlistPosition })}</Chip.Label>
          </Chip>
        ) : waitlistCount && waitlistCount > 0 ? (
          <Text className="text-xs text-muted-foreground">{t('detail.waitlistCount', { count: waitlistCount })}</Text>
        ) : null}

        {canViewRoster ? (isLoading ? (
          <View className="flex-row items-center gap-2">
            <Spinner size="sm" />
            <Text className="text-xs text-muted-foreground">{t('detail.loadingAttendees')}</Text>
          </View>
        ) : error ? (
          <View className="gap-2">
            <Text className="text-sm text-danger">{t('detail.attendeesLoadError')}</Text>
            <HeroButton variant="secondary" size="sm" onPress={onRefresh}>
              <HeroButton.Label>{t('common:actions.retry')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : visibleAttendees.length > 0 ? (
          <View className="gap-2">
            {visibleAttendees.map((attendee) => {
              const attendeeName = getAttendeeName(attendee, t);
              return (
                <View key={attendee.member.id} className="flex-row items-center gap-3">
                  <Avatar uri={attendee.member.avatar_url ?? undefined} name={attendeeName} size={34} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                      {attendeeName}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {getAttendeeStatusLabel(attendee, t)}
                    </Text>
                  </View>
                </View>
              );
            })}
            {hiddenCount > 0 ? (
              <Text className="text-xs text-muted-foreground">{t('detail.moreAttendees', { count: hiddenCount })}</Text>
            ) : null}
          </View>
        ) : (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.noAttendees')}</Text>
        )) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function ScreenShell({ title, backLabel, children }: { title: string; backLabel: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={backLabel} fallbackHref="/(tabs)/events" />
      <View className="flex-1 px-4" style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  );
}

function EventRecurrenceDefinitionTool({
  event,
  primary,
  theme,
  t,
}: {
  event: CanonicalEvent;
  primary: string;
  theme: Theme;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const recurrenceId = event.series.recurrence?.recurrence_id;
  const capabilitiesApi = useApi(
    getEventRecurrenceCapabilities,
    [event.id, recurrenceId],
    { enabled: Boolean(recurrenceId) },
  );
  if (!capabilitiesApi.data?.data
    || !canUseRecurrenceDefinitionBlueprints(event, capabilitiesApi.data.data)) {
    return null;
  }

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <SectionTitle
          icon="layers-outline"
          title={t('event_recurrence_blueprints:tab')}
          primary={primary}
          theme={theme}
        />
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {t('event_recurrence_blueprints:definition_only_description')}
        </Text>
        <HeroButton
          variant="secondary"
          onPress={() => router.push({
            pathname: '/(modals)/event-recurrence-blueprints',
            params: { id: String(event.id) },
          } as unknown as Href)}
        >
          <Ionicons name="layers-outline" size={18} color={primary} />
          <HeroButton.Label>{t('event_recurrence_blueprints:tab')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function CenteredState({ text }: { text: string }) {
  return (
    <HeroCard variant="secondary" className="my-8">
      <HeroCard.Body className="items-center gap-4">
        <Ionicons name="alert-circle-outline" size={34} color="#F59E0B" />
        <Text className="text-center text-sm text-muted-foreground">{text}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function DetailMetric({ icon, label, value, primary }: { icon: IoniconName; label: string; value: string; primary: string }) {
  return (
    <HeroCard variant="secondary" className="flex-1">
      <HeroCard.Body className="gap-1 px-3 py-3">
        <Ionicons name={icon} size={18} color={primary} />
        <Text className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</Text>
        <Text className="text-sm font-bold text-foreground" numberOfLines={3}>{value}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function SectionTitle({ icon, title, primary, theme }: { icon: IoniconName; title: string; primary: string; theme: Theme }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={18} color={primary} />
      <Text className="text-base font-semibold" style={{ color: theme.text }}>{title}</Text>
    </View>
  );
}

function RsvpButton({
  label,
  icon,
  selected,
  primary,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  selected: boolean;
  primary: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <HeroButton
      className="flex-1"
      variant={selected ? 'primary' : 'secondary'}
      isDisabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, selected }}
    >
      {loading ? <Spinner size="sm" /> : <Ionicons name={icon} size={16} color={selected ? '#fff' : primary} />}
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function getAttendeeName(attendee: EventAttendee, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return attendee.member.display_name || t('detail.communityMember');
}

function getAttendeeStatusLabel(attendee: EventAttendee, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (attendee.attendance.state !== 'not_checked_in') return t('detail.attendeeCheckedIn');
  if (attendee.engagement.state === 'interested') return t('detail.attendeeInterested');
  return t('detail.attendeeGoing');
}
