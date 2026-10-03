// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VettingRevokeModal — withdraw a member's current safeguarding confirmation
 * with a controlled reason code. Mount it fresh per member; it is never shown
 * closed. Extracted from VettingPage in October 2026; behaviour unchanged.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminVetting } from '@/admin/api/adminApi';
import type { VettingRecord } from '@/admin/api/types';
import { useToast } from '@/contexts';
import { resolveUserDisplayName } from '@/lib/helpers';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
} from '@/components/ui';

export interface VettingRevokeModalProps {
  item: VettingRecord;
  /** Controlled reason codes from the policy; the first is preselected. */
  reasonCodes: string[];
  canRecordDecision: boolean;
  onClose: () => void;
  /** Called after the server recorded the revocation (the modal has closed). */
  onRevoked: () => void;
}

export function VettingRevokeModal({ item, reasonCodes, canRecordDecision, onClose, onRevoked }: VettingRevokeModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [reason, setReason] = useState(reasonCodes[0] ?? '');
  const [revoking, setRevoking] = useState(false);

  const submit = async () => {
    if (!reason || !canRecordDecision) return;
    setRevoking(true);
    try {
      const response = await adminVetting.revoke(item.user_id, reason, item.review_request_id);
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_revoke_failed'));
        return;
      }
      toast.success(t('vetting.toast_revoked'));
      onClose();
      onRevoked();
    } catch {
      toast.error(t('vetting.toast_revoke_failed'));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <ModalContent>
        <ModalHeader>{t('vetting.revoke_title')}</ModalHeader>
        <ModalBody className="space-y-4">
          <p>{t('vetting.revoke_body', { name: resolveUserDisplayName(item) })}</p>
          <Select
            label={t('vetting.reason_label')}
            selectedKeys={reason ? new Set([reason]) : new Set()}
            onSelectionChange={(keys) => setReason(String(Array.from(keys)[0] ?? ''))}
          >
            {reasonCodes.map((code) => (
              <SelectItem key={code} id={code}>{t(`vetting.reason_${code}`)}</SelectItem>
            ))}
          </Select>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>{t('vetting.cancel')}</Button>
          <Button variant="danger" isPending={revoking} isDisabled={!reason} onPress={submit}>
            {t('vetting.revoke_button')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default VettingRevokeModal;
