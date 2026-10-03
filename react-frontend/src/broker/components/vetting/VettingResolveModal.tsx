// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VettingResolveModal — close a member's review request without changing the
 * current certification decision. Only the outcomes that cannot change the
 * safeguarding gate are offered (no_change, duplicate_request,
 * member_contacted); "No change" is preselected when available. Mount it fresh
 * per request; it is never shown closed.
 * Extracted from VettingPage in October 2026; behaviour unchanged.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminVetting } from '@/admin/api/adminApi';
import type { VettingPolicyResponse, VettingRecord } from '@/admin/api/types';
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

export type ReviewResolutionCode = VettingPolicyResponse['review_resolution_codes'][number];

/** Outcomes that leave the safeguarding gate exactly as it is. */
export const SAFE_REVIEW_RESOLUTION_CODES: readonly ReviewResolutionCode[] = [
  'no_change',
  'duplicate_request',
  'member_contacted',
];

export interface VettingResolveModalProps {
  item: VettingRecord;
  /** Resolution codes the policy allows, already narrowed to the safe set. */
  resolutionCodes: ReviewResolutionCode[];
  onClose: () => void;
  /** Called after the server resolved the request (the modal has closed). */
  onResolved: () => void;
}

export function VettingResolveModal({ item, resolutionCodes, onClose, onResolved }: VettingResolveModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [code, setCode] = useState<ReviewResolutionCode | ''>(
    resolutionCodes.includes('no_change') ? 'no_change' : '',
  );
  const [resolving, setResolving] = useState(false);

  const submit = async () => {
    if (!item.review_request_id || !code) return;
    setResolving(true);
    try {
      const response = await adminVetting.resolveReview(item.review_request_id, code);
      if (!response.success) {
        toast.error(response.error || t('vetting.toast_resolve_failed'));
        return;
      }
      toast.success(t('vetting.toast_resolved'));
      onClose();
      onResolved();
    } catch {
      toast.error(t('vetting.toast_resolve_failed'));
    } finally {
      setResolving(false);
    }
  };

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <ModalContent>
        <ModalHeader>{t('vetting.resolve_title')}</ModalHeader>
        <ModalBody className="space-y-4">
          <p>{t('vetting.resolve_body', { name: resolveUserDisplayName(item) })}</p>
          <Select
            label={t('vetting.resolution_label')}
            selectedKeys={code ? new Set([code]) : new Set()}
            onSelectionChange={(keys) => {
              const value = String(Array.from(keys)[0] ?? '');
              setCode(
                SAFE_REVIEW_RESOLUTION_CODES.includes(value as ReviewResolutionCode)
                  ? value as ReviewResolutionCode
                  : '',
              );
            }}
          >
            {resolutionCodes.map((value) => (
              <SelectItem key={value} id={value}>{t(`vetting.resolution_${value}`)}</SelectItem>
            ))}
          </Select>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>{t('vetting.cancel')}</Button>
          <Button isPending={resolving} isDisabled={!code} onPress={submit}>
            {t('vetting.resolve_button')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default VettingResolveModal;
