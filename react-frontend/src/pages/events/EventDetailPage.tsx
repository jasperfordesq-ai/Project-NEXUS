// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Surface } from '@/components/ui/Surface';
import { Tabs } from '@heroui/react/tabs';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useConfirm } from '@/components/ui/ConfirmDialog';
/**
 * Event Detail Page - Single event view with enhanced RSVP, sharing, and organizer check-in
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from '@/lib/motion';

import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import Users from 'lucide-react/icons/users';
import Edit from 'lucide-react/icons/square-pen';
import Archive from 'lucide-react/icons/archive';
import ExternalLink from 'lucide-react/icons/external-link';
import AlertCircle from 'lucide-react/icons/circle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import Heart from 'lucide-react/icons/heart';
import XCircle from 'lucide-react/icons/circle-x';
import Copy from 'lucide-react/icons/copy';
import UserCheck from 'lucide-react/icons/user-check';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Ban from 'lucide-react/icons/ban';
import ListOrdered from 'lucide-react/icons/list-ordered';
import Link2 from 'lucide-react/icons/link-2';
import Repeat from 'lucide-react/icons/repeat';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CalendarRange from 'lucide-react/icons/calendar-range';
import Video from 'lucide-react/icons/video';
import Gift from 'lucide-react/icons/gift';
import BarChart3 from 'lucide-react/icons/chart-column';
import Settings from 'lucide-react/icons/settings';
import Ticket from 'lucide-react/icons/ticket';
import Download from 'lucide-react/icons/download';
import Send from 'lucide-react/icons/send';
import { Helmet } from 'react-helmet-async';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { PageMeta } from '@/components/seo/PageMeta';
import { Breadcrumbs } from '@/components/navigation';
import { EmptyState } from '@/components/feedback';
import { LocationMapCard } from '@/components/location/LocationMapCard';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { EventAgendaWorkspace } from './components/EventAgendaWorkspace';
import { EventCheckInWorkspace } from './components/EventCheckInWorkspace';
import { EventCheckinCredentialCard } from './components/EventCheckinCredentialCard';
import EventRegistrationAttendeeCard from './components/EventRegistrationAttendeeCard';
import { EventSafetyAttendeeCard } from './components/EventSafetyAttendeeCard';
import { EventTicketsPanel } from './components/EventTicketsPanel';
import { EventVenueAccessibilityCard } from './components/EventVenueAccessibilityCard';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';
import {
  eventsApi,
  type Event,
  type EventRosterMember,
  type EventSeriesOccurrence,
  type EventCalendarActions,
} from '@/lib/events-api';
import { logError } from '@/lib/logger';
import { EventReminderPanel } from './EventReminderPanel';
import { formatDateTime, formatDateValue, getFormattingLocale, resolveAvatarUrl, resolveThumbnailUrl, responsiveThumbnailProps } from '@/lib/helpers';

type RsvpOption = 'going' | 'interested' | 'not_going';

function eventMutationKey(action: 'archive' | 'cancel' | 'accept-offer', eventId: number): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${action}-${eventId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface PollOption {
  id: number;
  text: string;
  label: string;
  vote_count: number;
  percentage: number;
}

interface EventPoll {
  id: number;
  question: string;
  description?: string;
  status: 'open' | 'closed';
  total_votes: number;
  has_voted: boolean;
  voted_option_id: number | null;
  options: PollOption[];
  creator?: { id: number; name: string; avatar_url?: string | null };
}

function relationshipRsvpStatus(event: Event): RsvpOption | null {
  if (event.relationship.registration.state === 'confirmed') return 'going';
  if (event.relationship.engagement.state === 'interested') return 'interested';
  if (['declined', 'cancelled'].includes(event.relationship.registration.state)) return 'not_going';
  return null;
}

export function EventDetailPage() {
  const { t } = useTranslation(['events', 'event_tickets', 'community']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  const [event, setEvent] = useState<Event | null>(null);
  // Reflect the loaded event name in the tab/title; falls back to the static label while loading.
  usePageTitle(event?.title ?? t('title'));
  const [translatedEventDesc, setTranslatedEventDesc] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<EventRosterMember[]>([]);
  const [isRosterLoading, setIsRosterLoading] = useState(false);
  const [rosterLoadError, setRosterLoadError] = useState(false);
  const [rosterCursor, setRosterCursor] = useState<string | null>(null);
  const [rosterHasMore, setRosterHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpOption | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [isWaitlisted, setIsWaitlisted] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [seriesEvents, setSeriesEvents] = useState<EventSeriesOccurrence[]>([]);
  const [isLoadingSeriesEvents, setIsLoadingSeriesEvents] = useState(false);
  const [eventPolls, setEventPolls] = useState<EventPoll[]>([]);
  const [isLoadingPolls, setIsLoadingPolls] = useState(false);
  const [votingPollId, setVotingPollId] = useState<number | null>(null);
  const [calendarActions, setCalendarActions] = useState<EventCalendarActions | null>(null);
  const [isDownloadingCalendar, setIsDownloadingCalendar] = useState(false);
  const canViewTickets = Boolean(
    isAuthenticated
    && event?.schedule.start_at
    && (event.relationship.registration.state === 'confirmed'
      || event.permissions.manage_finance
      || event.permissions.reconcile_tickets),
  );

  const requestedDetailTab = searchParams.get('tab');
  useEffect(() => {
    if (!event) return;
    const nextTab = requestedDetailTab === 'attendees'
      ? 'attendees'
      : requestedDetailTab === 'agenda'
        ? 'agenda'
        : requestedDetailTab === 'tickets' && canViewTickets
          ? 'tickets'
        : requestedDetailTab === 'checkin' && event.permissions.check_in
          ? 'checkin'
          : 'details';
    setActiveTab((current) => current === nextTab ? current : nextTab);
  }, [canViewTickets, event, requestedDetailTab]);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);
  const rosterAbortRef = useRef<AbortController | null>(null);
  const eventRequestGeneration = useRef(0);
  const rosterRequestGeneration = useRef(0);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const archiveMutationKeyRef = useRef<string | null>(null);
  const cancelMutationKeyRef = useRef<string | null>(null);
  const acceptOfferMutationKeyRef = useRef<string | null>(null);

  const loadRosterPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (!id) return;

    rosterAbortRef.current?.abort();
    const controller = new AbortController();
    rosterAbortRef.current = controller;
    const requestGeneration = ++rosterRequestGeneration.current;
    const isCurrentRosterRequest = () => (
      requestGeneration === rosterRequestGeneration.current
      && rosterAbortRef.current === controller
      && !controller.signal.aborted
    );

    setIsRosterLoading(true);
    setRosterLoadError(false);
    try {
      const response = await eventsApi.roster(id, {
        per_page: 50,
        status: 'all',
        cursor: cursor ?? undefined,
      }, { signal: controller.signal });
      if (!isCurrentRosterRequest()) return;
      if (!response.success || !response.data) {
        setRosterLoadError(true);
        return;
      }
      setAttendees((current) => {
        if (!append) return response.data!;
        const merged = new Map(current.map((attendee) => [attendee.member.id, attendee]));
        response.data!.forEach((attendee) => merged.set(attendee.member.id, attendee));
        return [...merged.values()];
      });
      setRosterCursor(response.meta?.cursor ?? response.meta?.next_cursor ?? null);
      setRosterHasMore(response.meta?.has_more ?? false);
    } catch (caught) {
      if (!isCurrentRosterRequest()) return;
      logError('Failed to load attendee roster page', caught);
      setRosterLoadError(true);
    } finally {
      if (isCurrentRosterRequest()) {
        rosterAbortRef.current = null;
        setIsRosterLoading(false);
      }
    }
  }, [id]);

  const loadEvent = useCallback(async () => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestGeneration = ++eventRequestGeneration.current;
    const isCurrentRequest = () => (
      requestGeneration === eventRequestGeneration.current
      && abortRef.current === controller
      && !controller.signal.aborted
    );

    try {
      setIsLoading(true);
      setError(null);
      setAttendees([]);
      setRosterCursor(null);
      setRosterHasMore(false);
      setRosterLoadError(false);
      void loadRosterPage(null, false);
      const eventRes = await eventsApi.get(id, { signal: controller.signal });

      if (!isCurrentRequest()) return;

      if (eventRes.success && eventRes.data) {
        setEvent(eventRes.data);
        setRsvpStatus(relationshipRsvpStatus(eventRes.data));
        setIsWaitlisted(['waitlisted', 'offered'].includes(eventRes.data.relationship.registration.state));
        setWaitlistPosition(eventRes.data.relationship.registration.waitlist_position);
      } else {
        // Clear any previously-loaded event so the error screen shows. Without
        // this, navigating from a loaded event to one that fails to load (404/5xx)
        // leaves the prior event in state, and the `error && !event` render guard
        // stays false — so the stale event renders under the new URL.
        setEvent(null);
        setError(tRef.current('detail.not_found_desc'));
      }
    } catch (err) {
      if (!isCurrentRequest()) return;
      logError('Failed to load event', err);
      // Clear stale event data (see the else branch above) so a failed reload
      // shows the error screen instead of the previously-loaded event.
      setEvent(null);
      setError(tRef.current('detail.unable_to_load'));
    } finally {
      if (isCurrentRequest()) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  }, [id, loadRosterPage]);

  useEffect(() => {
    loadEvent();
    return () => {
      eventRequestGeneration.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      rosterRequestGeneration.current += 1;
      rosterAbortRef.current?.abort();
      rosterAbortRef.current = null;
    };
  }, [loadEvent]);

  useEffect(() => {
    if (!id || !isAuthenticated) {
      setCalendarActions(null);
      return;
    }
    const controller = new AbortController();
    eventsApi.calendarActions(id, { signal: controller.signal }).then((response) => {
      if (!controller.signal.aborted && response.success && response.data) {
        setCalendarActions(response.data);
      }
    }).catch((calendarError) => {
      if (!controller.signal.aborted) {
        logError('Failed to load event calendar actions', calendarError);
      }
    });
    return () => controller.abort();
  }, [id, isAuthenticated]);

  // Fetch other events in the same series.
  // Depend on the ids (not the whole event object) so an RSVP refetch of the
  // same event doesn't re-trigger the series request.
  const seriesId = event?.series.named?.id;
  const eventId = event?.id;
  useEffect(() => {
    if (!seriesId) {
      setSeriesEvents([]);
      return;
    }

    let cancelled = false;
    async function fetchSeriesEvents() {
      setIsLoadingSeriesEvents(true);
      try {
        const res = await eventsApi.series(seriesId!);
        if (!cancelled && res.success && res.data) {
          // Filter out the current event
          setSeriesEvents(res.data.occurrences.filter((occurrence) => occurrence.id !== eventId));
        }
      } catch (err) {
        logError('Failed to load series events', err);
      } finally {
        if (!cancelled) setIsLoadingSeriesEvents(false);
      }
    }

    fetchSeriesEvents();
    return () => { cancelled = true; };
  }, [seriesId, eventId]);

  // Fetch polls linked to this event
  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    async function fetchEventPolls() {
      setIsLoadingPolls(true);
      try {
        const res = await api.get<{ items?: EventPoll[] }>(`/v2/polls?event_id=${id}&status=all&limit=50`);
        if (!cancelled && res.success && res.data) {
          const items = Array.isArray(res.data) ? res.data : (res.data.items ?? []);
          setEventPolls(items);
        }
      } catch (err) {
        logError('Failed to load event polls', err);
      } finally {
        if (!cancelled) setIsLoadingPolls(false);
      }
    }

    fetchEventPolls();
    return () => { cancelled = true; };
  }, [id]);

  async function handlePollVote(pollId: number, optionId: number) {
    try {
      setVotingPollId(pollId);
      const res = await api.post<EventPoll>(`/v2/polls/${pollId}/vote`, { option_id: optionId });
      if (res.success && res.data) {
        setEventPolls((prev) =>
          prev.map((p) => (p.id === pollId ? { ...p, ...res.data! } : p))
        );
        toastRef.current.success(t('polls.vote_success'));
      } else {
        // api.post resolves { success:false } on a 4xx (poll closed, already voted,
        // invalid option) WITHOUT throwing, so the catch never fired — without this
        // branch the vote silently did nothing with no feedback at all.
        toastRef.current.error((res as { error?: string }).error || t('polls.vote_failed'));
      }
    } catch (err) {
      logError('Failed to vote on poll', err);
      toastRef.current.error(t('polls.vote_failed'));
    } finally {
      setVotingPollId(null);
    }
  }

  async function handleRsvp(newStatus: RsvpOption) {
    if (!event || !isAuthenticated) return;

    const registration = event.relationship.registration;
    const engagement = event.relationship.engagement;
    const canClearCurrentStatus = rsvpStatus === 'going'
      ? registration.can_withdraw
      : engagement.can_change;
    const canSetStatus = newStatus === 'going'
      ? registration.can_register
      : newStatus === 'interested'
        ? engagement.can_change
        : registration.can_withdraw || engagement.can_change;
    const isClearingCurrentStatus = rsvpStatus === newStatus;

    if (isClearingCurrentStatus ? !canClearCurrentStatus : !canSetStatus) return;

    const isLeavingActiveRsvp = rsvpStatus === 'going'
      ? newStatus !== 'going' || isClearingCurrentStatus
      : rsvpStatus === 'interested'
        ? newStatus !== 'going' || isClearingCurrentStatus
        : false;
    if (isLeavingActiveRsvp) {
      const accepted = await confirm({
        title: tRef.current('detail.rsvp_panel_title'),
        body: rsvpStatus === 'going'
          ? tRef.current('detail.rsvp_going')
          : rsvpStatus === 'interested'
            ? tRef.current('detail.rsvp_interested')
            : tRef.current('detail.rsvp_not_going'),
        confirmLabel: isClearingCurrentStatus
          ? tRef.current('detail.not_going_btn')
          : newStatus === 'interested'
            ? tRef.current('detail.interested_btn')
            : tRef.current('detail.not_going_btn'),
        cancelLabel: tRef.current('detail.cancel'),
        status: 'warning',
      });
      if (!accepted) return;
    }

    // If already this status, cancel (remove RSVP).
    if (isClearingCurrentStatus) {
      try {
        setIsSubmitting(true);
        const response = await eventsApi.removeRsvp(event.id);
        if (response.success) {
          await loadEvent();
          toastRef.current.success(tRef.current('toast.rsvp_removed'));
        } else {
          toastRef.current.error(tRef.current('toast.rsvp_cancel_failed'));
        }
      } catch (err) {
        logError('Failed to cancel RSVP', err);
        toastRef.current.error(tRef.current('toast.something_wrong'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await eventsApi.rsvp(event.id, newStatus);
      if (response.success && response.data) {
        const rsvpData = response.data;

        // Check if user was waitlisted instead
        if (rsvpData.relationship.registration.state === 'waitlisted') {
          setIsWaitlisted(true);
          setWaitlistPosition(rsvpData.relationship.registration.waitlist_position);
          toastRef.current.info(rsvpData.message || tRef.current('toast.added_to_waitlist'));
          return;
        }

        await loadEvent();

        const messages: Record<RsvpOption, string> = {
          going: tRef.current('toast.rsvp_going'),
          interested: tRef.current('toast.rsvp_interested'),
          not_going: tRef.current('toast.rsvp_not_going'),
        };
        toastRef.current.success(messages[newStatus]);
      } else {
        toastRef.current.error(tRef.current('toast.rsvp_failed'));
      }
    } catch (err) {
      logError('Failed to update RSVP', err);
      toastRef.current.error(tRef.current('toast.something_wrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleShare() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toastRef.current.success(tRef.current('toast.share_copied'));
    } catch {
      // Fallback for older browsers
      toastRef.current.error(tRef.current('toast.share_failed'));
    }
  }

  async function handleArchive() {
    if (!event) return;

    try {
      setIsArchiving(true);
      archiveMutationKeyRef.current ??= eventMutationKey('archive', event.id);
      const response = await eventsApi.archive(
        event.id,
        archiveMutationKeyRef.current,
        archiveReason,
      );
      if (response.success && response.data?.archived) {
        toastRef.current.success(tRef.current('toast.archived'));
        navigate(tenantPath('/events'));
      } else {
        toastRef.current.error(tRef.current('toast.archive_failed'));
      }
    } catch (err) {
      logError('Failed to archive event', err);
      toastRef.current.error(tRef.current('toast.something_wrong'));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleCalendarDownload() {
    if (!event) return;
    setIsDownloadingCalendar(true);
    try {
      await eventsApi.downloadEventCalendar(event.id);
    } catch (downloadError) {
      logError('Failed to download event calendar file', downloadError);
      toastRef.current.error(tRef.current('calendar_actions.download_error'));
    } finally {
      setIsDownloadingCalendar(false);
    }
  }

  async function handleCancelEvent() {
    if (!event) return;
    const reason = cancelReason.trim();
    if (!reason) {
      toastRef.current.error(tRef.current('toast.cancel_reason_required'));
      return;
    }

    try {
      setIsCancelling(true);
      cancelMutationKeyRef.current ??= eventMutationKey('cancel', event.id);
      const response = await eventsApi.cancel(event.id, reason, cancelMutationKeyRef.current);
      if (response.success) {
        await loadEvent();
        toastRef.current.success(tRef.current('toast.event_cancelled'));
        setShowCancelModal(false);
      } else {
        toastRef.current.error(tRef.current('toast.cancel_failed'));
      }
    } catch (err) {
      logError('Failed to cancel event', err);
      toastRef.current.error(tRef.current('toast.something_wrong'));
    } finally {
      setIsCancelling(false);
    }
  }

  async function handlePublication(action: 'submit_for_review' | 'publish') {
    if (!event || isPublishing) return;
    const label = action === 'submit_for_review'
      ? tRef.current('detail.submit_for_review')
      : tRef.current('detail.publish_event');
    const accepted = await confirm({
      title: label,
      body: tRef.current(action === 'submit_for_review'
        ? 'detail.submit_for_review_confirm'
        : 'detail.publish_event_confirm'),
      confirmLabel: label,
      cancelLabel: tRef.current('detail.cancel'),
      status: action === 'publish' ? 'warning' : 'accent',
    });
    if (!accepted) return;

    setIsPublishing(true);
    try {
      const response = action === 'submit_for_review'
        ? await eventsApi.submitForReview(event.id)
        : await eventsApi.publish(event.id);
      if (!response.success || !response.data) {
        toast.error(t('detail.publication_failed'));
        return;
      }
      setEvent(response.data);
      toast.success(action === 'submit_for_review'
        ? t('detail.submitted_for_review')
        : t('detail.published_successfully'));
    } catch (publicationError) {
      logError('Failed to transition Event publication', publicationError);
      toast.error(t('detail.publication_failed'));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleJoinWaitlist() {
    if (!event || !event.relationship.registration.can_join_waitlist) return;

    try {
      setIsSubmitting(true);
      const response = await eventsApi.joinWaitlist(event.id);
      if (response.success && response.data) {
        setIsWaitlisted(true);
        setWaitlistPosition(response.data.position ?? null);
        await loadEvent();
        toastRef.current.success(tRef.current('toast.added_to_waitlist'));
      } else {
        toastRef.current.error(tRef.current('toast.waitlist_join_failed'));
      }
    } catch (err) {
      logError('Failed to join waitlist', err);
      toastRef.current.error(tRef.current('toast.something_wrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLeaveWaitlist() {
    if (!event || !event.relationship.registration.can_leave_waitlist) return;

    const accepted = await confirm({
      title: tRef.current('detail.leave_waitlist'),
      body: tRef.current('community:waitlist.leave_confirm'),
      confirmLabel: tRef.current('detail.leave_waitlist'),
      cancelLabel: tRef.current('detail.cancel'),
      status: 'warning',
    });
    if (!accepted) return;

    try {
      setIsSubmitting(true);
      const response = await eventsApi.leaveWaitlist(event.id);
      if (response.success) {
        setIsWaitlisted(false);
        setWaitlistPosition(null);
        await loadEvent();
        toastRef.current.success(tRef.current('toast.removed_from_waitlist'));
      }
    } catch (err) {
      logError('Failed to leave waitlist', err);
      toastRef.current.error(tRef.current('toast.something_wrong'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAcceptWaitlistOffer() {
    if (!event) return;

    try {
      setIsSubmitting(true);
      acceptOfferMutationKeyRef.current ??= eventMutationKey('accept-offer', event.id);
      const response = await eventsApi.acceptWaitlistOffer(
        event.id,
        acceptOfferMutationKeyRef.current,
      );
      if (response.success && response.data) {
        acceptOfferMutationKeyRef.current = null;
        setIsWaitlisted(false);
        setWaitlistPosition(null);
        await loadEvent();
        toastRef.current.success(tRef.current('detail.offer_accepted'));
      } else {
        toastRef.current.error(tRef.current('detail.offer_accept_failed'));
      }
    } catch (err) {
      logError('Failed to accept event waitlist offer', err);
      toastRef.current.error(tRef.current('detail.offer_accept_failed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  const canCheckIn = event?.permissions.check_in ?? false;
  const canOpenManagement = Boolean(event && (
    event.permissions.edit
    || event.permissions.cancel
    || event.permissions.manage_people
    || event.permissions.check_in
    || event.permissions.manage_staff
  ));
  const isCancelled = event?.schedule.operational_state === 'cancelled';
  const isPostponed = event?.schedule.operational_state === 'postponed';
  const isCompleted = event?.schedule.operational_state === 'completed';
  const isArchived = event?.schedule.publication_state === 'archived';
  const isPendingReview = event?.schedule.publication_state === 'pending_review';
  const isDraft = event?.schedule.publication_state === 'draft';
  const hasActiveWaitlistOffer = event?.relationship.registration.state === 'offered';
  const getAttendeeName = (attendee: EventRosterMember) =>
    attendee.member.display_name || t('detail.community_member');

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6" role="status" aria-live="polite" aria-busy="true">
        <PageMeta title={t('detail.loading')} noIndex />
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Card className="overflow-hidden border border-theme-default bg-theme-surface/80 shadow-xl" radius="lg">
          <Skeleton className="h-64 w-full rounded-none" />
          <CardBody className="space-y-5 p-5 sm:p-8">
            <Skeleton className="h-10 w-3/4 rounded-lg" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
            <Skeleton className="h-28 rounded-lg" />
          </CardBody>
        </Card>
        <span className="sr-only">{t('detail.loading')}</span>
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageMeta title={t('detail.unable_to_load')} noIndex />
        <GlassCard role="alert" className="p-8 text-center">
          <AlertCircle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('detail.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <div className="flex justify-center gap-3">
            <Button as={Link} to={tenantPath("/events")}
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
            >
              {t('detail.browse_events')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadEvent()}
            >
              {t('detail.try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!event) {
    return (
      <>
        <PageMeta title={t('detail.not_found')} noIndex />
        <EmptyState
          icon={<AlertCircle className="w-12 h-12" aria-hidden="true" />}
          title={t('detail.not_found')}
          description={t('detail.not_found_desc')}
          action={
            <Button as={Link} to={tenantPath("/events")} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
              {t('detail.browse_events')}
            </Button>
          }
        />
      </>
    );
  }

  const startDate = new Date(event.schedule.start_at ?? event.created_at ?? 0);
  const endDate = event.schedule.end_at ? new Date(event.schedule.end_at) : null;
  const formattingLocale = getFormattingLocale();
  let eventTimezone = event.schedule.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat(formattingLocale, { timeZone: eventTimezone }).format(startDate);
  } catch {
    eventTimezone = 'UTC';
  }
  const isPast = event.schedule.state === 'ended' || isCompleted;
  const goingCount = event.metrics.confirmed_count;
  const interestedCount = event.metrics.interested_count;
  const dateBadgeMonth = formatDateValue(startDate, {
    month: 'short',
    timeZone: eventTimezone,
  });
  const startMonthLabel = dateBadgeMonth.toLocaleUpperCase(formattingLocale);
  const startDayLabel = formatDateValue(startDate, {
    day: 'numeric',
    timeZone: eventTimezone,
  });
  const visibleEndDate = endDate && event.schedule.all_day
    ? new Date(endDate.getTime() - 1)
    : endDate;
  const dateFormatter = new Intl.DateTimeFormat(formattingLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: eventTimezone,
  });
  const rangeFormatter = dateFormatter as Intl.DateTimeFormat & {
    formatRange?: (start: Date, end: Date) => string;
  };
  const fullDateLabel = visibleEndDate
    && dateFormatter.format(startDate) !== dateFormatter.format(visibleEndDate)
    ? rangeFormatter.formatRange?.(startDate, visibleEndDate)
      ?? `${dateFormatter.format(startDate)} – ${dateFormatter.format(visibleEndDate)}`
    : dateFormatter.format(startDate);
  const startTimeLabel = event.schedule.all_day
    ? t('calendar.all_day')
    : formatDateTime(startDate, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: eventTimezone,
        timeZoneName: 'short',
      });
  const endTimeLabel = endDate && !event.schedule.all_day
    ? formatDateTime(endDate, {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: eventTimezone,
        timeZoneName: 'short',
      })
    : null;
  const eventImage = event.primary_image?.url
    ? resolveThumbnailUrl(event.primary_image.url, { width: 1200, height: 675 })
    : undefined;
  const eventImageProps = event.primary_image?.url
    ? responsiveThumbnailProps(event.primary_image.url, {
        width: 1200,
        height: 675,
        sizes: '(min-width: 1024px) 896px, 100vw',
      })
    : null;
  const organizerName = event.organizer.display_name || t('detail.community_member');
  const seoDescription = event.description?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 160)
    || t('detail.meta_description_fallback', {
      title: event.title,
      date: fullDateLabel,
      location: event.location.label || t('detail.remote_attendance_available'),
      organizer: organizerName,
    });
  const attendanceTotal = goingCount + interestedCount;
  const canRegister = event.relationship.registration.can_register;
  const canWithdraw = event.relationship.registration.can_withdraw;
  const canJoinWaitlist = event.relationship.registration.can_join_waitlist;
  const canLeaveWaitlist = event.relationship.registration.can_leave_waitlist;
  const canChangeEngagement = event.relationship.engagement.can_change;
  const showGoingAction = canRegister;
  const showInterestedAction = canChangeEngagement;
  const showNotGoingAction = canWithdraw || canChangeEngagement;
  const hasRsvpActions = showGoingAction || showInterestedAction || showNotGoingAction;
  const hasRelationshipActions = canRegister
    || canWithdraw
    || canJoinWaitlist
    || canLeaveWaitlist
    || canChangeEngagement;
  const hasOnlineAccess = event.online_access.reveal_state === 'available'
    && Boolean(event.online_access.video_url || event.online_access.join_url);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      <PageMeta
        title={event.title}
        description={seoDescription}
        image={eventImage}
        type="article"
        publishedTime={event.created_at ?? undefined}
        modifiedTime={event.updated_at ?? event.created_at ?? undefined}
      />
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Event',
            name: event.title,
            ...(event.description ? { description: event.description.substring(0, 300) } : {}),
            startDate: event.schedule.start_at,
            ...(event.schedule.end_at ? { endDate: event.schedule.end_at } : {}),
            ...(event.location.label ? { location: { '@type': 'Place', name: event.location.label } } : {}),
            ...(eventImage ? { image: eventImage } : {}),
            organizer: {
              '@type': 'Person',
              name: organizerName,
            },
          }).replace(/</g, '\\u003c')}
        </script>
      </Helmet>

      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: '/events' },
        { label: event?.title || t('title') },
      ]} />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-theme-default bg-theme-surface shadow-xl">
        {eventImageProps ? (
          <img
            {...eventImageProps}
            alt={t('detail.cover_alt', { title: event.title })}
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 via-accent/10 to-emerald-500/20" aria-hidden="true" />
        )}
        <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
        <div className="relative flex min-h-[22rem] flex-col justify-between gap-8 p-5 sm:min-h-[26rem] sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {isPast && (
                <Chip variant="flat" color="default" size="sm">
                  {t('detail.past_event')}
                </Chip>
              )}
              {isCancelled && (
                <Chip variant="flat" color="danger" size="sm">
                  {t('detail.event_cancelled')}
                </Chip>
              )}
              {isPostponed && (
                <Chip variant="flat" color="warning" size="sm">
                  {t('detail.event_postponed')}
                </Chip>
              )}
              {isCompleted && (
                <Chip variant="flat" color="success" size="sm">
                  {t('detail.event_completed')}
                </Chip>
              )}
              {isArchived && (
                <Chip variant="flat" color="default" size="sm">
                  {t('detail.event_archived')}
                </Chip>
              )}
              {isPendingReview && (
                <Chip variant="flat" color="warning" size="sm">
                  {t('detail.event_pending_review')}
                </Chip>
              )}
              {isDraft && !isArchived && (
                <Chip variant="flat" color="default" size="sm">
                  {t('detail.event_draft')}
                </Chip>
              )}
              {event.category?.name && (
                <Chip variant="flat" color="secondary" size="sm" className="max-w-full">
                  <span className="truncate">{event.category.name}</span>
                </Chip>
              )}
              {event.series.recurrence && (
                <Chip variant="flat" color="secondary" size="sm" startContent={<Repeat className="w-3 h-3" aria-hidden="true" />}>
                  {t('detail.recurring_event')}
                </Chip>
              )}
              {hasFeature('event_attendance_credits') && (event.attendance_credit_amount ?? 0) > 0 && !isPast && !isCancelled && (
                <Chip variant="flat" color="success" size="sm" startContent={<Gift className="w-3 h-3" aria-hidden="true" />}>
                  {t('detail.attendance_reward_badge', { amount: event.attendance_credit_amount })}
                </Chip>
              )}
              {event.location.mode !== 'in_person' && (
                <Chip variant="flat" color="primary" size="sm" startContent={<Video className="w-3 h-3" aria-hidden="true" />}>
                  {t('detail.remote_attendance_available')}
                </Chip>
              )}
            </div>

            {(canOpenManagement
              || event.permissions.submit_for_review
              || event.permissions.publish
              || (event.permissions.edit && !isArchived)
              || (event.permissions.cancel && !isCancelled)) && (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {event.permissions.submit_for_review && <Button
                  size="sm"
                  isLoading={isPublishing}
                  onPress={() => void handlePublication('submit_for_review')}
                  startContent={<Send className="w-4 h-4" aria-hidden="true" />}
                  aria-label={t('detail.submit_for_review_aria', { title: event.title })}
                >
                  {t('detail.submit_for_review')}
                </Button>}
                {event.permissions.publish && <Button
                  size="sm"
                  isLoading={isPublishing}
                  onPress={() => void handlePublication('publish')}
                  startContent={<Send className="w-4 h-4" aria-hidden="true" />}
                  aria-label={t('detail.publish_event_aria', { title: event.title })}
                >
                  {t('detail.publish_event')}
                </Button>}
                {canOpenManagement && <Button
                  as={Link}
                  to={tenantPath(`/events/${event.id}/manage`)}
                  size="sm"
                  variant="flat"
                  className="bg-white/15 text-white backdrop-blur-md"
                  startContent={<Settings className="w-4 h-4" aria-hidden="true" />}
                  aria-label={t('detail.manage_event_aria', { title: event.title })}
                >
                  {t('detail.manage')}
                </Button>}
                {event.permissions.edit && !isCancelled && <Button
                  as={Link}
                  to={tenantPath(`/events/${event.id}/edit`)}
                  size="sm"
                  variant="flat"
                  className="bg-white/15 text-white backdrop-blur-md"
                  startContent={<Edit className="w-4 h-4" aria-hidden="true" />}
                  aria-label={t('detail.edit_event_aria', { title: event.title })}
                >
                  {t('detail.edit')}
                </Button>}
                {event.permissions.cancel && !isCancelled && <Button
                  size="sm"
                  variant="flat"
                  className="bg-amber-500/20 text-amber-100 backdrop-blur-md"
                  startContent={<Ban className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => setShowCancelModal(true)}
                  aria-label={t('detail.cancel_event_aria', { title: event.title })}
                >
                  {t('detail.cancel_event')}
                </Button>}
                {event.permissions.edit && !isArchived && <Button
                  size="sm"
                  variant="flat"
                  className="bg-white/15 text-white backdrop-blur-md"
                  startContent={<Archive className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => setShowArchiveModal(true)}
                  aria-label={t('detail.archive_event_aria', { title: event.title })}
                >
                  {t('detail.archive')}
                </Button>}
              </div>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="min-w-0">
              <div className="mb-4 inline-flex min-w-[5.5rem] flex-col items-center rounded-xl border border-white/20 bg-white/15 px-4 py-3 text-center text-white shadow-lg backdrop-blur-md">
                <span className="text-xs font-semibold uppercase">{startMonthLabel}</span>
                <span className="text-4xl font-bold leading-none">{startDayLabel}</span>
              </div>
              <h1 className="max-w-3xl text-3xl font-bold leading-tight text-white sm:text-5xl">
                {event.title}
              </h1>
              {event.series.named && (
                <Link to={tenantPath(`/events?series=${event.series.named.id}`)} className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-sm text-white backdrop-blur-md transition-opacity hover:opacity-90">
                  <Link2 className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{event.series.named.title}</span>
                  <span className="text-white/75">{t('detail.events_in_series', { count: event.series.named.event_count })}</span>
                </Link>
              )}
            </div>

            {isAuthenticated && (rsvpStatus || isWaitlisted) && (
              <div className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end">
                {rsvpStatus && (
                  <Chip
                    variant="flat"
                    color={rsvpStatus === 'going' ? 'success' : rsvpStatus === 'interested' ? 'warning' : 'default'}
                    size="lg"
                    startContent={
                      rsvpStatus === 'going'
                        ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        : rsvpStatus === 'interested'
                          ? <Heart className="w-4 h-4" aria-hidden="true" />
                          : <XCircle className="w-4 h-4" aria-hidden="true" />
                    }
                  >
                    {rsvpStatus === 'going' ? t('detail.rsvp_going') : rsvpStatus === 'interested' ? t('detail.rsvp_interested') : t('detail.rsvp_not_going')}
                  </Chip>
                )}
                {isWaitlisted && (
                  <Chip variant="flat" color="warning" size="lg" startContent={<ListOrdered className="w-4 h-4" aria-hidden="true" />}>
                    {hasActiveWaitlistOffer
                      ? t('detail.offer_state_chip')
                      : waitlistPosition
                        ? t('detail.on_waitlist_position', { position: waitlistPosition })
                        : t('detail.on_waitlist')}
                  </Chip>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Main Content */}
      <GlassCard className="p-6 sm:p-8">
        {/* E5: Cancellation Banner */}
        {isCancelled && (
          <div role="alert" className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-3">
              <Ban className="w-5 h-5 text-red-400 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="text-theme-danger font-semibold">{t('detail.event_cancelled')}</p>
                {event.schedule.cancellation_reason && (
                  <p className="text-red-300/80 text-sm mt-1">{t('detail.cancellation_reason', { reason: event.schedule.cancellation_reason })}</p>
                )}
              </div>
            </div>
          </div>
        )}
        {isPostponed && (
          <div role="status" className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <p className="font-semibold text-theme-warning">
                {t('detail.event_postponed')}
              </p>
            </div>
          </div>
        )}
        {(isDraft || isPendingReview || isArchived) && (
          <div role="status" className="mb-6 rounded-xl border border-theme-default bg-theme-elevated p-4">
            <p className="font-semibold text-theme-primary">
              {isArchived
                ? t('detail.event_archived')
                : isPendingReview
                  ? t('detail.event_pending_review')
                  : t('detail.event_draft')}
            </p>
            <p className="mt-1 text-sm text-theme-muted">
              {t('detail.lifecycle_private_notice')}
            </p>
          </div>
        )}

        {/* Attendee Count Breakdown with Capacity Info (E2) */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Surface variant="secondary" className="rounded-lg border border-theme-default p-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-theme-muted">
              <Badge isDot color="success" size="sm" />
              <span>{t('detail.going_count')}</span>
            </div>
            <span className="text-theme-primary font-medium">{goingCount}</span>
          </Surface>
          <Surface variant="secondary" className="rounded-lg border border-theme-default p-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-theme-muted">
              <Badge isDot color="warning" size="sm" />
              <span>{t('detail.interested_count')}</span>
            </div>
            <span className="text-theme-primary font-medium">{interestedCount}</span>
          </Surface>
          {event.relationship.capacity.limit != null && (
            <Surface variant="secondary" className="rounded-lg border border-theme-default p-4">
              <div className="mb-2 flex items-center gap-2 text-sm text-theme-muted">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('detail.capacity_label')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-theme-primary font-medium">{t('detail.max_capacity', { count: event.relationship.capacity.limit })}</span>
                {event.relationship.capacity.is_full && (
                  <Chip size="sm" variant="flat" color="danger">{t('detail.event_full')}</Chip>
                )}
              </div>
              {event.relationship.capacity.remaining != null && event.relationship.capacity.remaining > 0 && (
                <Chip size="sm" variant="flat" color={event.relationship.capacity.remaining <= 3 ? 'danger' : 'success'} className="mt-2">
                  {t('detail.spots_left', { count: event.relationship.capacity.remaining })}
                </Chip>
              )}
            </Surface>
          )}
          {event.metrics.waitlist_count > 0 && (
            <Surface variant="secondary" className="rounded-lg border border-theme-default p-4">
              <div className="mb-2 flex items-center gap-2 text-sm text-theme-muted">
                <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('detail.waitlist_label')}</span>
              </div>
              <span className="text-theme-primary font-medium">{t('detail.waitlist_count', { count: event.metrics.waitlist_count })}</span>
            </Surface>
          )}
        </div>

        {/* Meta Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-theme-default bg-theme-elevated p-4 text-theme-muted">
            <div className="flex-shrink-0 rounded-lg bg-amber-500/20 p-2">
              <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-theme-subtle">{t('detail.date_label')}</div>
              <time dateTime={event.schedule.start_at ?? undefined} className="block truncate text-theme-primary">
                {fullDateLabel}
              </time>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-theme-default bg-theme-elevated p-4 text-theme-muted">
            <div className="flex-shrink-0 rounded-lg bg-accent/20 p-2">
              <Clock className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-theme-subtle">{t('detail.time_label')}</div>
              <div className="truncate text-theme-primary">
                <time dateTime={event.schedule.start_at ?? undefined}>
                  {startTimeLabel}
                </time>
                {endDate && endTimeLabel && (
                  <>
                    {' - '}
                    <time dateTime={event.schedule.end_at ?? undefined}>
                      {endTimeLabel}
                    </time>
                  </>
                )}
              </div>
            </div>
          </div>

          {event.location.label && (
            <div className="flex min-w-0 items-center gap-3 rounded-lg border border-theme-default bg-theme-elevated p-4 text-theme-muted sm:col-span-2 lg:col-span-1">
              <div className="flex-shrink-0 rounded-lg bg-emerald-500/20 p-2">
                <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-theme-subtle">{t('detail.location_label')}</div>
                <div className="truncate text-theme-primary">{event.location.label}</div>
              </div>
            </div>
          )}
        </div>

        {/* Location Map */}
        {event.location.label && event.location.mode !== 'online' && event.location.latitude !== null && event.location.longitude !== null && (
          <LocationMapCard
            title={t('detail.event_location')}
            locationText={event.location.label}
            markers={[{
              id: event.id,
              lat: event.location.latitude,
              lng: event.location.longitude,
              title: event.title,
            }]}
            center={{ lat: event.location.latitude, lng: event.location.longitude }}
            mapHeight="250px"
            zoom={15}
            className="mt-6"
          />
        )}

        {event.location.mode !== 'online' && event.location.accessibility?.provided && (
          <div className="mt-6">
            <EventVenueAccessibilityCard profile={event.location.accessibility} />
          </div>
        )}

        {/* Tabs: Details / Agenda / Attendees / authorised check-in */}
        <Tabs
          className="w-full min-w-0"
          selectedKey={activeTab}
          onSelectionChange={(key) => {
            const nextTab = String(key);
            setActiveTab(nextTab);
            const nextParams = new URLSearchParams(searchParams);
            if (nextTab === 'details') nextParams.delete('tab');
            else nextParams.set('tab', nextTab);
            setSearchParams(nextParams, { replace: true });
          }}
        >
          <Tabs.ListContainer className="max-w-full overflow-x-auto border-b border-theme-default">
            <Tabs.List aria-label={t('detail.tabs_aria')} className="min-w-max gap-1">
              <Tabs.Tab
                id="details"
                className="min-h-10 min-w-fit px-4 text-sm font-medium text-theme-muted data-[selected=true]:text-theme-primary"
              >
                {t('detail.tab_details')}
              </Tabs.Tab>
              <Tabs.Tab
                id="agenda"
                className="min-h-10 min-w-fit px-4 text-sm font-medium text-theme-muted data-[selected=true]:text-theme-primary"
              >
                <ListOrdered className="h-4 w-4" aria-hidden="true" />
                {t('manage.tab_agenda')}
              </Tabs.Tab>
              {canViewTickets && (
                <Tabs.Tab
                  id="tickets"
                  className="min-h-10 min-w-fit px-4 text-sm font-medium text-theme-muted data-[selected=true]:text-theme-primary"
                >
                  <Ticket className="h-4 w-4" aria-hidden="true" />
                  {t('event_tickets:tickets.title')}
                </Tabs.Tab>
              )}
              <Tabs.Tab
                id="attendees"
                className="min-h-10 min-w-fit px-4 text-sm font-medium text-theme-muted data-[selected=true]:text-theme-primary"
              >
                {t('detail.tab_attendees')}
                <Chip size="sm" variant="flat" color="default">{goingCount + interestedCount}</Chip>
              </Tabs.Tab>
              {canCheckIn && (
                <Tabs.Tab
                  id="checkin"
                  className="min-h-10 min-w-fit px-4 text-sm font-medium text-theme-muted data-[selected=true]:text-theme-primary"
                >
                  <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
                  {t('detail.tab_checkin')}
                </Tabs.Tab>
              )}
            </Tabs.List>
          </Tabs.ListContainer>

        {/* Tab Content */}
        <Tabs.Panel id="details" className="pt-6 outline-none">
          <AnimatePresence mode="wait">
          {activeTab === 'details' && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {/* Description */}
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-3">{t('detail.about')}</h2>
                <div className="prose prose-invert max-w-none">
                  <SafeHtml content={translatedEventDesc ?? event.description ?? ''} className="text-theme-muted whitespace-pre-wrap" as="div" />
                </div>
                {event.description && (
                  <TranslateButton
                    contentType="event"
                    contentId={event.id}
                    sourceText={event.description}
                    sourceLocale={null}
                    onTextChange={(text, isTranslated) => setTranslatedEventDesc(isTranslated ? text : null)}
                    className="mt-1"
                  />
                )}
              </div>

              {/* Organizer */}
              {event.organizer.display_name && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold text-theme-primary mb-3">{t('detail.organized_by')}</h2>
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={resolveAvatarUrl(event.organizer.avatar_url)}
                      name={event.organizer.display_name}
                      size="sm"
                    />
                    <span className="text-theme-primary font-medium">
                      {event.organizer.display_name}
                    </span>
                  </div>
                </div>
              )}

              {/* Event Polls */}
              {!isLoadingPolls && eventPolls.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                    {t('polls.title')}
                  </h2>
                  <div className="space-y-4">
                    {eventPolls.map((poll) => (
                      <Card
                        key={poll.id}
                        className="bg-theme-elevated border border-theme-default"
                      >
                        <CardBody className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-theme-primary font-medium">{poll.question}</h3>
                            <Chip
                              size="sm"
                              variant="flat"
                              color={poll.status === 'open' ? 'success' : 'default'}
                            >
                              {poll.status === 'open' ? t('polls.status_open') : t('polls.status_closed')}
                            </Chip>
                          </div>
                          {poll.description && (
                            <p className="text-theme-muted text-sm">{poll.description}</p>
                          )}

                          {/* Show results if voted or poll is closed */}
                          {(poll.has_voted || poll.status === 'closed') ? (
                            <div className="space-y-2">
                              {poll.options.map((opt) => (
                                <div key={opt.id} className="space-y-1">
                                  <div className="flex items-center justify-between text-sm">
                                    <span className={`text-theme-primary ${poll.voted_option_id === opt.id ? 'font-semibold' : ''}`}>
                                      {opt.label || opt.text}
                                      {poll.voted_option_id === opt.id && (
                                        <CheckCircle2 className="w-3.5 h-3.5 inline ml-1 text-emerald-500" aria-hidden="true" />
                                      )}
                                    </span>
                                    <span className="text-theme-subtle">{opt.percentage}%</span>
                                  </div>
                                  <div className="w-full h-2 rounded-full bg-theme-hover overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-accent to-accent-gradient-end transition-all duration-500"
                                      style={{ width: `${opt.percentage}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                              <p className="text-xs text-theme-subtle mt-2">
                                {t('polls.total_votes', { count: poll.total_votes })}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {poll.options.map((opt) => (
                                <Button
                                  key={opt.id}
                                  variant="flat"
                                  className="w-full justify-start bg-theme-hover text-theme-primary hover:bg-accent/20 transition-colors"
                                  onPress={() => handlePollVote(poll.id, opt.id)}
                                  isLoading={votingPollId === poll.id}
                                  isDisabled={votingPollId !== null}
                                >
                                  {opt.label || opt.text}
                                </Button>
                              ))}
                            </div>
                          )}

                          {/* Link to full poll page */}
                          <Button as={Link} to={tenantPath(`/polls/${poll.id}`)}
                            variant="light"
                            size="sm"
                            className="block text-accent dark:text-accent p-0"
                          >
                            {t('polls.view_full')}
                          </Button>
                        </CardBody>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              {isLoadingPolls && (
                <div role="status" aria-busy="true" aria-label={t('polls.loading')} className="mb-8 space-y-3">
                  <Skeleton className="w-48 h-6 rounded-lg" />
                  <Skeleton className="w-full h-32 rounded-lg" />
                </div>
              )}

              {/* Quick Attendee Preview */}
              {attendees.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                    <Users className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                    {t('detail.attendees')}
                  </h2>
                  <div className="flex items-center gap-4">
                    <AvatarGroup max={8}>
                      {attendees.map((attendee) => (
                        <Avatar
                          key={attendee.member.id}
                          src={resolveAvatarUrl(attendee.member.avatar_url)}
                          name={getAttendeeName(attendee)}
                          size="sm"
                          className="ring-2 ring-black/50"
                        />
                      ))}
                    </AvatarGroup>
                    {(goingCount + interestedCount) > attendees.length && (
                      <span className="text-theme-subtle text-sm">
                        {t('detail.more_attendees', { count: (goingCount + interestedCount) - attendees.length })}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}
          </AnimatePresence>
        </Tabs.Panel>

        <Tabs.Panel id="agenda" className="pt-6 outline-none">
          <AnimatePresence mode="wait">
          {activeTab === 'agenda' && (
            <motion.div
              key="agenda"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <EventAgendaWorkspace event={event} />
            </motion.div>
          )}
          </AnimatePresence>
        </Tabs.Panel>

        {canViewTickets && event.schedule.start_at && (
          <Tabs.Panel id="tickets" className="pt-6 outline-none">
            <AnimatePresence mode="wait">
            {activeTab === 'tickets' && (
            <motion.div
              key="tickets"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <EventTicketsPanel
                eventId={event.id}
                eventStart={event.schedule.start_at}
                eventTimezone={event.schedule.timezone}
              />
            </motion.div>
            )}
            </AnimatePresence>
          </Tabs.Panel>
        )}

        <Tabs.Panel id="attendees" className="pt-6 outline-none">
          <AnimatePresence mode="wait">
            {activeTab === 'attendees' && (
              <motion.div
                key="attendees"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                {rosterLoadError && (
                  <Surface
                    variant="secondary"
                    className="rounded-xl border border-red-500/30 p-4"
                  >
                    <div role="alert" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-theme-primary">{t('manage.people.load_error_title')}</p>
                        <p className="text-sm text-theme-muted">{t('manage.people.load_error_desc')}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="flat"
                        startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                        onPress={() => loadRosterPage(rosterCursor, attendees.length > 0)}
                        isDisabled={isRosterLoading}
                      >
                        {t('manage.try_again')}
                      </Button>
                    </div>
                  </Surface>
                )}

                {isRosterLoading && attendees.length === 0 && !rosterLoadError && (
                  <div role="status" aria-live="polite" className="py-10 text-center text-sm text-theme-muted">
                    {t('manage.people.loading')}
                  </div>
                )}

                {!isRosterLoading && !rosterLoadError && attendees.length === 0 && (
                  <EmptyState
                    icon={<Users className="w-10 h-10 text-theme-subtle" aria-hidden="true" />}
                    title={t('detail.no_attendees_title')}
                    description={t('detail.no_attendees')}
                    className="py-10"
                  />
                )}

                {attendees.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {attendees.map((attendee) => (
                      <div key={attendee.member.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-theme-default bg-theme-elevated p-3">
                        <Avatar
                          src={resolveAvatarUrl(attendee.member.avatar_url)}
                          name={getAttendeeName(attendee)}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-theme-primary font-medium truncate">
                            {getAttendeeName(attendee)}
                          </p>
                        </div>
                        <Chip
                          size="sm"
                          variant="flat"
                          color={
                            attendee.registration.state === 'confirmed'
                              ? 'success'
                              : attendee.engagement.state === 'interested'
                                ? 'warning'
                                : 'default'
                          }
                        >
                          {attendee.registration.state === 'confirmed'
                            ? t('detail.attendee_going')
                            : attendee.engagement.state === 'interested'
                              ? t('detail.attendee_interested')
                              : t('detail.attendee_rsvp')}
                        </Chip>
                        {attendee.attendance.state !== 'not_checked_in' && (
                          <Chip size="sm" variant="flat" color="success" startContent={<UserCheck className="w-3 h-3" aria-hidden="true" />}>
                            {t('detail.attendee_checked_in')}
                          </Chip>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!rosterLoadError && rosterHasMore && rosterCursor && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="flat"
                      isLoading={isRosterLoading}
                      onPress={() => loadRosterPage(rosterCursor, true)}
                    >
                      {t('detail.more_attendees', {
                        count: Math.max(1, attendanceTotal - attendees.length),
                      })}
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Tabs.Panel>

        {canCheckIn && (
          <Tabs.Panel id="checkin" className="pt-6 outline-none">
            <AnimatePresence mode="wait">
              {activeTab === 'checkin' && (
                <motion.div
                  key="checkin"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <EventCheckInWorkspace eventId={event.id} />
                </motion.div>
              )}
            </AnimatePresence>
          </Tabs.Panel>
        )}
        </Tabs>

        {/* Action Buttons */}
        {isAuthenticated && (hasRelationshipActions || hasActiveWaitlistOffer || hasOnlineAccess || (!isPast && !isCancelled)) && (
          <div className="mt-8 rounded-xl border border-theme-default bg-theme-elevated p-4">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-theme-primary">{t('detail.rsvp_panel_title')}</h2>
                <p className="text-sm text-theme-muted">{t('detail.rsvp_panel_desc')}</p>
              </div>
              <span className="text-sm text-theme-subtle">
                {t('detail.attendance_total', { count: attendanceTotal })}
              </span>
            </div>
            {hasActiveWaitlistOffer && (
              <Surface
                variant="secondary"
                className="mb-4 flex flex-col gap-4 rounded-lg border border-emerald-500/30 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex gap-3" role="status" aria-live="polite">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-theme-primary">{t('detail.offer_available_title')}</p>
                    <p className="text-sm text-theme-muted">{t('detail.offer_available_description')}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    color="success"
                    startContent={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                    onPress={handleAcceptWaitlistOffer}
                    isLoading={isSubmitting}
                    aria-label={t('detail.accept_offer_aria')}
                  >
                    {t('detail.accept_offer')}
                  </Button>
                  {canLeaveWaitlist && (
                    <Button
                      variant="flat"
                      startContent={<XCircle className="h-4 w-4" aria-hidden="true" />}
                      onPress={handleLeaveWaitlist}
                      isDisabled={isSubmitting}
                      aria-label={t('detail.decline_offer_aria')}
                    >
                      {t('detail.decline_offer')}
                    </Button>
                  )}
                </div>
              </Surface>
            )}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* RSVP Options — single-select toggle; clicking the active option clears
                  the RSVP (handleRsvp cancels when newStatus === current). The group is
                  disabled while a request is in flight. */}
              {(hasRsvpActions || canJoinWaitlist || canLeaveWaitlist) && (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:items-center">
                {!hasActiveWaitlistOffer && hasRsvpActions && <ToggleButtonGroup
                  aria-label={t('detail.rsvp_aria')}
                  selectionMode="single"
                  isDetached
                  isDisabled={isSubmitting}
                  selectedKeys={rsvpStatus ? new Set([rsvpStatus]) : new Set()}
                  onSelectionChange={(keys) => {
                    const [k] = Array.from(keys);
                    const next = (k as RsvpOption | undefined) ?? rsvpStatus;
                    if (next) handleRsvp(next);
                  }}
                  className="grid gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap"
                >
                  {showGoingAction && (
                    <ToggleButton
                      id="going"
                      variant="ghost"
                      aria-label={t('detail.rsvp_going_aria')}
                      className="bg-theme-elevated text-theme-primary transition-colors hover:bg-emerald-500/20 data-[selected=true]:bg-emerald-500 data-[selected=true]:text-white"
                    >
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      {t('detail.going_btn')}
                    </ToggleButton>
                  )}
                  {showInterestedAction && (
                    <ToggleButton
                      id="interested"
                      variant="ghost"
                      aria-label={t('detail.rsvp_interested_aria')}
                      className="bg-theme-elevated text-theme-primary transition-colors hover:bg-amber-500/20 data-[selected=true]:bg-amber-500 data-[selected=true]:text-white"
                    >
                      <Heart className="w-4 h-4" aria-hidden="true" />
                      {t('detail.interested_btn')}
                    </ToggleButton>
                  )}
                  {showNotGoingAction && (
                    <ToggleButton
                      id="not_going"
                      variant="ghost"
                      aria-label={t('detail.rsvp_not_going_aria')}
                      className="bg-theme-elevated text-theme-primary transition-colors hover:bg-theme-hover data-[selected=true]:bg-theme-hover data-[selected=true]:text-theme-muted"
                    >
                      <XCircle className="w-4 h-4" aria-hidden="true" />
                      {t('detail.not_going_btn')}
                    </ToggleButton>
                  )}
                </ToggleButtonGroup>}

                {canJoinWaitlist && (
                  <Button
                    className="bg-theme-elevated text-theme-primary hover:bg-amber-500/20"
                    startContent={<ListOrdered className="w-4 h-4" aria-hidden="true" />}
                    onPress={handleJoinWaitlist}
                    isLoading={isSubmitting}
                    aria-label={t('detail.join_waitlist_aria')}
                  >
                    {t('detail.join_waitlist')}
                  </Button>
                )}
                {canLeaveWaitlist && !hasActiveWaitlistOffer && (
                  <Button
                    className="bg-amber-500/10 text-amber-400"
                    variant="flat"
                    startContent={<XCircle className="w-4 h-4" aria-hidden="true" />}
                    onPress={handleLeaveWaitlist}
                    isLoading={isSubmitting}
                    aria-label={t('detail.leave_waitlist_aria')}
                  >
                    {t('detail.leave_waitlist')}
                  </Button>
                )}
                </div>
              )}

            <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
              {/* Share */}
              <Button
                variant="flat"
                className="bg-theme-surface text-theme-primary"
                startContent={<Copy className="w-4 h-4" aria-hidden="true" />}
                onPress={handleShare}
                aria-label={t('detail.share_aria', { title: event.title })}
              >
                {t('detail.share')}
              </Button>

              {/* INF6: Join Meeting button */}
              {event.online_access.video_url && (
                <Button
                  as="a"
                  href={event.online_access.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                  startContent={<Video className="w-4 h-4" aria-hidden="true" />}
                  aria-label={t('detail.join_meeting_aria', { title: event.title })}
                >
                  {t('detail.join_meeting')}
                </Button>
              )}

              {/* Online event link */}
              {event.online_access.join_url && (
                <Button
                  as="a"
                  href={event.online_access.join_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="flat"
                  className="bg-theme-surface text-theme-primary"
                  startContent={<ExternalLink className="w-4 h-4" aria-hidden="true" />}
                  aria-label={t('detail.event_link_aria', { title: event.title })}
                >
                  {t('detail.event_link')}
                </Button>
              )}
            </div>
            </div>
          </div>
        )}

        {isAuthenticated && calendarActions && (
          <section aria-labelledby="event-calendar-actions" className="mt-4 rounded-xl border border-theme-default bg-theme-elevated p-4">
            <div>
              <h2 id="event-calendar-actions" className="text-base font-semibold text-theme-primary">
                {t('calendar_actions.title')}
              </h2>
              <p className="mt-1 text-sm text-theme-muted">{t('calendar_actions.description')}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="flat"
                isLoading={isDownloadingCalendar}
                startContent={<Download className="h-4 w-4" aria-hidden="true" />}
                onPress={handleCalendarDownload}
              >
                {t('calendar_actions.download')}
              </Button>
              <Button
                as="a"
                href={calendarActions.google_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="flat"
                endContent={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
              >
                {t('calendar_actions.google')}
              </Button>
              <Button
                as="a"
                href={calendarActions.outlook_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="flat"
                endContent={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
              >
                {t('calendar_actions.outlook')}
              </Button>
            </div>
          </section>
        )}

        {isAuthenticated && (
          <div className="mt-4">
            <EventRegistrationAttendeeCard eventId={event.id} />
          </div>
        )}

        {isAuthenticated && !event.permissions.edit && (
          <div className="mt-4">
            <EventSafetyAttendeeCard eventId={event.id} />
          </div>
        )}

        {isAuthenticated && event.relationship.registration.state === 'confirmed' && (
          <div className="mt-4 space-y-4">
            <EventCheckinCredentialCard eventId={event.id} />
            <EventReminderPanel eventId={event.id} />
          </div>
        )}

        <SocialInteractionPanel
          targetType="event"
          targetId={event.id}
          initialLiked={false}
          initialLikesCount={0}
          initialCommentsCount={0}
          title={event.title}
          description={event.description ?? undefined}
          targetOwnerId={event.organizer.id}
          className="mt-8"
        />
      </GlassCard>

      {/* E1: Upcoming dates in this recurring series */}
      {event.series.recurrence && event.series.recurrence.occurrences.length > 1 && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <Repeat className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
            {t('detail.series_dates_title')}
          </h2>
          <div className="space-y-3">
            {event.series.recurrence.occurrences.map((occ) => {
              const occDate = new Date(occ.start_at ?? occ.date ?? 0);
              const monthLabel = formatDateValue(occDate, {
                month: 'short',
                timeZone: eventTimezone,
              }).toLocaleUpperCase(formattingLocale);
              const dayLabel = formatDateValue(occDate, {
                day: 'numeric',
                timeZone: eventTimezone,
              });
              const dateLabel = formatDateTime(occDate, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: eventTimezone,
                timeZoneName: 'short',
              });
              const isCurrent = occ.id === event.id;
              return (
                <Link
                  key={occ.id}
                  to={tenantPath(`/events/${occ.id}`)}
                  aria-current={isCurrent ? 'true' : undefined}
                >
                  <Card
                    isPressable
                    className={`bg-theme-elevated border transition-colors ${isCurrent ? 'border-accent/60' : 'border-theme-default hover:border-accent/50'}`}
                  >
                    <CardBody className="flex flex-row items-center gap-4 p-3">
                      <div className="bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 rounded-lg p-2 text-center min-w-[48px]">
                        <div className="text-accent dark:text-accent text-[10px] font-medium uppercase leading-none">
                          {monthLabel}
                        </div>
                        <div className="text-theme-primary text-lg font-bold leading-tight">
                          {dayLabel}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-theme-primary font-medium truncate">{dateLabel}</p>
                      </div>
                      {isCurrent ? (
                        <Chip size="sm" variant="flat" color="primary">{t('detail.series_this_date')}</Chip>
                      ) : (
                        <ArrowRight className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
                      )}
                    </CardBody>
                  </Card>
                </Link>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* E7: Other Events in This Series */}
      {event.series.named && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <CalendarRange className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
            {t('detail.other_series_events')}
          </h2>

          {isLoadingSeriesEvents ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="w-full h-16 rounded-lg" />
              ))}
            </div>
          ) : seriesEvents.length > 0 ? (
            <div className="space-y-3">
              {seriesEvents.map((seriesEvent) => {
                const evtDate = new Date(seriesEvent.start_at ?? 0);
                const monthLabel = formatDateValue(evtDate, {
                  month: 'short',
                  timeZone: eventTimezone,
                }).toLocaleUpperCase(formattingLocale);
                const dayLabel = formatDateValue(evtDate, {
                  day: 'numeric',
                  timeZone: eventTimezone,
                });
                const timeLabel = formatDateTime(evtDate, {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: eventTimezone,
                  timeZoneName: 'short',
                });
                return (
                  <Link key={seriesEvent.id} to={tenantPath(`/events/${seriesEvent.id}`)}>
                    <Card
                      isPressable
                      className="bg-theme-elevated border border-theme-default hover:border-accent/50 transition-colors"
                    >
                      <CardBody className="flex flex-row items-center gap-4 p-3">
                        {/* Mini Date Badge */}
                        <div className="bg-gradient-to-br from-amber-500/20 to-orange-500/20 rounded-lg p-2 text-center min-w-[48px]">
                          <div className="text-theme-warning text-[10px] font-medium uppercase leading-none">
                            {monthLabel}
                          </div>
                          <div className="text-theme-primary text-lg font-bold leading-tight">
                            {dayLabel}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-theme-primary font-medium truncate">
                            {seriesEvent.title}
                          </p>
                          <p className="text-theme-subtle text-sm">
                            {timeLabel}
                            {seriesEvent.location_label && ` \u00B7 ${seriesEvent.location_label}`}
                          </p>
                        </div>

                        <ArrowRight className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
                      </CardBody>
                    </Card>
                  </Link>
                );
              })}

              {/* View all link */}
              {event.series.named.event_count > 5 && (
                <Button as={Link} to={tenantPath(`/events?series=${event.series.named.id}`)}
                  variant="flat"
                  size="sm"
                  className="block text-center bg-theme-elevated text-theme-primary"
                  endContent={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  {t('detail.view_all_series', { count: event.series.named.event_count })}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-theme-subtle text-sm text-center py-4">
              {t('detail.no_other_series_events')}
            </p>
          )}
        </GlassCard>
      )}

      {/* Archive confirmation preserves event and audit history. */}
      <Modal
        isOpen={showArchiveModal}
        onOpenChange={setShowArchiveModal}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('detail.archive_modal_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('detail.archive_confirm', { title: event.title })}
            </p>
            {!!(event as { is_recurring_template?: number | boolean }).is_recurring_template && (
              <p className="text-sm text-[var(--color-warning)]">
                {t('detail.archive_series_note')}
              </p>
            )}
            <Textarea
              label={t('detail.archive_reason_label')}
              placeholder={t('detail.archive_reason_placeholder')}
              value={archiveReason}
              onValueChange={setArchiveReason}
              minRows={2}
              maxRows={5}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              onPress={() => setShowArchiveModal(false)}
            >
              {t('detail.keep_event')}
            </Button>
            <Button
              className="bg-amber-500 text-white"
              startContent={<Archive className="w-4 h-4" aria-hidden="true" />}
              onPress={handleArchive}
              isLoading={isArchiving}
            >
              {t('detail.archive_confirm_btn')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* E5: Cancel Event Modal */}
      <Modal
        isOpen={showCancelModal}
        onOpenChange={setShowCancelModal}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('detail.cancel_modal_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted mb-4">
              {t('detail.cancel_confirm', { title: event.title })}
            </p>
            {!!(event as { is_recurring_template?: number | boolean }).is_recurring_template && (
              <p className="text-sm text-[var(--color-warning)] mb-4">
                {t('detail.cancel_series_note')}
              </p>
            )}
            <Textarea
              label={t('detail.cancel_reason_label')}
              placeholder={t('detail.cancel_reason_placeholder')}
              value={cancelReason}
              onValueChange={setCancelReason}
              isRequired
              minRows={3}
              maxRows={6}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              onPress={() => setShowCancelModal(false)}
            >
              {t('detail.keep_event')}
            </Button>
            <Button
              className="bg-amber-500 text-white"
              startContent={<Ban className="w-4 h-4" aria-hidden="true" />}
              onPress={handleCancelEvent}
              isLoading={isCancelling}
              isDisabled={!cancelReason.trim()}
            >
              {t('detail.cancel_event')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </motion.div>
  );
}

export default EventDetailPage;
