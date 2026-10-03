// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MatchRejectModal — reject a smart-match proposal with a reason the member
 * will see. Shared by the Match approvals list and detail pages, which each
 * carried a copy until October 2026. Submit stays disabled until a reason is
 * typed; the modal closes only on success so a failed request keeps the
 * reason on screen. The server refuses a broker who is a party to the match
 * and its message is what the toast shows.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import XCircle from 'lucide-react/icons/circle-x';
import { adminMatching } from '@/admin/api/adminApi';
import type { MatchApproval } from '@/admin/api/types';
import { useToast } from '@/contexts';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/ui';

export interface MatchRejectModalProps {
  match: Pick<MatchApproval, 'id' | 'user_1_name' | 'user_2_name'>;
  onClose: () => void;
  /** Called after the server accepted the rejection (the modal has closed). */
  onRejected: () => void;
}

export function MatchRejectModal({ match, onClose, onRejected }: MatchRejectModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error(t('matching.reject_reason_required'));
      return;
    }
    setLoading(true);
    try {
      const res = await adminMatching.rejectMatch(match.id, reason.trim());
      if (res.success) {
        toast.success(t('matching.rejected_toast'));
        onClose();
        onRejected();
      } else {
        toast.error(res.error || t('matching.reject_failed'));
      }
    } catch {
      toast.error(t('matching.reject_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <XCircle size={20} className="text-danger" aria-hidden="true" />
          {t('matching.reject')}
        </ModalHeader>
        <ModalBody>
          <p className="mb-3 text-sm text-muted">
            {t('matching.rejecting_between', { user1: match.user_1_name, user2: match.user_2_name })}
          </p>
          <Textarea
            label={t('matching.reject_reason_label')}
            placeholder={t('matching.reject_reason_placeholder')}
            value={reason}
            onValueChange={setReason}
            variant="secondary"
            minRows={3}
            isRequired
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={loading}>
            {t('matching.cancel')}
          </Button>
          <Button variant="danger" onPress={submit} isLoading={loading} isDisabled={!reason.trim()}>
            {t('matching.reject')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default MatchRejectModal;
