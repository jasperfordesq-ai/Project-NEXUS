// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group Exchange Detail Page - View and manage a single group exchange
 *
 * Features:
 * - Breadcrumbs: Group Exchanges > Exchange Title
 * - Status badge and description
 * - Organizer info with avatar
 * - Split type display
 * - Participants table with name, role, hours, weight, confirmed status
 * - Action buttons based on status (organizer vs participant)
 * - Hour split preview table
 * - Completed: transaction receipt
 * - Cancelled: notice
 *
 * Route: /group-exchanges/:id
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Users from 'lucide-react/icons/users';
import Scale from 'lucide-react/icons/scale';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Play from 'lucide-react/icons/play';
import UserPlus from 'lucide-react/icons/user-plus';
import X from 'lucide-react/icons/x';
import XCircle from 'lucide-react/icons/circle-x';
import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type GroupExchangeStatus =
  | 'draft'
  | 'pending_participants'
  | 'pending_broker'
  | 'active'
  | 'pending_confirmation'
  | 'completed'
  | 'cancelled'
  | 'disputed';

interface GroupExchangeParticipant {
  id: number;
  group_exchange_id: number;
  user_id: number;
  role: 'provider' | 'receiver';
  hours: number;
  weight: number;
  confirmed: boolean;
  confirmed_at: string | null;
  notes: string | null;
  user_name: string;
  user_avatar: string | null;
  user_email: string | null;
  created_at: string;
}

interface GroupExchangeDetail {
  id: number;
  tenant_id: number;
  title: string;
  description: string | null;
  organizer_id: number;
  organizer_name: string;
  organizer_avatar: string | null;
  listing_id: number | null;
  status: GroupExchangeStatus;
  split_type: 'equal' | 'custom' | 'weighted';
  total_hours: number;
  broker_id: number | null;
  broker_notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  participants: GroupExchangeParticipant[];
  // Flat per-participant split: how much each provider is credited / each receiver
  // is debited when the exchange completes. This is exactly what the wallet ledger
  // does, so it is the honest thing to preview.
  calculated_split: { user_id: number; role: 'provider' | 'receiver'; hours: number }[];
}

interface SearchResult {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  avatar?: string;
  email?: string;
}

interface StatusConfig {
  color: 'default' | 'warning' | 'secondary' | 'primary' | 'success' | 'danger';
  bgClass: string;
}

const STATUS_CONFIGS: Record<GroupExchangeStatus, StatusConfig> = {
  draft: { color: 'default', bgClass: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' },
  pending_participants: { color: 'warning', bgClass: 'bg-amber-500/20 text-amber-700 dark:text-amber-400' },
  pending_broker: { color: 'secondary', bgClass: 'bg-accent/20 text-accent dark:text-accent' },
  active: { color: 'primary', bgClass: 'bg-accent/20 text-accent dark:text-accent' },
  pending_confirmation: { color: 'warning', bgClass: 'bg-amber-500/20 text-amber-700 dark:text-amber-400' },
  completed: { color: 'success', bgClass: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' },
  cancelled: { color: 'danger', bgClass: 'bg-red-500/20 text-red-600 dark:text-red-400' },
  disputed: { color: 'danger', bgClass: 'bg-red-500/20 text-red-600 dark:text-red-400' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupExchangeDetailPage() {
  const { t } = useTranslation('group_exchanges');
  usePageTitle(t('detail.page_title'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [exchange, setExchange] = useState<GroupExchangeDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Cancel modal
  const [showCancelModal, setShowCancelModal] = useState(false);

  // Add participant modal
  const [showAddParticipantModal, setShowAddParticipantModal] = useState(false);
  const [addRole, setAddRole] = useState<'provider' | 'receiver'>('provider');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────────────────────────────────

  const loadExchange = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<GroupExchangeDetail>(`/v2/group-exchanges/${id}`);

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setExchange(response.data);
      } else {
        setError(tRef.current('detail.not_found'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(tRef.current('detail.not_found'));
      logError('Failed to load group exchange', err);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadExchange();
  }, [loadExchange]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived state
  // ─────────────────────────────────────────────────────────────────────────

  const isOrganizer = exchange?.organizer_id === user?.id;
  const isParticipant = exchange?.participants?.some((p) => p.user_id === user?.id) ?? false;
  const currentUserParticipant = exchange?.participants?.find((p) => p.user_id === user?.id);
  const statusConfig = exchange ? STATUS_CONFIGS[exchange.status] || STATUS_CONFIGS.draft : STATUS_CONFIGS.draft;

  const providers = exchange?.participants?.filter((p) => p.role === 'provider') ?? [];
  const receivers = exchange?.participants?.filter((p) => p.role === 'receiver') ?? [];
  const allConfirmed = exchange?.participants?.every((p) => p.confirmed) ?? false;

  // Status-based action flags
  const canAddParticipants = isOrganizer && ['draft', 'pending_participants'].includes(exchange?.status ?? '');
  const canStartExchange = isOrganizer && ['draft', 'pending_participants'].includes(exchange?.status ?? '') && providers.length >= 1 && receivers.length >= 1;
  const canConfirm = isParticipant && exchange?.status === 'pending_confirmation' && currentUserParticipant && !currentUserParticipant.confirmed;
  const canComplete = isOrganizer && exchange?.status === 'pending_confirmation' && allConfirmed;
  const canCancel = isOrganizer && !['completed', 'cancelled'].includes(exchange?.status ?? '');

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  async function handleStart() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      // Dedicated action endpoint. Status changes never went through PUT (the
      // update allow-list excludes `status` by design), so the old "Start" was a
      // silent no-op that left the exchange stuck in draft forever.
      const response = await api.post(`/v2/group-exchanges/${exchange.id}/start`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.exchange_started'));
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.start_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.start_failed'));
      logError('Failed to start group exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/group-exchanges/${exchange.id}/confirm`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.hours_confirmed'));
        loadExchange();
      } else {
        // A failed confirm resolves to { success: false } without throwing, so the
        // unconditional success toast + reload reported a fake success.
        toastRef.current.error(response.error || tRef.current('toast.confirm_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.confirm_failed'));
      logError('Failed to confirm participation', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleComplete() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post<{ message: string; transaction_ids: number[] }>(
        `/v2/group-exchanges/${exchange.id}/complete`
      );

      if (response.success) {
        toastRef.current.success(tRef.current('toast.exchange_completed'), tRef.current('toast.exchange_completed_desc'));
        loadExchange();
      } else {
        toastRef.current.error(tRef.current('toast.complete_failed'), response.error || tRef.current('toast.error_occurred'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.complete_failed'));
      logError('Failed to complete group exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.delete(`/v2/group-exchanges/${exchange.id}`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.exchange_cancelled'));
        setShowCancelModal(false);
        navigate(tenantPath('/group-exchanges'));
      } else {
        // A failed cancel resolves to { success: false } without throwing — the page
        // used to show "cancelled" and navigate away, so the exchange looked gone
        // when it wasn't.
        toastRef.current.error(response.error || tRef.current('toast.cancel_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.cancel_failed'));
      logError('Failed to cancel group exchange', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Add participant search
  // ─────────────────────────────────────────────────────────────────────────

  async function handleSearchMembers(query: string) {
    setSearchQuery(query);

    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);
      // Member directory filters on `q`, not `search` — see CreateGroupExchangePage.
      const response = await api.get<{ data: SearchResult[] }>(`/v2/users?q=${encodeURIComponent(query.trim())}&limit=10`);

      if (response.success && response.data) {
        const results = Array.isArray(response.data) ? response.data : [];
        // Filter out existing participants
        const existingIds = new Set(exchange?.participants?.map((p) => p.user_id) ?? []);
        setSearchResults(results.filter((r: SearchResult) => !existingIds.has(r.id)));
      }
    } catch (err) {
      logError('Failed to search users', err);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleAddParticipant(userId: number) {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.post(`/v2/group-exchanges/${exchange.id}/participants`, {
        user_id: userId,
        role: addRole,
      });
      if (response.success) {
        toastRef.current.success(tRef.current('toast.participant_added'));
        setSearchResults((prev) => prev.filter((r) => r.id !== userId));
        loadExchange();
      } else {
        // Don't report a fake success — a failed add resolves to { success: false }
        // without throwing, so the unconditional success toast was wrong.
        toastRef.current.error(response.error || tRef.current('toast.add_participant_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.add_participant_failed'));
      logError('Failed to add participant', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemoveParticipant(userId: number) {
    if (!exchange) return;

    try {
      setIsSubmitting(true);
      const response = await api.delete(`/v2/group-exchanges/${exchange.id}/participants/${userId}`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.participant_removed'));
        loadExchange();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.remove_participant_failed'));
      }
    } catch (err) {
      toastRef.current.error(tRef.current('toast.remove_participant_failed'));
      logError('Failed to remove participant', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build split rows
  // ─────────────────────────────────────────────────────────────────────────

  function buildSplitRows(): { key: string; name: string; role: 'provider' | 'receiver'; hours: number }[] {
    if (!Array.isArray(exchange?.calculated_split)) return [];

    const participantMap = new Map(exchange.participants.map((p) => [p.user_id, p.user_name]));

    return exchange.calculated_split
      .filter((entry) => entry.hours > 0)
      .map((entry) => ({
        key: `${entry.user_id}-${entry.role}`,
        name: participantMap.get(entry.user_id) || `User #${entry.user_id}`,
        role: entry.role,
        hours: entry.hours,
      }));
  }

  const splitRows = exchange ? buildSplitRows() : [];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

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
        <PageMeta title={t('detail.not_found')} noIndex />
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12" />}
          title={t('detail.not_found')}
          description={error || t('detail.not_found_desc')}
          action={
            <Button as={Link} to={tenantPath('/group-exchanges')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
              {t('detail.view_exchanges')}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto space-y-6"
    >
      <PageMeta title={t('page_meta.detail.title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: '/group-exchanges' },
        { label: exchange.title },
      ]} />

      {/* Status Card */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${statusConfig.bgClass}`}>
            <ArrowLeftRight className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-theme-primary">{exchange.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Chip
                color={statusConfig.color}
                variant="flat"
                size="lg"
              >
                {t('status.' + exchange.status)}
              </Chip>
              <Chip size="sm" variant="flat" className="bg-theme-elevated text-theme-muted capitalize">
                {t('split_type.' + exchange.split_type)}
              </Chip>
            </div>
          </div>
        </div>

        {exchange.description && (
          <p className="text-theme-muted mb-4">{exchange.description}</p>
        )}

        {/* Organizer */}
        <div className="flex items-center gap-3 mb-4">
          <Avatar
            src={resolveAvatarUrl(exchange.organizer_avatar)}
            name={exchange.organizer_name}
            size="sm"
          />
          <div>
            <p className="text-sm text-theme-muted">{t('detail.organized_by')}</p>
            <p className="font-medium text-theme-primary">
              {exchange.organizer_name}
              {isOrganizer && ` (${t('detail.you')})`}
            </p>
          </div>
        </div>

        {/* Hours */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-theme-elevated rounded-lg p-4">
            <p className="text-sm text-theme-muted">{t('detail.total_hours')}</p>
            <p className="text-2xl font-bold text-theme-primary">{Number(exchange.total_hours)}</p>
          </div>
          <div className="bg-theme-elevated rounded-lg p-4">
            <p className="text-sm text-theme-muted">{t('detail.providers')}</p>
            <p className="text-2xl font-bold text-theme-success">{providers.length}</p>
          </div>
          <div className="bg-theme-elevated rounded-lg p-4">
            <p className="text-sm text-theme-muted">{t('detail.receivers')}</p>
            <p className="text-2xl font-bold text-theme-warning">{receivers.length}</p>
          </div>
          <div className="bg-theme-elevated rounded-lg p-4">
            <p className="text-sm text-theme-muted">{t('detail.created')}</p>
            <p className="text-sm font-medium text-theme-primary">
              <time dateTime={exchange.created_at}>
                {new Date(exchange.created_at).toLocaleDateString(getFormattingLocale())}
              </time>
            </p>
          </div>
        </div>

        {/* Broker Notes */}
        {exchange.broker_notes && (
          <div className="bg-amber-500/10 rounded-lg p-4 mt-4">
            <h3 className="text-sm font-medium text-theme-warning mb-2">{t('detail.broker_notes')}</h3>
            <p className="text-theme-primary">{exchange.broker_notes}</p>
          </div>
        )}

        {/* Completed notice */}
        {exchange.status === 'completed' && exchange.completed_at && (
          <div className="bg-emerald-500/10 rounded-lg p-4 mt-4">
            <h3 className="text-sm font-medium text-theme-success mb-1 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" aria-hidden="true" />
              {t('detail.exchange_completed')}
            </h3>
            <p className="text-theme-muted text-sm">
              {t('detail.completed_on', { date: new Date(exchange.completed_at).toLocaleDateString(getFormattingLocale()) })}
            </p>
          </div>
        )}

        {/* Cancelled notice */}
        {exchange.status === 'cancelled' && (
          <div className="bg-red-500/10 rounded-lg p-4 mt-4">
            <h3 className="text-sm font-medium text-theme-danger mb-1 flex items-center gap-2">
              <XCircle className="w-4 h-4" aria-hidden="true" />
              {t('detail.exchange_cancelled')}
            </h3>
            <p className="text-theme-muted text-sm">
              {t('detail.cancelled_notice')}
            </p>
          </div>
        )}

        {/* Actions */}
        {(canAddParticipants || canStartExchange || canConfirm || canComplete || canCancel) && (
          <div className="flex flex-wrap gap-3 pt-4 mt-4 border-t border-theme-default">
            {canAddParticipants && (
              <Button
                color="primary"
                variant="flat"
                startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
                onPress={() => {
                  setShowAddParticipantModal(true);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
              >
                {t('detail.add_participants')}
              </Button>
            )}
            {canStartExchange && (
              <Button
                color="primary"
                startContent={<Play className="w-4 h-4" aria-hidden="true" />}
                onPress={handleStart}
                isLoading={isSubmitting}
              >
                {t('detail.start_exchange')}
              </Button>
            )}
            {canConfirm && (
              <Button
                color="warning"
                startContent={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
                onPress={handleConfirm}
                isLoading={isSubmitting}
              >
                {t('detail.confirm_my_hours')}
              </Button>
            )}
            {canComplete && (
              <Button
                color="success"
                startContent={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
                onPress={handleComplete}
                isLoading={isSubmitting}
              >
                {t('detail.complete_exchange')}
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

      {/* Participants */}
      <GlassCard className="p-6">
        <h2 className="text-xl font-semibold text-theme-primary mb-6 flex items-center gap-3">
          <Users className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('detail.participants_heading', { count: exchange.participants.length })}
        </h2>

        <Table
          aria-label={t('detail.aria_exchange_participants')}
          shadow="sm"
          isStriped
        >
          <TableHeader>
            <TableColumn>{t('detail.col_name')}</TableColumn>
            <TableColumn>{t('detail.col_role')}</TableColumn>
            {exchange.split_type === 'custom' ? (
              <TableColumn className="text-right">{t('detail.col_hours')}</TableColumn>
            ) : exchange.split_type === 'weighted' ? (
              <TableColumn className="text-right">{t('detail.col_weight')}</TableColumn>
            ) : (
              <TableColumn>{' '}</TableColumn>
            )}
            <TableColumn className="text-center">{t('detail.col_confirmed')}</TableColumn>
            {canAddParticipants ? (
              <TableColumn className="text-right">{' '}</TableColumn>
            ) : (
              <TableColumn>{' '}</TableColumn>
            )}
          </TableHeader>
          <TableBody emptyContent={<div className="text-center py-6"><Users className="w-10 h-10 text-theme-subtle mx-auto mb-2" aria-hidden="true" /><p className="text-theme-muted text-sm">{t('detail.no_participants')}</p></div>}>
            {exchange.participants.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar
                      src={resolveAvatarUrl(p.user_avatar)}
                      name={p.user_name}
                      size="sm"
                    />
                    <span className="text-theme-primary">
                      {p.user_name}
                      {p.user_id === user?.id && (
                        <span className="text-xs text-theme-subtle ml-1">({t('detail.you')})</span>
                      )}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Chip
                    size="sm"
                    variant="flat"
                    color={p.role === 'provider' ? 'success' : 'warning'}
                  >
                    {p.role === 'provider' ? t('role_provider') : t('role_receiver')}
                  </Chip>
                </TableCell>
                <TableCell className={exchange.split_type === 'custom' || exchange.split_type === 'weighted' ? 'text-right text-theme-primary' : ''}>
                  {exchange.split_type === 'custom'
                    ? `${Number(p.hours)}h`
                    : exchange.split_type === 'weighted'
                    ? `${Number(p.weight)}x`
                    : null}
                </TableCell>
                <TableCell className="text-center">
                  {p.confirmed ? (
                    <span className="flex items-center justify-center gap-1 text-theme-success text-xs">
                      <CheckCircle className="w-4 h-4" aria-hidden="true" />
                      {t('detail.confirmed')}
                    </span>
                  ) : (
                    <span className="text-theme-subtle text-xs">{t('detail.pending')}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canAddParticipants && (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="bg-red-500/20 text-red-400"
                      onPress={() => handleRemoveParticipant(p.user_id)}
                      aria-label={t('detail.remove_participant', { name: p.user_name })}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>

      {/* Hour Split Preview */}
      {splitRows.length > 0 && (
        <GlassCard className="p-6">
          <h2 className="text-xl font-semibold text-theme-primary mb-6 flex items-center gap-3">
            <Scale className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('detail.hour_split')}
          </h2>

          <Table aria-label={t('detail.aria_hour_split')} shadow="sm" isStriped>
            <TableHeader>
              <TableColumn>{t('detail.col_name')}</TableColumn>
              <TableColumn>{t('detail.col_role')}</TableColumn>
              <TableColumn className="text-right">{t('detail.col_hours')}</TableColumn>
            </TableHeader>
            <TableBody>
              {splitRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="text-theme-primary">{row.name}</TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={row.role === 'provider' ? 'success' : 'warning'}>
                      {row.role === 'provider' ? t('role_provider') : t('role_receiver')}
                    </Chip>
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${row.role === 'provider' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}
                  >
                    {row.role === 'provider' ? '+' : '−'}{t('detail.hours_amount', { count: row.hours })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GlassCard>
      )}

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
          <ModalHeader className="text-theme-primary">{t('detail.cancel_modal_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('detail.cancel_modal_body')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setShowCancelModal(false)}
              className="bg-theme-elevated text-theme-primary"
            >
              {t('detail.keep_exchange')}
            </Button>
            <Button color="danger" onPress={handleCancel} isLoading={isSubmitting}>
              {t('detail.cancel_exchange')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add Participant Modal */}
      <Modal
        isOpen={showAddParticipantModal}
        onClose={() => setShowAddParticipantModal(false)}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('detail.add_participant_title')}</ModalHeader>
          <ModalBody>
            {/* Role selection */}
            <div className="flex gap-2 mb-4">
              <Button
                size="sm"
                variant={addRole === 'provider' ? 'solid' : 'flat'}
                color={addRole === 'provider' ? 'success' : 'default'}
                onPress={() => setAddRole('provider')}
                aria-pressed={addRole === 'provider'}
                className={addRole !== 'provider' ? 'bg-theme-elevated text-theme-muted' : ''}
              >
                {t('detail.role_provider')}
              </Button>
              <Button
                size="sm"
                variant={addRole === 'receiver' ? 'solid' : 'flat'}
                color={addRole === 'receiver' ? 'warning' : 'default'}
                onPress={() => setAddRole('receiver')}
                aria-pressed={addRole === 'receiver'}
                className={addRole !== 'receiver' ? 'bg-theme-elevated text-theme-muted' : ''}
              >
                {t('detail.role_receiver')}
              </Button>
            </div>

            <Input
              placeholder={t('detail.search_members_placeholder')}
              value={searchQuery}
              onChange={(e) => handleSearchMembers(e.target.value)}
              startContent={<Search className="w-4 h-4 text-theme-muted" aria-hidden="true" />}
              aria-label={t('detail.search_members_placeholder')}
              endContent={isSearching ? <span role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })}><Spinner size="sm" /></span> : null}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />

            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                {searchResults.map((result) => {
                  const displayName = result.name || resolveUserDisplayName(result) || 'Unknown';
                  return (
                    <div
                      key={result.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-theme-elevated"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={resolveAvatarUrl(result.avatar_url || result.avatar)}
                          name={displayName}
                          size="sm"
                        />
                        <div>
                          <p className="font-medium text-theme-primary text-sm">{displayName}</p>
                          {result.email && (
                            <p className="text-xs text-theme-subtle">{result.email}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="flat"
                        color={addRole === 'provider' ? 'success' : 'warning'}
                        onPress={() => handleAddParticipant(result.id)}
                        isLoading={isSubmitting}
                        startContent={<Plus className="w-3 h-3" aria-hidden="true" />}
                      >
                        {t('detail.add_as_role', { role: t('detail.role_' + addRole) })}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {searchQuery.trim().length >= 2 && searchResults.length === 0 && !isSearching && (
              <div className="text-center py-4 text-theme-muted text-sm">
                {t('detail.no_members_found')}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              onPress={() => setShowAddParticipantModal(false)}
              className="bg-theme-elevated text-theme-primary"
            >
              {t('detail.done')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </motion.div>
  );
}

export default GroupExchangeDetailPage;
