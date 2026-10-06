// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * UrgentRequestModal — an organiser asks volunteers to help with one shift
 * at short notice (an "emergency alert").
 *
 * The server had POST /v2/volunteering/emergency-alerts but no screen called
 * it until 6 Oct 2026, so the volunteers' Alerts tab could never fill.
 * Opened from a shift row in ShiftManager.
 *
 * Server contract: POST /v2/volunteering/emergency-alerts
 *   { shift_id, message, priority: normal|urgent|critical, required_skills?, expires_hours }
 *   → 201 { id, notified }
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Megaphone from 'lucide-react/icons/megaphone';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

const PRIORITIES = ['normal', 'urgent', 'critical'] as const;
const EXPIRY_CHOICES = [
  { hours: 6, key: 'urgent_expires_6h' },
  { hours: 12, key: 'urgent_expires_12h' },
  { hours: 24, key: 'urgent_expires_1d' },
  { hours: 48, key: 'urgent_expires_2d' },
  { hours: 72, key: 'urgent_expires_3d' },
] as const;

export interface UrgentRequestModalProps {
  /** The shift to ask about, or null when closed. */
  shiftId: number | null;
  /** e.g. "Sat 15 Mar 2099, 10:00 – 13:00" — shown under the title. */
  shiftLabel: string;
  onClose: () => void;
  /** Called after a request is sent, so the list of requests can refresh. */
  onSent: () => void;
}

export function UrgentRequestModal({ shiftId, shiftLabel, onClose, onSent }: UrgentRequestModalProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('urgent');
  const [skills, setSkills] = useState('');
  const [expiresHours, setExpiresHours] = useState('24');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const reset = () => {
    setMessage('');
    setPriority('urgent');
    setSkills('');
    setExpiresHours('24');
    setError(null);
  };
  const close = () => { reset(); onClose(); };

  const send = async () => {
    if (shiftId === null) return;
    if (!message.trim()) {
      setError(t('shift_manager.urgent_message_required'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        shift_id: shiftId,
        message: message.trim(),
        priority,
        expires_hours: Number(expiresHours),
      };
      if (skills.trim()) payload.required_skills = skills.trim();
      const res = await api.post<{ id: number; notified?: number }>('/v2/volunteering/emergency-alerts', payload);
      if (res.success) {
        const notified = res.data?.notified ?? 0;
        if (notified > 0) toast.success(t('shift_manager.urgent_sent', { count: notified }));
        else toast.warning(t('shift_manager.urgent_sent_none'));
        reset();
        onSent();
        onClose();
      } else {
        setError(res.errors?.[0]?.message || res.error || t('shift_manager.urgent_failed'));
      }
    } catch (err) {
      logError('Failed to send urgent shift request', err);
      setError(t('shift_manager.urgent_failed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={shiftId !== null} onClose={close} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-theme-primary">
            <Megaphone className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('shift_manager.urgent_title')}
          </span>
          <span className="text-sm font-normal text-theme-muted">{shiftLabel}</span>
        </ModalHeader>
        <ModalBody className="space-y-4" data-testid="urgent-request-form">
          <p className="text-sm text-theme-muted">{t('shift_manager.urgent_intro')}</p>
          <Textarea
            label={t('shift_manager.urgent_message_label')}
            placeholder={t('shift_manager.urgent_message_placeholder')}
            isRequired
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            data-testid="urgent-request-message"
          />
          <Select
            label={t('shift_manager.urgent_priority_label')}
            selectedKeys={new Set([priority])}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as (typeof PRIORITIES)[number] | undefined;
              if (value) setPriority(value);
            }}
          >
            {PRIORITIES.map((p) => (
              <SelectItem key={p} id={p}>{t(`shift_manager.urgent_priority_${p}`)}</SelectItem>
            ))}
          </Select>
          <Input
            label={t('shift_manager.urgent_skills_label')}
            description={t('shift_manager.urgent_skills_hint')}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
          />
          <Select
            label={t('shift_manager.urgent_expires_label')}
            selectedKeys={new Set([expiresHours])}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string | undefined;
              if (value) setExpiresHours(value);
            }}
          >
            {EXPIRY_CHOICES.map((c) => (
              <SelectItem key={String(c.hours)} id={String(c.hours)}>{t(`shift_manager.${c.key}`)}</SelectItem>
            ))}
          </Select>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={close} isDisabled={sending}>{t('shift_manager.cancel')}</Button>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            isLoading={sending}
            onPress={() => void send()}
            data-testid="urgent-request-send"
          >
            {t('shift_manager.urgent_send')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default UrgentRequestModal;
