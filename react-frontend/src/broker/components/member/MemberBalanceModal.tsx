// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Adjust a member's time balance (credit or debit, with a mandatory reason).
 * Extracted from MemberDetailModal unchanged in behaviour.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Coins from 'lucide-react/icons/coins';
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminTimebanking } from '@/admin/api/adminApi';

interface MemberBalanceModalProps {
  isOpen: boolean;
  userId: number;
  onClose: () => void;
  /** Called after a successful adjustment so the parent can refresh. */
  onAdjusted: () => void | Promise<void>;
}

export function MemberBalanceModal({ isOpen, userId, onClose, onAdjusted }: MemberBalanceModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Start every opening with a clean form.
  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setReason('');
    }
  }, [isOpen]);

  const submit = useCallback(async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      toast.error(t('member_detail.balance_amount_invalid'));
      return;
    }
    if (!reason.trim()) {
      toast.error(t('member_detail.balance_reason_required'));
      return;
    }
    setBusy(true);
    try {
      const res = await adminTimebanking.adjustBalance(userId, value, reason.trim());
      if (res.success) {
        toast.success(t('member_detail.balance_success'));
        onClose();
        await onAdjusted();
      } else {
        toast.error(res.error || t('member_detail.action_failed'));
      }
    } catch {
      toast.error(t('member_detail.action_failed'));
    } finally {
      setBusy(false);
    }
  }, [amount, reason, userId, toast, t, onClose, onAdjusted]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Coins size={18} className="text-primary" />
          {t('member_detail.balance_modal_title')}
        </ModalHeader>
        <ModalBody className="gap-3">
          <Input
            type="number"
            variant="bordered"
            label={t('member_detail.balance_amount_label')}
            description={t('member_detail.balance_amount_help')}
            value={amount}
            onValueChange={setAmount}
            placeholder="0"
          />
          <Textarea
            variant="bordered"
            label={t('member_detail.balance_reason_label')}
            placeholder={t('member_detail.balance_reason_placeholder')}
            value={reason}
            onValueChange={setReason}
            minRows={2}
            isRequired
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" isDisabled={busy} onPress={onClose}>{t('common.cancel')}</Button>
          <Button color="primary" isLoading={busy} onPress={() => void submit()}>{t('member_detail.balance_submit')}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default MemberBalanceModal;
