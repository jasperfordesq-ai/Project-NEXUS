// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ApproveArchiveModal — close a message copy as fine and freeze the record.
 *
 * Owns the optional decision notes and the API call; the message page only
 * decides what happens next (usually: on to the next one in the queue).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Archive from 'lucide-react/icons/archive';

import { useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@/components/ui';

interface ApproveArchiveModalProps {
  messageId: number | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the archive record has been written. */
  onApproved: () => void;
}

export function ApproveArchiveModal({ messageId, isOpen, onClose, onApproved }: ApproveArchiveModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) setNotes('');
  }, [isOpen, messageId]);

  const submit = async () => {
    if (!messageId) return;
    setLoading(true);
    try {
      const res = await adminBroker.approveMessage(messageId, notes || undefined);
      if (res?.success) {
        toast.success(t('messages.detail_approve_success'));
        onClose();
        onApproved();
      } else {
        toast.error(res?.error || t('messages.detail_approve_failed'));
      }
    } catch {
      toast.error(t('messages.detail_approve_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Archive size={20} className="text-accent" aria-hidden="true" />
          {t('messages.detail_approve_archive')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-foreground">{t('messages.detail_approve_confirm')}</p>
          <p className="text-sm text-muted">{t('messages.detail_approve_warning')}</p>
          <Textarea
            label={t('messages.detail_decision_notes_label')}
            placeholder={t('messages.detail_decision_notes_placeholder')}
            value={notes}
            onValueChange={setNotes}
            minRows={3}
            variant="bordered"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={loading}>
            {t('messages.cancel')}
          </Button>
          <Button
            color="primary"
            onPress={submit}
            isLoading={loading}
            isDisabled={!messageId}
            startContent={!loading && <Archive size={16} aria-hidden="true" />}
          >
            {t('messages.detail_approve_archive')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default ApproveArchiveModal;
