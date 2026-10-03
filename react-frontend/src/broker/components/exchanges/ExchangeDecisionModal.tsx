// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ExchangeDecisionModal — approve or reject an exchange awaiting broker review.
 *
 * One modal shared by the Exchanges list and the Exchange detail page, which
 * carried two copies of it until October 2026. A rejection needs a reason; an
 * approval may carry notes. The modal closes only on success — a failed
 * request keeps the typed text on screen so the broker can retry or copy it
 * out. The server stays the authority: it refuses a broker who is a party to
 * the exchange, and the error it returns is what the toast shows.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import { adminBroker } from '@/admin/api/adminApi';
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

export type ExchangeDecisionType = 'approve' | 'reject';

export interface ExchangeDecisionModalProps {
  /** The exchange being decided. */
  exchangeId: number;
  type: ExchangeDecisionType;
  onClose: () => void;
  /** Called after the server accepted the decision (the modal has closed). */
  onDecided: () => void;
}

export function ExchangeDecisionModal({ exchangeId, type, onClose, onDecided }: ExchangeDecisionModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const isApprove = type === 'approve';

  const submit = async () => {
    if (!isApprove && !text.trim()) {
      toast.error(t('exchanges.reason_required_error'));
      return;
    }
    setLoading(true);
    try {
      const res = isApprove
        ? await adminBroker.approveExchange(exchangeId, text || undefined)
        : await adminBroker.rejectExchange(exchangeId, text);
      if (res?.success) {
        toast.success(t('exchanges.action_succeeded'));
        onClose();
        onDecided();
      } else {
        toast.error(res?.error || t('exchanges.action_failed'));
      }
    } catch {
      toast.error(t('exchanges.action_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          {isApprove ? (
            <>
              <CheckCircle size={20} className="text-success" aria-hidden="true" />
              {t('exchanges.approve_modal_title')}
            </>
          ) : (
            <>
              <XCircle size={20} className="text-danger" aria-hidden="true" />
              {t('exchanges.reject_modal_title')}
            </>
          )}
        </ModalHeader>
        <ModalBody>
          <p className="mb-3 text-foreground/70">
            {isApprove ? t('exchanges.approve_confirm_text') : t('exchanges.reject_confirm_text')}
          </p>
          <Textarea
            label={isApprove ? t('exchanges.notes_optional_label') : t('exchanges.reason_required_label')}
            placeholder={isApprove ? t('exchanges.approval_notes_placeholder') : t('exchanges.rejection_reason_placeholder')}
            value={text}
            onValueChange={setText}
            minRows={3}
            variant="secondary"
            isRequired={!isApprove}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={loading}>
            {t('common.cancel')}
          </Button>
          {isApprove ? (
            <Button color="success" onPress={submit} isLoading={loading}>
              {t('exchanges.approve')}
            </Button>
          ) : (
            <Button variant="danger" onPress={submit} isLoading={loading}>
              {t('exchanges.reject')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default ExchangeDecisionModal;
