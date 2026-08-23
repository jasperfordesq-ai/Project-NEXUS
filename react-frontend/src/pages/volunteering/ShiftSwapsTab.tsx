// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ShiftSwapsTab - View and manage shift swap requests (V2)
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';

import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import Calendar from 'lucide-react/icons/calendar';
import Building2 from 'lucide-react/icons/building-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import Inbox from 'lucide-react/icons/inbox';
import Ban from 'lucide-react/icons/ban';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

interface SwapShift {
  id: number;
  start_time: string;
  end_time: string;
  opportunity_title: string;
  organization_name: string;
}

interface ShiftSwap {
  id: number;
  status: 'pending' | 'accepted' | 'rejected' | 'admin_pending' | 'admin_approved' | 'admin_rejected' | 'cancelled' | 'expired';
  direction: 'sent' | 'received';
  requester: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
  recipient: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
  original_shift: SwapShift;
  proposed_shift: SwapShift;
  message: string | null;
  created_at: string;
}

/* ───────────────────────── Component ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const statusColor = (status: string) => {
  switch (status) {
    case 'accepted':
    case 'admin_approved':
      return 'success';
    case 'rejected':
    case 'admin_rejected':
    case 'cancelled':
      return 'danger';
    case 'expired':
      return 'default';
    case 'admin_pending':
    default:
      return 'warning';
  }
};

const formatShiftTime = (shift: SwapShift) => {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  return `${start.toLocaleDateString(getFormattingLocale())} ${start.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * The swap payload is REQUESTER-relative: `original_shift` is always the requester's own
 * shift and `proposed_shift` is always the one they are asking for. So which of the two
 * belongs to the person reading the card depends on the direction, and reading
 * `original_shift` as "yours" was backwards on every received request — the only kind that
 * carries Accept and Reject. Found on the mobile app on 2026-08-23; identical fault here.
 */
const ownShiftOf = (swap: ShiftSwap): SwapShift =>
  swap.direction === 'received' ? swap.proposed_shift : swap.original_shift;

const otherShiftOf = (swap: ShiftSwap): SwapShift =>
  swap.direction === 'received' ? swap.original_shift : swap.proposed_shift;

export function ShiftSwapsTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [swaps, setSwaps] = useState<ShiftSwap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [view, setView] = useState<'all' | 'sent' | 'received'>('all');

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{ swaps?: ShiftSwap[] }>(
        '/v2/volunteering/swaps'
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        // Backend returns {swaps: [...]} wrapper
        const raw = response.data as Record<string, unknown>;
        const items = Array.isArray(raw.swaps) ? raw.swaps as ShiftSwap[]
          : Array.isArray(response.data) ? response.data as ShiftSwap[]
          : [];
        setSwaps(items);
      } else {
        setError(tRef.current('swaps.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load shift swaps', err);
      setError(tRef.current('swaps.load_error'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const handleAccept = async (swapId: number) => {
    try {
      setActioningId(swapId);
      const response = await api.put<{ status?: string }>(`/v2/volunteering/swaps/${swapId}`, { action: 'accept' });
      if (response.success) {
        // The backend reports the real outcome: swaps can land in
        // admin_pending (tenant requires admin approval) instead of accepted.
        const newStatus = response.data?.status === 'admin_pending' ? 'admin_pending' as const : 'accepted' as const;
        setSwaps((prev) =>
          prev.map((s) => (s.id === swapId ? { ...s, status: newStatus } : s))
        );
        toastRef.current.success(
          tRef.current(newStatus === 'admin_pending' ? 'swaps.accept_pending_admin' : 'swaps.accept_success')
        );
      } else {
        toastRef.current.error(tRef.current('swaps.accept_failed'));
      }
    } catch (err) {
      logError('Failed to accept shift swap', err);
      toastRef.current.error(tRef.current('swaps.accept_failed'));
    } finally {
      setActioningId(null);
    }
  };

  const handleCancel = async (swapId: number) => {
    try {
      setActioningId(swapId);
      const response = await api.delete(`/v2/volunteering/swaps/${swapId}`);
      if (response.success) {
        setSwaps((prev) => prev.filter((s) => s.id !== swapId));
        toastRef.current.success(tRef.current('swaps.cancel_success'));
      } else {
        toastRef.current.error(tRef.current('swaps.cancel_failed'));
      }
    } catch (err) {
      logError('Failed to cancel shift swap', err);
      toastRef.current.error(tRef.current('swaps.cancel_failed'));
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;

    try {
      setActioningId(rejectTarget);
      const response = await api.put(`/v2/volunteering/swaps/${rejectTarget}`, { action: 'reject' });
      if (response.success) {
        setSwaps((prev) =>
          prev.map((s) => (s.id === rejectTarget ? { ...s, status: 'rejected' as const } : s))
        );
        toastRef.current.success(tRef.current('swaps.reject_success'));
      } else {
        toastRef.current.error(tRef.current('swaps.reject_failed'));
      }
    } catch (err) {
      logError('Failed to reject shift swap', err);
      toastRef.current.error(tRef.current('swaps.reject_failed'));
    } finally {
      setActioningId(null);
      setRejectTarget(null);
    }
  };

  const filteredSwaps = swaps.filter((s) => {
    if (view === 'sent') return s.direction === 'sent';
    if (view === 'received') return s.direction === 'received';
    return true;
  });

  const sentCount = swaps.filter((s) => s.direction === 'sent').length;
  const receivedCount = swaps.filter((s) => s.direction === 'received').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('swaps.heading')}</h2>
        </div>
        <Button
          size="sm"
          variant="tertiary"
          startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          onPress={load}
          isDisabled={isLoading}
          className="bg-theme-elevated text-theme-muted sm:shrink-0"
        >
          {t('swaps.refresh')}
        </Button>
      </div>

      {/* View Filter */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant={view === 'all' ? 'primary' : 'tertiary'}
          className={view === 'all' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white' : 'bg-theme-elevated text-theme-muted'}
          onPress={() => setView('all')}
        >
          {t('swaps.all')} ({swaps.length})
        </Button>
        <Button
          size="sm"
          variant={view === 'sent' ? 'primary' : 'tertiary'}
          className={view === 'sent' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white' : 'bg-theme-elevated text-theme-muted'}
          onPress={() => setView('sent')}
          startContent={<Send className="w-3 h-3" aria-hidden="true" />}
        >
          {t('swaps.sent')} ({sentCount})
        </Button>
        <Button
          size="sm"
          variant={view === 'received' ? 'primary' : 'tertiary'}
          className={view === 'received' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white' : 'bg-theme-elevated text-theme-muted'}
          onPress={() => setView('received')}
          startContent={<Inbox className="w-3 h-3" aria-hidden="true" />}
        >
          {t('swaps.received')} ({receivedCount})
        </Button>
      </div>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('swaps.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!error && !isLoading && filteredSwaps.length === 0 && (
        <EmptyState
          icon={<ArrowLeftRight className="w-12 h-12" aria-hidden="true" />}
          title={t('swaps.no_swaps_title')}
          description={
            view === 'sent'
              ? t('swaps.no_sent')
              : view === 'received'
                ? t('swaps.no_received')
                : t('swaps.no_swaps_desc')
          }
        />
      )}

      {/* Swap List */}
      {!error && !isLoading && filteredSwaps.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {filteredSwaps.map((swap) => (
            <motion.div key={swap.id} variants={itemVariants}>
              <GlassCard className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    {/* Header with status */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={swap.direction === 'sent' ? 'accent' : 'default'}
                        startContent={swap.direction === 'sent'
                          ? <Send className="w-3 h-3" />
                          : <Inbox className="w-3 h-3" />
                        }
                      >
                        {swap.direction === 'sent' ? t('swaps.sent') : t('swaps.received')}
                      </Chip>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={statusColor(swap.status)}
                      >
                        {t(`swaps.status_${swap.status}`)}
                      </Chip>
                      {swap.direction === 'sent' && (
                        <span className="text-xs text-theme-subtle">
                          {t('swaps.to')} {swap.recipient.name}
                        </span>
                      )}
                      {swap.direction === 'received' && (
                        <span className="text-xs text-theme-subtle">
                          {t('swaps.from')} {swap.requester.name}
                        </span>
                      )}
                    </div>

                    {/*
                      Shift details: the viewer's own shift, then the other person's.

                      The payload is REQUESTER-relative — `original_shift` is always the
                      requester's own shift and `proposed_shift` always the one they are
                      asking for. Labelling `original_shift` "your shift" unconditionally
                      was therefore backwards on every received request, which is the only
                      kind carrying Accept and Reject. Found by walking the mobile app on
                      2026-08-23, where the same fault existed; both are now viewer-relative.
                    */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      {/* The viewer's own shift */}
                      <div className="rounded-lg bg-theme-hover/50 p-3">
                        <p className="text-xs font-medium text-theme-muted mb-1" data-testid={`swap-own-label-${swap.id}`}>{t('swaps.your_shift')}</p>
                        <p className="text-sm font-semibold text-theme-primary" data-testid={`swap-own-title-${swap.id}`}>
                          {ownShiftOf(swap).opportunity_title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-theme-subtle">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" aria-hidden="true" />
                            {ownShiftOf(swap).organization_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" aria-hidden="true" />
                            {formatShiftTime(ownShiftOf(swap))}
                          </span>
                        </div>
                      </div>

                      {/* The other person's shift */}
                      <div className="rounded-lg bg-theme-hover/50 p-3">
                        <p className="text-xs font-medium text-theme-muted mb-1" data-testid={`swap-other-label-${swap.id}`}>
                          {swap.direction === 'received' ? t('swaps.their_shift') : t('swaps.proposed_shift')}
                        </p>
                        <p className="text-sm font-semibold text-theme-primary" data-testid={`swap-other-title-${swap.id}`}>
                          {otherShiftOf(swap).opportunity_title}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-theme-subtle">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3 h-3" aria-hidden="true" />
                            {otherShiftOf(swap).organization_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" aria-hidden="true" />
                            {formatShiftTime(otherShiftOf(swap))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {swap.message && (
                      <p className="text-sm text-theme-muted italic mb-2">
                        &quot;{swap.message}&quot;
                      </p>
                    )}

                    <p className="text-xs text-theme-subtle">
                      {t('swaps.requested')} {new Date(swap.created_at).toLocaleDateString(getFormattingLocale())}
                    </p>
                  </div>

                  {/* Action buttons for received pending swaps */}
                  {swap.direction === 'received' && swap.status === 'pending' && (
                    <div className="flex flex-col gap-2 sm:flex-shrink-0">
                      <Button
                        size="sm"
                        className="bg-gradient-to-r from-emerald-500 to-green-600 text-white"
                        startContent={<Check className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => handleAccept(swap.id)}
                        isLoading={actioningId === swap.id}
                      >
                        {t('swaps.accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        startContent={<X className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => setRejectTarget(swap.id)}
                        isDisabled={actioningId === swap.id}
                      >
                        {t('swaps.reject')}
                      </Button>
                    </div>
                  )}

                  {/* Cancel button for sent pending swaps */}
                  {swap.direction === 'sent' && swap.status === 'pending' && (
                    <div className="flex flex-col gap-2 sm:flex-shrink-0">
                      <Button
                        size="sm"
                        variant="danger-soft"
                        startContent={<Ban className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => handleCancel(swap.id)}
                        isLoading={actioningId === swap.id}
                      >
                        {t('swaps.cancel')}
                      </Button>
                    </div>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      )}
      {/* Reject Confirmation Modal */}
      <Modal
        isOpen={rejectTarget !== null}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">{t('swaps.reject')}</ModalHeader>
              <ModalBody>
                <p className="text-theme-secondary">
                  {t('swaps.reject_confirm')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('cancel')}</Button>
                <Button variant="danger" onPress={handleReject}>{t('swaps.reject')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ShiftSwapsTab;
