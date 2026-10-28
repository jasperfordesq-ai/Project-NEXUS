// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CancelOrderModal — confirm cancelling a marketplace order, with a reason.
 *
 * Used by both the buyer's and the seller's order pages. Laravel's
 * PUT /v2/marketplace/orders/{id}/cancel lets either party cancel and requires a
 * `reason` (max 500 characters); both parties are e-mailed the cancellation.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import XCircle from 'lucide-react/icons/circle-x';
import { Button } from '@/components/ui/Button';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

const REASON_MAX_LENGTH = 500;

/**
 * Whether the server would accept a cancel for an order in this status.
 *
 * Laravel refuses paid, shipped, delivered, completed, refunded and disputed
 * orders (a paid order needs a refund instead), so the button is offered only
 * while the order is still awaiting payment — the same rule the accessible site
 * uses. A rare zero-price "paid" order the server would also accept is not
 * offered, because the client cannot see the payment details that decide it.
 */
export function canCancelMarketplaceOrder(status: string): boolean {
  return status === 'pending_payment';
}

export interface CancelOrderModalProps {
  orderId: number | null;
  onClose: () => void;
  onCancelled: (orderId: number) => void;
}

export function CancelOrderModal({ orderId, onClose, onCancelled }: CancelOrderModalProps) {
  const { t } = useTranslation('marketplace');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (orderId !== null) {
      setReason('');
      setReasonError(null);
    }
  }, [orderId]);

  const handleConfirm = async () => {
    if (orderId === null) return;
    const trimmed = reason.trim();
    if (trimmed === '') {
      setReasonError(t('orders.cancel.reason_required'));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.put(`/v2/marketplace/orders/${orderId}/cancel`, {
        reason: trimmed.slice(0, REASON_MAX_LENGTH),
      });
      if (response.success) {
        toast.success(t('orders.cancel.success'));
        onCancelled(orderId);
        onClose();
      } else {
        toast.error(response.error || t('orders.cancel.error'));
      }
    } catch (err) {
      logError('Failed to cancel marketplace order', err);
      toast.error(t('orders.cancel.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={orderId !== null}
      onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}
      size="md"
      placement="center"
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-danger" aria-hidden="true" />
          {t('orders.cancel.modal_title')}
        </ModalHeader>
        <ModalBody className="space-y-4">
          <p className="text-sm text-muted">{t('orders.cancel.modal_body')}</p>
          <Textarea
            label={t('orders.cancel.reason_label')}
            placeholder={t('orders.cancel.reason_placeholder')}
            value={reason}
            onValueChange={(value) => {
              setReason(value);
              if (reasonError) setReasonError(null);
            }}
            maxLength={REASON_MAX_LENGTH}
            minRows={3}
            variant="bordered"
            isRequired
            isInvalid={reasonError !== null}
            errorMessage={reasonError ?? undefined}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={isSubmitting}>
            {t('orders.cancel.keep')}
          </Button>
          <Button variant="danger" onPress={handleConfirm} isLoading={isSubmitting}>
            {t('orders.cancel.confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default CancelOrderModal;
