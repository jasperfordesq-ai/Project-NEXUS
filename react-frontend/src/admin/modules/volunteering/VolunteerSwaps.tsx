// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Shift Swaps (admin)
 * Resolves shift swap requests that require admin approval. Such requests sit in
 * the `admin_pending` state until an admin approves or rejects them here —
 * previously no frontend screen could resolve them, so they got stuck forever.
 * Parity: VolunteerCommunityController::adminPendingSwaps() + adminDecideSwap().
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useState } from 'react';

import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { Avatar, Button, Card, CardBody, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui';
import { adminVolunteering } from '../../api/adminApi';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';

interface ShiftRef {
  id: number;
  start_time: string;
  end_time: string;
  opportunity_title: string | null;
}

interface SwapRequest {
  id: number;
  status: string;
  message: string | null;
  requester: { id: number; name: string };
  recipient: { id: number; name: string };
  original_shift: ShiftRef;
  proposed_shift: ShiftRef;
  created_at: string;
}

function formatShift(shift: ShiftRef): string {
  if (!shift?.start_time) return '--';
  const start = new Date(shift.start_time);
  const startStr = start.toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  if (shift.end_time) {
    const end = new Date(shift.end_time);
    return `${startStr} – ${end.toLocaleTimeString(getFormattingLocale(), { timeStyle: 'short' })}`;
  }
  return startStr;
}

export function VolunteerSwaps() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.swaps_title'));
  const toast = useToast();

  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  // Confirmation modal
  const [confirm, setConfirm] = useState<{ swap: SwapRequest; action: 'approve' | 'reject' } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getPendingSwaps();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        const rows = Array.isArray(payload)
          ? payload
          : (payload && typeof payload === 'object' && 'data' in payload
            ? (payload as { data: SwapRequest[] }).data
            : []) || [];
        setSwaps(rows as SwapRequest[]);
      } else {
        setSwaps([]);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_swaps'));
      setSwaps([]);
    }
    setLoading(false);
  }, [toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const decide = useCallback(async (swap: SwapRequest, action: 'approve' | 'reject') => {
    setActionId(swap.id);
    try {
      const res = await adminVolunteering.decideSwap(swap.id, action);
      if (res.success) {
        toast.success(action === 'approve' ? t('volunteering.swap_approved') : t('volunteering.swap_rejected'));
        setSwaps((prev) => prev.filter((s) => s.id !== swap.id));
      } else {
        // The server says why (a shift has started, a volunteer has left it, the
        // request has expired); the queue is reloaded so a dead request drops out.
        toast.error(res.errors?.[0]?.message || res.error || t('volunteering.failed_to_decide_swap'));
        void loadData();
      }
    } catch {
      toast.error(t('volunteering.failed_to_decide_swap'));
    } finally {
      setActionId(null);
      setConfirm(null);
    }
  }, [toast, t, loadData]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.swaps_title')}
        description={t('volunteering.swaps_desc')}
        actions={
          <Button variant="tertiary" startContent={<RefreshCw aria-hidden="true" size={16} />} onPress={loadData} isLoading={loading}>
            {t('volunteering.refresh')}
          </Button>
        }
      />

      {!loading && swaps.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={t('volunteering.no_pending_swaps')}
          description={t('volunteering.no_pending_swaps_desc')}
        />
      ) : (
        <div className="space-y-4" role="list">
          {loading && swaps.length === 0 ? (
            <div role="status" aria-busy="true" aria-label={t('volunteering.loading')} className="text-muted/80 text-sm">
              {t('volunteering.loading')}
            </div>
          ) : (
            swaps.map((swap) => (
              <Card key={swap.id} role="listitem" className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
                <CardBody className="flex flex-col gap-4 p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    {/* Requester → Recipient */}
                    <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={swap.requester.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted/80">{t('volunteering.swap_col_requester')}</p>
                          <p className="truncate font-medium">{swap.requester.name}</p>
                        </div>
                      </div>
                      <ArrowRight aria-hidden="true" size={18} className="hidden shrink-0 text-muted sm:block" />
                      <div className="flex items-center gap-3">
                        <Avatar name={swap.recipient.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted/80">{t('volunteering.swap_col_recipient')}</p>
                          <p className="truncate font-medium">{swap.recipient.name}</p>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        color="success"
                        variant="tertiary"
                        startContent={<CheckCircle aria-hidden="true" size={14} />}
                        onPress={() => setConfirm({ swap, action: 'approve' })}
                        isLoading={actionId === swap.id}
                        isDisabled={actionId !== null && actionId !== swap.id}
                      >
                        {t('volunteering.approve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        startContent={<XCircle aria-hidden="true" size={14} />}
                        onPress={() => setConfirm({ swap, action: 'reject' })}
                        isLoading={actionId === swap.id}
                        isDisabled={actionId !== null && actionId !== swap.id}
                      >
                        {t('volunteering.reject')}
                      </Button>
                    </div>
                  </div>

                  {/* Shift detail */}
                  <div className="grid grid-cols-1 gap-3 rounded-xl bg-surface-tertiary/50 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted/80">{t('volunteering.swap_gives_up')}</p>
                      <p className="font-medium">{swap.original_shift.opportunity_title || '--'}</p>
                      <p className="text-muted">{formatShift(swap.original_shift)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted/80">{t('volunteering.swap_takes')}</p>
                      <p className="font-medium">{swap.proposed_shift.opportunity_title || '--'}</p>
                      <p className="text-muted">{formatShift(swap.proposed_shift)}</p>
                    </div>
                  </div>

                  {swap.message && (
                    <p className="text-sm text-muted">“{swap.message}”</p>
                  )}
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Confirmation modal */}
      <Modal isOpen={confirm !== null} onClose={() => setConfirm(null)} size="md">
        <ModalContent>
          <ModalHeader>
            {confirm?.action === 'approve' ? t('volunteering.approve') : t('volunteering.reject')}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm">
              {confirm?.action === 'approve'
                ? t('volunteering.confirm_approve_swap')
                : t('volunteering.confirm_reject_swap')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setConfirm(null)}>
              {t('volunteering.cancel')}
            </Button>
            <Button
              variant={confirm?.action === 'reject' ? 'danger' : 'primary'}
              onPress={() => confirm && decide(confirm.swap, confirm.action)}
              isLoading={actionId !== null}
            >
              {confirm?.action === 'approve' ? t('volunteering.approve') : t('volunteering.reject')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default VolunteerSwaps;
