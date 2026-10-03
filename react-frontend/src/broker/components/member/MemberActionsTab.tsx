// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member window — Actions tab: the operational buttons (approve / suspend /
 * reactivate, resend verification, password reset, 2FA reset with a reason,
 * adjust balance) and the safe profile editor. Privileged actions (role or
 * status change, ban, delete) are intentionally absent. Extracted from
 * MemberDetailModal unchanged in behaviour.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import MailCheck from 'lucide-react/icons/mail-check';
import KeyRound from 'lucide-react/icons/key-round';
import ShieldOff from 'lucide-react/icons/shield-off';
import Coins from 'lucide-react/icons/coins';
import { Button, Input, Separator, useConfirm } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminUsers } from '@/admin/api/adminApi';
import type { AdminUserDetail } from '@/admin/api/types';
import { MemberProfileEditor } from './MemberProfileEditor';
import { MemberBalanceModal } from './MemberBalanceModal';

interface MemberActionsTabProps {
  detail: AdminUserDetail;
  /** Called after any mutation so the parent list can refresh. */
  onChanged: () => void;
  /** Reload the member shown in the window. */
  reload: () => Promise<void>;
}

export function MemberActionsTab({ detail, onChanged, reload }: MemberActionsTabProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const confirm = useConfirm();
  // Which action is currently running (disables the relevant button).
  const [busy, setBusy] = useState<string | null>(null);
  const [resetReason, setResetReason] = useState('');
  const [balanceOpen, setBalanceOpen] = useState(false);

  // Generic action runner — refreshes the detail + parent list on success.
  const run = useCallback(async (
    key: string,
    fn: () => Promise<{ success?: boolean; error?: string }>,
    successKey: string,
    refetch = true,
  ) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res?.success) {
        toast.success(t(successKey));
        onChanged();
        if (refetch) await reload();
      } else {
        toast.error(res?.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setBusy(null);
    }
  }, [toast, t, onChanged, reload]);

  // Suspend and reactivate change the member's access (and reactivation emails
  // them), so both ask first — the same wording the Members list uses.
  const handleSuspend = useCallback(async () => {
    const ok = await confirm({
      title: t('members.confirm_suspend_title'),
      body: t('members.confirm_suspend_message'),
      confirmLabel: t('members.suspend'),
      status: 'danger',
    });
    if (!ok) return;
    await run('suspend', () => adminUsers.suspend(detail.id), 'member_detail.suspend_success');
  }, [detail.id, confirm, t, run]);

  const handleReactivate = useCallback(async () => {
    const ok = await confirm({
      title: t('members.confirm_reactivate_title'),
      body: t('members.confirm_reactivate_message', { name: detail.name }),
      confirmLabel: t('members.reactivate'),
      status: 'accent',
    });
    if (!ok) return;
    await run('reactivate', () => adminUsers.reactivate(detail.id), 'member_detail.reactivate_success');
  }, [detail.id, detail.name, confirm, t, run]);

  const afterChange = useCallback(async () => {
    onChanged();
    await reload();
  }, [onChanged, reload]);

  return (
    <div className="space-y-4 pt-3">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t('member_detail.section_actions')}</p>
        <div className="flex flex-wrap gap-2">
          {detail.status === 'pending' && (
            <Button size="sm" color="success" variant="flat" startContent={<UserCheck size={14} />} isLoading={busy === 'approve'}
              onPress={() => run('approve', () => adminUsers.approve(detail.id), 'member_detail.approve_success')}>
              {t('members.approve')}
            </Button>
          )}
          {detail.status === 'active' && (
            <Button size="sm" color="danger" variant="flat" startContent={<UserX size={14} />} isLoading={busy === 'suspend'}
              onPress={handleSuspend}>
              {t('members.suspend')}
            </Button>
          )}
          {detail.status === 'suspended' && (
            <Button size="sm" variant="tertiary" startContent={<RotateCcw size={14} />} isLoading={busy === 'reactivate'}
              onPress={handleReactivate}>
              {t('members.reactivate')}
            </Button>
          )}
          <Button size="sm" variant="tertiary" startContent={<MailCheck size={14} />} isLoading={busy === 'verify'}
            onPress={() => run('verify', () => adminUsers.sendVerificationEmail(detail.id), 'member_detail.verification_sent', false)}>
            {t('member_detail.action_resend_verification')}
          </Button>
          <Button size="sm" variant="tertiary" startContent={<KeyRound size={14} />} isLoading={busy === 'pwd'}
            onPress={() => run('pwd', () => adminUsers.sendPasswordReset(detail.id), 'member_detail.password_reset_sent', false)}>
            {t('member_detail.action_send_password_reset')}
          </Button>
          <Input
            size="sm"
            variant="bordered"
            label={t('member_detail.reset_2fa_reason_label')}
            value={resetReason}
            onValueChange={setResetReason}
            minLength={10}
            maxLength={500}
          />
          <Button size="sm" variant="tertiary" startContent={<ShieldOff size={14} />} isLoading={busy === '2fa'} isDisabled={resetReason.trim().length < 10}
            onPress={() => run('2fa', () => adminUsers.reset2fa(detail.id, resetReason.trim()), 'member_detail.reset_2fa_success', false)}>
            {t('member_detail.action_reset_2fa')}
          </Button>
          <Button size="sm" color="primary" variant="flat" startContent={<Coins size={14} />}
            onPress={() => setBalanceOpen(true)}>
            {t('member_detail.action_adjust_balance')}
          </Button>
        </div>
      </div>

      <Separator />

      <MemberProfileEditor detail={detail} onSaved={afterChange} />

      <MemberBalanceModal
        isOpen={balanceOpen}
        userId={detail.id}
        onClose={() => setBalanceOpen(false)}
        onAdjusted={afterChange}
      />
    </div>
  );
}

export default MemberActionsTab;
