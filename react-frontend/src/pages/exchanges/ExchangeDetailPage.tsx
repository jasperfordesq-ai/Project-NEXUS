// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
/**
 * Exchange Detail Page - View and manage a single exchange
 *
 * Features:
 * - Status card with current exchange status
 * - Exchange details (listing, parties, hours)
 * - Timeline of status changes with stagger animation
 * - Message link to other party
 * - Action buttons for exchange workflow
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import MessageSquare from 'lucide-react/icons/message-square';
import Play from 'lucide-react/icons/play';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import XCircle from 'lucide-react/icons/circle-x';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Clock from 'lucide-react/icons/clock';
import Circle from 'lucide-react/icons/circle';
import Ban from 'lucide-react/icons/ban';
import UserCheck from 'lucide-react/icons/user-check';
import Star from 'lucide-react/icons/star';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { RatingModal } from '@/components/wallet';
import { VerificationBadgeRow } from '@/components/verification/VerificationBadge';
import { useAuth, useToast, useTenant } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import { EXCHANGE_STATUS_CONFIG, MAX_EXCHANGE_HOURS, getStatusIconBgClass } from '@/lib/exchange-status';
import type { Exchange, ExchangeHistoryEntry, ExchangeRating } from '@/types/api';

/* ───────────────────────── Timeline Helpers ───────────────────────── */

interface TimelineEntry {
  icon: React.ReactNode;
  colorClass: string;
  label: string;
  actor?: string | null;
  timestamp: string;
  notes?: string | null;
}

function getTimelineIcon(action: string, newStatus?: string | null): React.ReactNode {
  const iconClass = 'w-4 h-4';
  if (action === 'created' || newStatus === 'pending_provider' || newStatus === 'pending_broker') {
    return <Circle className={iconClass} aria-hidden="true" />;
  }
  if (action === 'accepted' || newStatus === 'accepted') {
    return <Check className={iconClass} aria-hidden="true" />;
  }
  if (action === 'declined' || newStatus === 'cancelled') {
    return <Ban className={iconClass} aria-hidden="true" />;
  }
  if (action === 'started' || newStatus === 'in_progress') {
    return <Play className={iconClass} aria-hidden="true" />;
  }
  if (action === 'completed' || newStatus === 'completed') {
    return <CheckCircle className={iconClass} aria-hidden="true" />;
  }
  if (action === 'confirmed' || newStatus === 'pending_confirmation') {
    return <UserCheck className={iconClass} aria-hidden="true" />;
  }
  if (newStatus === 'disputed') {
    return <AlertTriangle className={iconClass} aria-hidden="true" />;
  }
  return <Clock className={iconClass} aria-hidden="true" />;
}

function getTimelineColor(action: string, newStatus?: string | null): string {
  // Green for positive actions
  if (
    action === 'accepted' || action === 'confirmed' || action === 'completed' ||
    newStatus === 'accepted' || newStatus === 'completed'
  ) {
    return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
  }
  // Red for negative actions
  if (
    action === 'declined' || action === 'cancelled' ||
    newStatus === 'cancelled' || newStatus === 'disputed'
  ) {
    return 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30';
  }
  // Blue for neutral actions
  return 'bg-accent/20 text-accent dark:text-accent border-accent/30';
}

function getTimelineLabelKey(action: string, newStatus?: string | null): string {
  if (action === 'created') return 'detail.timeline.created';
  if (action === 'accepted' || newStatus === 'accepted') return 'detail.timeline.accepted';
  if (action === 'declined') return 'detail.timeline.declined';
  if (action === 'started' || newStatus === 'in_progress') return 'detail.timeline.started';
  if (action === 'completed' || newStatus === 'completed') return 'detail.timeline.completed';
  if (action === 'confirmed') return 'detail.timeline.confirmed';
  if (action === 'cancelled' || newStatus === 'cancelled') return 'detail.timeline.cancelled';
  if (newStatus === 'pending_confirmation') return 'detail.timeline.awaiting_confirmation';
  if (newStatus === 'pending_broker') return 'detail.timeline.sent_to_broker';
  if (newStatus === 'disputed') return 'detail.timeline.disputed';
  // Fallback: return a key based on the action
  return 'detail.timeline.fallback';
}

function buildTimeline(history: ExchangeHistoryEntry[]): TimelineEntry[] {
  return history.map((entry) => ({
    icon: getTimelineIcon(entry.action, entry.new_status),
    colorClass: getTimelineColor(entry.action, entry.new_status),
    label: getTimelineLabelKey(entry.action, entry.new_status),
    actor: entry.actor_name,
    timestamp: entry.created_at,
    notes: entry.notes,
  }));
}

/* ───────────────────────── Main Component ───────────────────────── */

export function ExchangeDetailPage() {
  const { t } = useTranslation('exchanges');
  usePageTitle(t('detail.page_title'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Modal states
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [ratings, setRatings] = useState<ExchangeRating[]>([]);
  const [declineReason, setDeclineReason] = useState('');
  const [confirmHours, setConfirmHours] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadExchange = useCallback(async () => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<Exchange>(`/v2/exchanges/${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setExchange(response.data);
        setConfirmHours(response.data.proposed_hours.toString());
      } else {
        setError(tRef.current('detail.not_found'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(tRef.current('detail.not_found'));
      logError('Failed to load exchange', err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadExchange();
  }, [loadExchange]);

  // Load ratings for completed exchanges
  useEffect(() => {
    if (!exchange || exchange.status !== 'completed' || !id) return;

    async function loadRatings() {
      try {
        const response = await api.get<{ ratings: ExchangeRating[]; has_rated: boolean }>(`/v2/exchanges/${id}/ratings`);
        if (response.success && response.data) {
          setRatings(response.data.ratings || []);
          setHasRated(response.data.has_rated || false);
        }
      } catch {
        // Ratings endpoint may not exist yet — fail silently
      }
    }
    loadRatings();
  }, [exchange, id]);

  const isRequester = exchange?.requester_id === user?.id;
  const isProvider = exchange?.provider_id === user?.id;

  // Determine the other party for messaging
  const otherParty = isRequester ? exchange?.provider : exchange?.requester;
  const otherPartyId = isRequester ? exchange?.provider_id : exchange?.requester_id;

  // Exchange is "active" (not completed or cancelled) — show message link
  const isActive = exchange
    ? !['completed', 'cancelled'].includes(exchange.status)
    : false;

  async function handleAccept() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/exchanges/${exchange.id}/accept`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.accepted'));
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.accept_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.accept_failed'));
      logError('Failed to accept exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDecline() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/exchanges/${exchange.id}/decline`, { reason: declineReason });
      if (response.success) {
        toastRef.current.success(tRef.current('toast.declined'));
        setShowDeclineModal(false);
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.decline_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.decline_failed'));
      logError('Failed to decline exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleStart() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/exchanges/${exchange.id}/start`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.started'));
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.start_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.start_failed'));
      logError('Failed to start exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleComplete() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/exchanges/${exchange.id}/complete`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.completed'));
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.complete_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.complete_failed'));
      logError('Failed to complete exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!exchange) return;

    const hours = parseFloat(confirmHours);
    if (isNaN(hours) || hours <= 0) {
      toastRef.current.error(tRef.current('toast.invalid_hours'));
      return;
    }

    if (hours > MAX_EXCHANGE_HOURS) {
      toastRef.current.error(tRef.current('toast.max_hours', { max: MAX_EXCHANGE_HOURS }));
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/exchanges/${exchange.id}/confirm`, { hours });
      if (response.success) {
        toastRef.current.success(tRef.current('toast.hours_confirmed'));
        setShowConfirmModal(false);
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.confirm_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.confirm_failed'));
      logError('Failed to confirm hours', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.delete(`/v2/exchanges/${exchange.id}`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.cancelled'));
        setShowCancelModal(false);
        navigate(tenantPath('/exchanges'));
      } else {
        toastRef.current.error(response.error || tRef.current('toast.cancel_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.cancel_failed'));
      logError('Failed to cancel exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <>
        <PageMeta title={t('detail.loading')} noIndex />
        <LoadingScreen message={t('detail.loading')} />
      </>
    );
  }

  if (error || !exchange) {
    return (
      <>
        <PageMeta title={t('detail.not_found_title')} noIndex />
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12" />}
          title={t('detail.not_found_title')}
          description={error || t('detail.not_found_description')}
          action={
            <Button as={Link} to={tenantPath("/exchanges")} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
              {t('detail.view_exchanges')}
            </Button>
          }
        />
      </>
    );
  }

  const statusConfig = EXCHANGE_STATUS_CONFIG[exchange.status];

  // Determine which actions are available
  const canAccept = isProvider && exchange.status === 'pending_provider';
  const canDecline = isProvider && exchange.status === 'pending_provider';
  const canStart = isProvider && exchange.status === 'accepted';
  const canComplete = isProvider && exchange.status === 'in_progress';
  const canConfirm =
    exchange.status === 'pending_confirmation' &&
    ((isRequester && !exchange.requester_confirmed_at) ||
      (isProvider && !exchange.provider_confirmed_at));
  const canCancel =
    isRequester &&
    ['pending_provider', 'pending_broker', 'accepted'].includes(exchange.status);

  // Build timeline from status_history
  const timeline = exchange.status_history ? buildTimeline(exchange.status_history) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto space-y-6"
    >
      <PageMeta title={t('page_meta.detail.title')} noIndex />
      {/* Visually-hidden h1 for WCAG 2.4.6 — screen readers need a page heading */}
      <h1 className="sr-only">{exchange?.listing?.title || t('detail.page_title')}</h1>
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('breadcrumb.exchanges'), href: '/exchanges' },
        { label: exchange?.listing?.title || t('breadcrumb.exchange') },
      ]} />

      {/* Status Card */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${getStatusIconBgClass(statusConfig.color)}`}>
            <ArrowRightLeft className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <Chip
              color={statusConfig.color}
              variant="flat"
              size="lg"
            >
              {statusConfig.label}
            </Chip>
            <p className="text-sm text-theme-muted mt-1">{statusConfig.description}</p>
          </div>
        </div>
      </GlassCard>

      {/* Exchange Details */}
      <GlassCard className="p-6">
        <h2 className="text-xl font-semibold text-theme-primary mb-4">
          {t('detail.exchange_details')}
        </h2>

        {/* Listing */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-theme-muted mb-2">{t('detail.service')}</h3>
          <Link to={tenantPath(`/listings/${exchange.listing_id}`)} className="hover:underline">
            <p className="text-lg font-semibold text-theme-primary">
              {exchange.listing?.title || t('service_exchange')}
            </p>
          </Link>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div>
            <h3 className="text-sm font-medium text-theme-muted mb-2">{t('detail.requester')}</h3>
            <div className="flex items-center gap-3">
              <Avatar
                src={resolveAvatarUrl(exchange.requester?.avatar)}
                name={exchange.requester?.name || t('unknown')}
                size="sm"
              />
              <div>
                <p className="font-medium text-theme-primary">
                  {exchange.requester?.name || t('unknown')}
                  {isRequester && ` (${t('detail.you')})`}
                </p>
                {exchange.requester?.id && <VerificationBadgeRow userId={exchange.requester.id} size="sm" />}
                {exchange.requester_confirmed_at && (
                  <p className="text-xs text-theme-success flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" aria-hidden="true" />
                    {t('detail.confirmed_hours', { hours: exchange.requester_confirmed_hours })}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-theme-muted mb-2">{t('detail.provider')}</h3>
            <div className="flex items-center gap-3">
              <Avatar
                src={resolveAvatarUrl(exchange.provider?.avatar)}
                name={exchange.provider?.name || t('unknown')}
                size="sm"
              />
              <div>
                <p className="font-medium text-theme-primary">
                  {exchange.provider?.name || t('unknown')}
                  {isProvider && ` (${t('detail.you')})`}
                </p>
                {exchange.provider?.id && <VerificationBadgeRow userId={exchange.provider.id} size="sm" />}
                {exchange.provider_confirmed_at && (
                  <p className="text-xs text-theme-success flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" aria-hidden="true" />
                    {t('detail.confirmed_hours', { hours: exchange.provider_confirmed_hours })}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Message Other Party */}
        {isActive && otherParty && otherPartyId && (
          <div className="mb-6">
            <Button as={Link} to={tenantPath(`/messages/new/${otherPartyId}`)}
              variant="flat"
              className="bg-accent/10 text-accent hover:bg-accent/20"
              startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
            >
              {t('detail.message_party', { name: otherParty.name || t('detail.other_party') })}
            </Button>
          </div>
        )}

        {/* Hours */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="bg-theme-elevated rounded-lg p-4">
            <p className="text-sm text-theme-muted">{t('detail.proposed_hours')}</p>
            <p className="text-2xl font-bold text-theme-primary">{exchange.proposed_hours}</p>
          </div>
          {exchange.final_hours && (
            <div className="bg-emerald-500/10 rounded-lg p-4">
              <p className="text-sm text-theme-success">{t('detail.final_hours')}</p>
              <p className="text-2xl font-bold text-theme-success">{exchange.final_hours}</p>
            </div>
          )}
          <div className="bg-theme-elevated rounded-lg p-4">
            <p className="text-sm text-theme-muted">{t('detail.created')}</p>
            <p className="text-sm font-medium text-theme-primary">
              <time dateTime={exchange.created_at}>
                {new Date(exchange.created_at).toLocaleDateString(getFormattingLocale())}
              </time>
            </p>
          </div>
        </div>

        {/* Message */}
        {exchange.message && (
          <div className="bg-theme-elevated rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-theme-muted mb-2 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" aria-hidden="true" />
              {t('detail.message_from_requester')}
            </h3>
            <p className="text-theme-primary">{exchange.message}</p>
          </div>
        )}

        {/* Prep Time */}
        {exchange.prep_time != null && exchange.prep_time > 0 && (
          <div className="bg-theme-elevated rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-theme-muted mb-1">{t('detail.prep_time')}</h3>
            <p className="text-lg font-semibold text-theme-primary">{t('detail.prep_time_value', { count: exchange.prep_time })}</p>
          </div>
        )}

        {/* Broker Notes */}
        {exchange.broker_notes && (
          <div className="bg-amber-500/10 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-medium text-theme-warning mb-2">{t('detail.broker_notes')}</h3>
            <p className="text-theme-primary">{exchange.broker_notes}</p>
          </div>
        )}

        {/* Ratings Display (W10) */}
        {exchange.status === 'completed' && ratings.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-theme-muted mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" aria-hidden="true" />
              {t('detail.ratings')}
            </h3>
            <div className="space-y-3">
              {ratings.map((r) => (
                <div key={r.id} className="bg-theme-elevated rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-theme-primary">{r.rater.name}</span>
                    <span className="flex gap-0.5" aria-label={t('detail.rating_value', { rating: r.rating })}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`w-4 h-4 ${s <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-theme-muted'}`}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                  </div>
                  {r.comment && <p className="text-sm text-theme-muted">{r.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rate Exchange Button (W10) */}
        {exchange.status === 'completed' && !hasRated && (
          <div className="mb-4">
            <Button
              color="warning"
              variant="flat"
              className="w-full"
              startContent={<Star className="w-4 h-4" />}
              onPress={() => setShowRatingModal(true)}
            >
              {t('detail.rate_exchange')}
            </Button>
          </div>
        )}

        {/* Actions */}
        {(canAccept || canDecline || canStart || canComplete || canConfirm || canCancel) && (
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-theme-default">
            {canAccept && (
              <Button
                color="success"
                startContent={<Check className="w-4 h-4" aria-hidden="true" />}
                onPress={handleAccept}
                isLoading={isSubmitting}
              >
                {t('detail.accept_request')}
              </Button>
            )}
            {canDecline && (
              <Button
                color="danger"
                variant="flat"
                startContent={<X className="w-4 h-4" aria-hidden="true" />}
                onPress={() => setShowDeclineModal(true)}
              >
                {t('detail.decline')}
              </Button>
            )}
            {canStart && (
              <Button
                color="primary"
                startContent={<Play className="w-4 h-4" aria-hidden="true" />}
                onPress={handleStart}
                isLoading={isSubmitting}
              >
                {t('detail.start_exchange')}
              </Button>
            )}
            {canComplete && (
              <Button
                color="success"
                startContent={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
                onPress={handleComplete}
                isLoading={isSubmitting}
              >
                {t('detail.mark_complete')}
              </Button>
            )}
            {canConfirm && (
              <Button
                color="warning"
                startContent={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
                onPress={() => setShowConfirmModal(true)}
              >
                {t('detail.confirm_hours')}
              </Button>
            )}
            {canCancel && (
              <Button
                color="danger"
                variant="flat"
                startContent={<XCircle className="w-4 h-4" aria-hidden="true" />}
                onPress={() => setShowCancelModal(true)}
              >
                {t('detail.cancel_exchange')}
              </Button>
            )}
          </div>
        )}
      </GlassCard>

      {/* Exchange Timeline */}
      {timeline.length > 0 && (
        <GlassCard className="p-6">
          <h2 className="text-xl font-semibold text-theme-primary mb-6 flex items-center gap-3">
            <Clock className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('detail.timeline_title')}
          </h2>

          <div className="relative">
            {/* Vertical connector line */}
            <div
              className="absolute left-[17px] top-3 bottom-3 w-0.5 bg-theme-elevated"
              aria-hidden="true"
            />

            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: {
                  opacity: 1,
                  transition: { staggerChildren: 0.1 },
                },
              }}
              className="space-y-0"
            >
              {timeline.map((entry) => (
                <motion.div
                  key={`${entry.timestamp}-${entry.label}`}
                  variants={{
                    hidden: { opacity: 0, x: -20 },
                    visible: { opacity: 1, x: 0 },
                  }}
                  className="relative flex items-start gap-4 pb-6 last:pb-0"
                >
                  {/* Icon circle */}
                  <div
                    className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center border-2 flex-shrink-0 ${entry.colorClass}`}
                    aria-label={t(entry.label)}
                    role="img"
                  >
                    {entry.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-theme-primary">
                        {t(entry.label)}
                      </span>
                      {entry.actor && (
                        <Chip size="sm" variant="flat" className="text-xs bg-theme-elevated text-theme-muted">
                          {entry.actor}
                        </Chip>
                      )}
                    </div>
                    <p className="text-xs text-theme-subtle mt-0.5">
                      <time dateTime={entry.timestamp}>
                        {formatRelativeTime(entry.timestamp)}
                        {' \u00b7 '}
                        {new Date(entry.timestamp).toLocaleString(getFormattingLocale())}
                      </time>
                    </p>
                    {entry.notes && (
                      <p className="text-sm text-theme-muted mt-1 bg-theme-elevated rounded-lg px-3 py-2">
                        {entry.notes}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </GlassCard>
      )}

      {/* Decline Modal */}
      <Modal
        isOpen={showDeclineModal}
        onClose={() => setShowDeclineModal(false)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('modal.decline_title')}</ModalHeader>
          <ModalBody>
            <Textarea
              label={t('modal.decline_reason_label')}
              placeholder={t('modal.decline_reason_placeholder')}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setShowDeclineModal(false)}
              className="bg-theme-elevated text-theme-primary"
            >
              {t('modal.cancel')}
            </Button>
            <Button color="danger" onPress={handleDecline} isLoading={isSubmitting}>
              {t('modal.decline_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Confirm Hours Modal */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('modal.confirm_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted mb-4">
              {t('modal.confirm_description')}
            </p>
            <Input
              type="number"
              label={t('modal.hours_label')}
              placeholder={t('modal.hours_placeholder')}
              value={confirmHours}
              onChange={(e) => setConfirmHours(e.target.value)}
              min="0.5"
              max={MAX_EXCHANGE_HOURS}
              step="0.5"
              endContent={<span className="text-theme-muted">{t('modal.hours_unit')}</span>}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
            <p className="text-xs text-theme-muted mt-2">
              {t('modal.originally_proposed', { hours: exchange?.proposed_hours, max: MAX_EXCHANGE_HOURS })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setShowConfirmModal(false)}
              className="bg-theme-elevated text-theme-primary"
            >
              {t('modal.cancel')}
            </Button>
            <Button color="success" onPress={handleConfirm} isLoading={isSubmitting}>
              {t('detail.confirm_hours')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Cancel Confirmation Modal */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('modal.cancel_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('modal.cancel_description')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setShowCancelModal(false)}
              className="bg-theme-elevated text-theme-primary"
            >
              {t('modal.keep_exchange')}
            </Button>
            <Button color="danger" onPress={handleCancel} isLoading={isSubmitting}>
              {t('detail.cancel_exchange')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Rating Modal (W10) */}
      <RatingModal
        isOpen={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        exchangeId={exchange.id}
        otherPartyName={otherParty?.name}
        onRatingComplete={() => {
          setHasRated(true);
          loadExchange();
        }}
      />
    </motion.div>
  );
}

export default ExchangeDetailPage;
