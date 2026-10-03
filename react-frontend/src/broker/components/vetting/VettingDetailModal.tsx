// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VettingDetailModal — the encrypted operational scope and private notes
 * behind a member's confirmation, loaded on open for authorised staff.
 * Mount it fresh per member; it is never shown closed.
 * Extracted from VettingPage in October 2026; behaviour unchanged.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminVetting } from '@/admin/api/adminApi';
import type { SafeguardingVettingPolicy, VettingAttestation, VettingRecord } from '@/admin/api/types';
import { useToast } from '@/contexts';
import { resolveUserDisplayName } from '@/lib/helpers';
import { formatServerDate } from '@/lib/serverTime';
import { Button, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui';
import { BrokerSkeleton } from '../BrokerSkeleton';

export interface VettingDetailModalProps {
  item: VettingRecord;
  /** Human label for a scheme code under the record's own policy. */
  certificationLabel: (code: string, policy?: SafeguardingVettingPolicy) => string;
  onClose: () => void;
}

export function VettingDetailModal({ item, certificationLabel, onClose }: VettingDetailModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [record, setRecord] = useState<VettingAttestation | null>(null);
  const [loading, setLoading] = useState(true);
  const attestationId = item.attestation_id;

  useEffect(() => {
    if (!attestationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await adminVetting.show(attestationId);
        if (cancelled) return;
        if (response.success && response.data) setRecord(response.data);
        else toast.error(response.error || t('vetting.toast_details_failed'));
      } catch {
        if (!cancelled) toast.error(t('vetting.toast_details_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Load once per mounted record; toast/t identity changes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attestationId]);

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <ModalContent>
        <ModalHeader>{t('vetting.details_title', { name: resolveUserDisplayName(item) })}</ModalHeader>
        <ModalBody className="space-y-4">
          {loading ? (
            <BrokerSkeleton variant="detail" count={3} />
          ) : record ? (
            <>
              <div>
                <p className="text-sm font-medium text-foreground">{t('vetting.certification_codes_label')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {record.certification_codes.map((code) => (
                    <Chip key={code} size="sm" variant="soft" color="accent">{certificationLabel(code, item.policy)}</Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{t('vetting.scope_summary_label')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{record.scope_summary || t('vetting.not_recorded')}</p>
              </div>
              <div className="rounded-xl border border-divider/70 bg-surface-secondary p-3">
                <p className="text-sm font-medium text-foreground">{t('vetting.private_notes_label')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{record.private_notes || t('vetting.no_private_notes')}</p>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-foreground">{t('vetting.review_due_label')}</dt>
                  <dd className="text-muted">{record.review_due_at ? formatServerDate(record.review_due_at) : t('vetting.not_recorded')}</dd>
                </div>
                <div>
                  <dt className="font-medium text-foreground">{t('vetting.authority_expiry_label')}</dt>
                  <dd className="text-muted">{record.authority_expires_at ? formatServerDate(record.authority_expires_at) : t('vetting.not_applicable')}</dd>
                </div>
              </dl>
            </>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>{t('vetting.close')}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default VettingDetailModal;
