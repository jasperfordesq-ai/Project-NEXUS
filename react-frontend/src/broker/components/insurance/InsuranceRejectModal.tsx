// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reject a certificate with a reason. Only a success closes the modal — a
 * failure keeps the typed reason so the broker can fix the problem and retry.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import X from 'lucide-react/icons/x';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminInsurance } from '@/admin/api/adminApi';
import type { InsuranceCertificate } from '@/admin/api/types';

interface InsuranceRejectModalProps {
  item: InsuranceCertificate | null;
  onClose: () => void;
  onRejected: () => void;
}

export function InsuranceRejectModal({ item, onClose, onRejected }: InsuranceRejectModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  // A fresh reason box for each certificate.
  useEffect(() => { setReason(''); }, [item?.id]);

  if (!item) return null;

  const handleReject = async () => {
    if (!reason.trim()) {
      toast.error(t('insurance.reject_reason_required'));
      return;
    }
    setLoading(true);
    try {
      const res = await adminInsurance.reject(item.id, reason);
      if (res?.success) {
        toast.success(t('insurance.reject_success'));
        onRejected();
        onClose();
      } else {
        toast.error(res?.error || t('insurance.reject_failed'));
      }
    } catch {
      toast.error(t('insurance.reject_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <X size={20} className="text-danger" aria-hidden="true" />
          {t('insurance.modal_reject_title')}
        </ModalHeader>
        <ModalBody>
          <p className="mb-3 text-muted">{t('insurance.confirm_reject')}</p>
          <Textarea
            label={t('insurance.field_reason')}
            placeholder={t('insurance.field_reason_placeholder')}
            value={reason}
            onValueChange={setReason}
            minRows={3}
            variant="secondary"
            isRequired
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={loading}>
            {t('insurance.cancel')}
          </Button>
          <Button variant="danger" onPress={handleReject} isPending={loading}>
            {t('insurance.reject')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default InsuranceRejectModal;
