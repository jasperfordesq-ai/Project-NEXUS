// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MonitorSenderModal — put a message's sender under monitoring from the place
 * a concern is spotted, with a confirm step and an editable reason (the server
 * requires one). Uses the same upsert the Monitoring page uses, so an entry
 * added here looks exactly like one added there.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import UserPlus from 'lucide-react/icons/user-plus';

import { useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from '@/components/ui';

interface MonitorSenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  sender: { id: number; name: string } | null;
  /** The copy being reviewed, named in the default reason. */
  messageId: number;
  /** Called with the sender's id once monitoring has been recorded. */
  onAdded: (userId: number) => void;
}

export function MonitorSenderModal({ isOpen, onClose, sender, messageId, onAdded }: MonitorSenderModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) setReason(t('messages.monitor_reason_default', { id: messageId }));
  }, [isOpen, messageId, t]);

  const submit = async () => {
    if (!sender) return;
    if (!reason.trim()) {
      toast.error(t('monitoring.reason_required'));
      return;
    }
    setLoading(true);
    try {
      const res = await adminBroker.setMonitoring(sender.id, { under_monitoring: true, reason: reason.trim() });
      if (res?.success) {
        toast.success(t('messages.monitor_success'));
        onClose();
        onAdded(sender.id);
      } else {
        toast.error(res?.error || t('messages.monitor_failed'));
      }
    } catch {
      toast.error(t('messages.monitor_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <UserPlus size={20} className="text-warning" aria-hidden="true" />
          {t('messages.add_sender_to_monitoring')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-foreground">{t('messages.monitor_modal_body', { name: sender?.name ?? '' })}</p>
          <Textarea
            label={t('monitoring.reason_label')}
            value={reason}
            onValueChange={setReason}
            minRows={2}
            variant="bordered"
            isRequired
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={loading}>
            {t('messages.cancel')}
          </Button>
          <Button
            color="warning"
            onPress={submit}
            isLoading={loading}
            isDisabled={!sender || !reason.trim()}
            startContent={!loading && <UserPlus size={16} aria-hidden="true" />}
          >
            {t('messages.monitor_confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default MonitorSenderModal;
