// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VettingConfirmModal — record (or renew) a member's community safeguarding
 * confirmation: which controlled scheme(s) support it, the certified scope,
 * private broker notes, the review-due date and, where a scheme needs it, the
 * authority membership expiry. No certificate evidence is ever collected.
 *
 * Mount it fresh per member (the page keys it on the member) so the form
 * starts from that member's existing codes; it is never shown closed.
 * Extracted from VettingPage in October 2026; behaviour unchanged.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminVetting } from '@/admin/api/adminApi';
import type { VettingRecord } from '@/admin/api/types';
import { useToast } from '@/contexts';
import { resolveUserDisplayName } from '@/lib/helpers';
import {
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
} from '@/components/ui';

export interface VettingConfirmModalProps {
  item: VettingRecord;
  /** False while the jurisdiction has no usable contact policy. */
  canRecordDecision: boolean;
  onClose: () => void;
  /** Called after the server recorded the confirmation (the modal has closed). */
  onConfirmed: () => void;
}

/** The scheme codes to start from: the member's existing ones, else the only option. */
function initialCodes(item: VettingRecord): Set<string> {
  const available = item.policy.certification_options ?? [];
  const existing = item.certification_codes.filter((code) => available.some((option) => option.code === code));
  if (existing.length > 0) return new Set(existing);
  return new Set(available.length === 1 && available[0] ? [available[0].code] : []);
}

export function VettingConfirmModal({ item, canRecordDecision, onClose, onConfirmed }: VettingConfirmModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const name = resolveUserDisplayName(item);
  const options = item.policy.certification_options ?? [];

  const [acknowledged, setAcknowledged] = useState(false);
  const [certificationCodes, setCertificationCodes] = useState<Set<string>>(() => initialCodes(item));
  const [scopeSummary, setScopeSummary] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
  const [reviewDueAt, setReviewDueAt] = useState('');
  const [authorityExpiresAt, setAuthorityExpiresAt] = useState('');
  const [confirming, setConfirming] = useState(false);

  const authorityExpiryRequired = Array.from(certificationCodes).some((code) =>
    options.some((option) => option.code === code && option.authority_expiry_required),
  );
  const formValid = acknowledged
    && certificationCodes.size > 0
    && scopeSummary.trim().length > 0
    && reviewDueAt !== ''
    && (!authorityExpiryRequired || authorityExpiresAt !== '');

  const submit = async () => {
    if (!acknowledged || !canRecordDecision || certificationCodes.size === 0 || !scopeSummary.trim() || !reviewDueAt) return;
    setConfirming(true);
    try {
      const response = await adminVetting.confirm(item.user_id, {
        certification_codes: Array.from(certificationCodes),
        scope_summary: scopeSummary.trim(),
        ...(privateNotes.trim() ? { private_notes: privateNotes.trim() } : {}),
        review_due_at: reviewDueAt,
        ...(authorityExpiresAt ? { authority_expires_at: authorityExpiresAt } : {}),
      }, item.review_request_id);
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_confirm_failed'));
        return;
      }
      toast.success(t('vetting.toast_confirmed'));
      onClose();
      onConfirmed();
    } catch {
      toast.error(t('vetting.toast_confirm_failed'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <ModalContent>
        <ModalHeader>{t('vetting.confirm_title')}</ModalHeader>
        <ModalBody className="space-y-4">
          <p>{t('vetting.confirm_body', { name })}</p>
          <Select
            label={t('vetting.certification_codes_label')}
            description={t('vetting.certification_codes_help')}
            selectionMode="multiple"
            selectedKeys={certificationCodes}
            onSelectionChange={(keys) => setCertificationCodes(keys === 'all'
              ? new Set(options.map((option) => option.code))
              : new Set(Array.from(keys).map(String)))}
            isRequired
          >
            {options.map((option) => (
              <SelectItem key={option.code} id={option.code} textValue={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </Select>
          <Textarea
            label={t('vetting.scope_summary_label')}
            description={t('vetting.scope_summary_help')}
            value={scopeSummary}
            onValueChange={setScopeSummary}
            maxLength={500}
            minRows={2}
            maxRows={5}
            isRequired
          />
          <Textarea
            label={t('vetting.private_notes_label')}
            description={t('vetting.private_notes_help')}
            value={privateNotes}
            onValueChange={setPrivateNotes}
            maxLength={2000}
            minRows={3}
            maxRows={8}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="date"
              label={t('vetting.review_due_label')}
              description={t('vetting.review_due_help')}
              value={reviewDueAt}
              onValueChange={setReviewDueAt}
              isRequired
            />
            <Input
              type="date"
              label={t('vetting.authority_expiry_label')}
              description={authorityExpiryRequired
                ? t('vetting.authority_expiry_required_help')
                : t('vetting.authority_expiry_help')}
              value={authorityExpiresAt}
              onValueChange={setAuthorityExpiresAt}
              isRequired={authorityExpiryRequired}
            />
          </div>
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-sm text-muted">
            {t('vetting.privacy_body')}
          </div>
          <Checkbox isSelected={acknowledged} onChange={setAcknowledged}>
            {t('vetting.confirm_acknowledgement', { name })}
          </Checkbox>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>{t('vetting.cancel')}</Button>
          <Button isPending={confirming} isDisabled={!formValid} onPress={submit}>
            {t('vetting.confirm_button')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default VettingConfirmModal;
