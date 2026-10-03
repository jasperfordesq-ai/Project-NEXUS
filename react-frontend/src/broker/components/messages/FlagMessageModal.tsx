// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FlagMessageModal — raise a concern on a message copy.
 *
 * One dialog for the Messages list and the message page (they carried two
 * copies until October 2026). It owns the reason, the severity and the API
 * call; the page only says which copy and what to do once it is flagged.
 * The confirm stays disabled until a reason is typed, so an empty flag can
 * never reach the server.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Flag from 'lucide-react/icons/flag';

import { useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
} from '@/components/ui';
import { FLAG_SEVERITIES, type FlagSeverity } from './messageLabels';

interface FlagMessageModalProps {
  /** The copy to flag; null closes nothing but disables the confirm. */
  messageId: number | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the server has recorded the flag. */
  onFlagged: () => void;
}

export function FlagMessageModal({ messageId, isOpen, onClose, onFlagged }: FlagMessageModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState<FlagSeverity>('concern');
  const [loading, setLoading] = useState(false);

  // A fresh form every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setSeverity('concern');
    }
  }, [isOpen, messageId]);

  const submit = async () => {
    if (!messageId) return;
    if (!reason.trim()) {
      toast.error(t('messages.flag_reason_required'));
      return;
    }
    setLoading(true);
    try {
      const res = await adminBroker.flagMessage(messageId, reason, severity);
      if (res?.success) {
        toast.success(t('messages.flag_success'));
        onClose();
        onFlagged();
      } else {
        toast.error(res?.error || t('messages.flag_failed'));
      }
    } catch {
      toast.error(t('messages.flag_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Flag size={20} className="text-warning" aria-hidden="true" />
          {t('messages.flag_modal_title')}
        </ModalHeader>
        <ModalBody>
          <Textarea
            label={t('messages.flag_reason_label')}
            placeholder={t('messages.flag_reason_placeholder')}
            value={reason}
            onValueChange={setReason}
            minRows={3}
            variant="bordered"
            isRequired
          />
          <Select
            label={t('messages.severity_label')}
            selectedKeys={[severity]}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as FlagSeverity | undefined;
              if (val) setSeverity(val);
            }}
            variant="bordered"
          >
            {FLAG_SEVERITIES.map((level) => (
              <SelectItem key={level} id={level}>
                {t(`messages.severity_${level}`)}
              </SelectItem>
            ))}
          </Select>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={loading}>
            {t('messages.cancel')}
          </Button>
          <Button
            color="warning"
            onPress={submit}
            isLoading={loading}
            isDisabled={!reason.trim() || !messageId}
            startContent={!loading && <Flag size={14} aria-hidden="true" />}
          >
            {t('messages.flag_action')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default FlagMessageModal;
