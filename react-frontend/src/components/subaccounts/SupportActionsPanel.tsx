// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SupportActionsPanel — both sides of the co_decide confirm loop.
 *
 * "Waiting for your approval": actions a supporter prepared for THIS member.
 * Nothing happens unless the member approves; declining is an equal option
 * and the reason field is OPTIONAL — requiring somebody to justify refusing
 * a safeguarding arrangement is pressure to consent (same rule as the
 * guardian-arrangement responses in SafeguardingTab).
 *
 * "Prepared by you": actions this member prepared for people they support,
 * with the option to withdraw one before it is answered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalHeading,
  TextArea,
} from '@/components/ui';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import HandHeart from 'lucide-react/icons/hand-heart';
import { GlassCard } from '@/components/ui/GlassCard';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { useToast } from '@/contexts';

type ActionStatus = 'pending' | 'confirmed' | 'declined' | 'expired' | 'cancelled';

interface SupportAction {
  id: number;
  action_type: 'listing_create' | 'credit_transfer' | 'message_access_grant';
  status: ActionStatus;
  payload_summary: { title?: string | null; amount?: number | null };
  other_party_name: string | null;
  created_at: string | null;
  expires_at: string | null;
}

const STATUS_COLOR: Record<ActionStatus, 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  confirmed: 'success',
  declined: 'danger',
  expired: 'default',
  cancelled: 'default',
};

function summarise(action: SupportAction, typeLabel: string): string {
  const detail = action.action_type === 'credit_transfer'
    ? action.payload_summary.amount
    : action.payload_summary.title;

  return detail != null && detail !== '' ? `${typeLabel} — ${detail}` : typeLabel;
}

export function SupportActionsPanel() {
  const { t } = useTranslation('settings');
  const toast = useToast();

  const [incoming, setIncoming] = useState<SupportAction[]>([]);
  const [outgoing, setOutgoing] = useState<SupportAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Declining confirms first, with an OPTIONAL reason — never required.
  const [declining, setDeclining] = useState<SupportAction | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [mine, prepared] = await Promise.all([
        api.get<{ actions: SupportAction[]; pending_count: number }>('/v2/users/me/support-actions'),
        api.get<{ actions: SupportAction[] }>('/v2/users/me/support-actions?role=supporter'),
      ]);
      // 🔴 api.ts never throws — success must be checked explicitly. And a
      // failed fetch must NOT render as "nothing pending": a member with a
      // real transfer awaiting their approval would see an empty page and
      // reasonably conclude there is nothing to answer (audit finding A5).
      if (mine.success && mine.data) setIncoming(mine.data.actions ?? []);
      if (prepared.success && prepared.data) setOutgoing(prepared.data.actions ?? []);
      if (!mine.success || !prepared.success) setLoadFailed(true);
    } catch (error) {
      logError('Failed to load support actions', error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = useCallback(async (action: SupportAction) => {
    setBusyId(action.id);
    try {
      const res = await api.post(`/v2/users/me/support-actions/${action.id}/confirm`);
      if (res.success) {
        toastRef.current.success(tRef.current('support_actions.approved_toast'));
        await load();
      } else {
        toastRef.current.error(res.error || tRef.current('support_actions.action_failed'));
      }
    } catch (error) {
      logError('Failed to confirm support action', error);
      toastRef.current.error(tRef.current('support_actions.action_failed'));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const decline = useCallback(async () => {
    const action = declining;
    if (!action) return;
    setBusyId(action.id);
    setDeclining(null);
    try {
      const body: Record<string, string> = {};
      if (declineReason.trim() !== '') body.reason = declineReason.trim();
      const res = await api.post(`/v2/users/me/support-actions/${action.id}/decline`, body);
      if (res.success) {
        toastRef.current.success(tRef.current('support_actions.declined_toast'));
        await load();
      } else {
        toastRef.current.error(res.error || tRef.current('support_actions.action_failed'));
      }
    } catch (error) {
      logError('Failed to decline support action', error);
      toastRef.current.error(tRef.current('support_actions.action_failed'));
    } finally {
      setDeclineReason('');
      setBusyId(null);
    }
  }, [declining, declineReason, load]);

  const withdraw = useCallback(async (action: SupportAction) => {
    setBusyId(action.id);
    try {
      const res = await api.delete(`/v2/users/me/support-actions/${action.id}`);
      if (res.success) {
        toastRef.current.success(tRef.current('support_actions.cancelled_toast'));
        await load();
      } else {
        toastRef.current.error(res.error || tRef.current('support_actions.action_failed'));
      }
    } catch (error) {
      logError('Failed to withdraw support action', error);
      toastRef.current.error(tRef.current('support_actions.action_failed'));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  // The panel earns its screen space only when there is something to show —
  // most members have no support relationships at all. But silence is only
  // acceptable when we KNOW there is nothing: while loading nothing renders
  // (brief, and the settings tab has its own spinner), while a failed load
  // must say so rather than impersonate an empty queue.
  if (loading) return null;
  if (loadFailed) {
    return (
      <GlassCard className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-theme-muted" data-testid="support-actions-load-failed">
            {t('support_actions.load_failed')}
          </p>
          <Button size="sm" variant="secondary" onPress={() => { setLoading(true); void load(); }}>
            {t('support_actions.retry')}
          </Button>
        </div>
      </GlassCard>
    );
  }
  if (incoming.length === 0 && outgoing.length === 0) return null;

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(getFormattingLocale()) : '';

  return (
    <GlassCard className="p-4 sm:p-6 space-y-6">
      {incoming.length > 0 && (
        <section aria-labelledby="support-actions-incoming" className="space-y-3">
          <div className="flex items-start gap-2">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <div>
              <h3 id="support-actions-incoming" className="font-semibold text-theme-primary">
                {t('support_actions.waiting_title')}
              </h3>
              <p className="text-sm text-theme-muted">{t('support_actions.waiting_intro')}</p>
            </div>
          </div>
          <ul className="space-y-3">
            {incoming.map((action) => (
              <li key={action.id} className="rounded-lg border border-theme-default bg-theme-elevated/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-theme-primary">
                      {summarise(action, t(`support_actions.type_${action.action_type}`))}
                    </p>
                    <p className="text-xs text-theme-muted">
                      {t('support_actions.from_name', { name: action.other_party_name ?? '' })}
                      {action.expires_at && ` · ${t('support_actions.expires', { date: formatDate(action.expires_at) })}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      color="primary"
                      isLoading={busyId === action.id}
                      onPress={() => approve(action)}
                    >
                      {t('support_actions.approve_button')}
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={busyId === action.id}
                      onPress={() => { setDeclineReason(''); setDeclining(action); }}
                    >
                      {t('support_actions.decline_button')}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section aria-labelledby="support-actions-outgoing" className="space-y-3">
          <div className="flex items-start gap-2">
            <HandHeart className="mt-0.5 h-5 w-5 shrink-0 text-theme-muted" aria-hidden="true" />
            <div>
              <h3 id="support-actions-outgoing" className="font-semibold text-theme-primary">
                {t('support_actions.prepared_by_you_title')}
              </h3>
              <p className="text-sm text-theme-muted">{t('support_actions.prepared_by_you_intro')}</p>
            </div>
          </div>
          <ul className="space-y-3">
            {outgoing.map((action) => (
              <li key={action.id} className="rounded-lg border border-theme-default bg-theme-elevated/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-theme-primary">
                      {summarise(action, t(`support_actions.type_${action.action_type}`))}
                    </p>
                    <p className="text-xs text-theme-muted">
                      {t('support_actions.for_name', { name: action.other_party_name ?? '' })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Chip size="sm" variant="flat" color={STATUS_COLOR[action.status] ?? 'default'}>
                      {t(`support_actions.status_${action.status}`)}
                    </Chip>
                    {action.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="tertiary"
                        isLoading={busyId === action.id}
                        onPress={() => withdraw(action)}
                      >
                        {t('support_actions.cancel_button')}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Declining confirms first, with an OPTIONAL reason.
        🔴 The reason must never be required — see the guardian-arrangement
        decline flow this mirrors.
      */}
      <Modal isOpen={declining !== null} onOpenChange={(open) => { if (!open) setDeclining(null); }}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <ModalHeading>{t('support_actions.decline_confirm_title')}</ModalHeading>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-theme-muted">
                  {t('support_actions.decline_confirm_body', { name: declining?.other_party_name ?? '' })}
                </p>
                <TextArea
                  className="mt-3"
                  label={t('support_actions.reason_label')}
                  description={t('support_actions.reason_hint')}
                  value={declineReason}
                  onValueChange={setDeclineReason}
                  maxLength={500}
                  minRows={2}
                  maxRows={5}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('cancel', { ns: 'common' })}
                </Button>
                <Button variant="danger" onPress={() => { void decline(); }}>
                  {t('support_actions.decline_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </GlassCard>
  );
}

export default SupportActionsPanel;
