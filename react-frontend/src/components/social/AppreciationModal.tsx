// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AppreciationModal — SOC14 "Say thanks" modal.
 *
 * HeroUI Modal with: message Textarea (500 char) and [Send]. There is no
 * public/private choice: a note is private until the person who receives it
 * chooses to show it on their profile (owner decision, 12 Nov 2026), and the
 * server ignores any `is_public` a client sends.
 */

import { useState, useCallback } from 'react';

import MessageCircleHeart from 'lucide-react/icons/message-circle-heart';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { Button, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';

interface AppreciationModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiverId: number;
  receiverName?: string;
  contextType?: 'vol_log' | 'listing_completion' | 'general' | 'event_help';
  contextId?: number;
  onSent?: () => void;
}

const MAX_LEN = 500;

export function AppreciationModal({
  isOpen,
  onClose,
  receiverId,
  receiverName,
  contextType = 'general',
  contextId,
  onSent,
}: AppreciationModalProps) {
  const { t } = useTranslation('common');
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleClose = useCallback(() => {
    if (submitting) return;
    setMessage('');
    onClose();
  }, [submitting, onClose]);

  const handleSend = useCallback(async () => {
    const text = message.trim();
    if (!text) return;
    if (text.length > MAX_LEN) return;
    setSubmitting(true);
    try {
      const res = await api.post('/v2/appreciations', {
        receiver_id: receiverId,
        message: text,
        context_type: contextType,
        context_id: contextId,
      });
      if (res.success) {
        toast.success(t('appreciations.sent_success'));
        onSent?.();
        setMessage('');
        onClose();
      } else {
        const failure = res as unknown as { error?: string; code?: string };
        const reason = `${failure.code ?? ''} ${failure.error ?? ''}`.toLowerCase();
        if (reason.includes('rate_limit')) {
          toast.error(t('appreciations.rate_limited'));
        } else if (reason.includes('receiver_not_found') || reason.includes('safeguarding') || reason.includes('blocked')) {
          toast.error(t('appreciations.thanks_cannot_send'));
        } else {
          toast.error(t('appreciations.send_failed'));
        }
      }
    } catch (err) {
      logError('AppreciationModal: send failed', err);
      toast.error(t('appreciations.send_failed'));
    } finally {
      setSubmitting(false);
    }
  }, [message, receiverId, contextType, contextId, onSent, onClose, toast, t]);

  const remaining = MAX_LEN - message.length;
  const titleStr = receiverName
    ? t('appreciations.title_to', { name: receiverName })
    : t('appreciations.title');

  return (
    <Modal isOpen={isOpen} onClose={handleClose} placement="center" size="md">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <MessageCircleHeart className="w-5 h-5 text-[var(--color-primary)]" />
          {titleStr}
        </ModalHeader>
        <ModalBody>
          <Textarea
            label={t('appreciations.message_label')}
            placeholder={t('appreciations.message_placeholder')}
            value={message}
            onValueChange={setMessage}
            maxLength={MAX_LEN}
            minRows={4}
            variant="bordered"
            description={t('appreciations.chars_remaining', { n: remaining })}
          />
          <p data-testid="thanks-privacy-hint" className="pt-2 text-sm text-[var(--text-muted)]">
            {receiverName
              ? t('appreciations.thanks_privacy_hint_named', { name: receiverName })
              : t('appreciations.thanks_privacy_hint')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={handleClose} isDisabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            color="primary"
            onPress={handleSend}
            isLoading={submitting}
            isDisabled={!message.trim() || message.length > MAX_LEN}
          >
            {t('appreciations.send')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default AppreciationModal;
