// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Read-only view of one certificate: who it covers, the policy facts in the
 * tenant's currency, who verified it and when, the uploaded file and notes.
 */

import { useTranslation } from 'react-i18next';
import ExternalLink from 'lucide-react/icons/external-link';
import FileCheck from 'lucide-react/icons/file-check';
import FileText from 'lucide-react/icons/file-text';
import { Avatar, Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui';
import { resolveAssetUrl, resolveAvatarUrl, resolveUserDisplayName, resolveUserDisplayNameFromPrefix } from '@/lib/helpers';
import { formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import type { InsuranceCertificate } from '@/admin/api/types';
import { BrokerStatusChip } from '../BrokerStatusChip';
import { useInsuranceFormatting } from './insuranceShared';

interface InsuranceCertificateViewModalProps {
  item: InsuranceCertificate | null;
  onClose: () => void;
}

export function InsuranceCertificateViewModal({ item, onClose }: InsuranceCertificateViewModalProps) {
  const { t } = useTranslation('broker');
  const { formatCoverage, formatInsuranceType } = useInsuranceFormatting();

  if (!item) return null;

  return (
    <Modal isOpen onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FileCheck size={20} className="text-accent" aria-hidden="true" />
          {t('insurance.modal_view_title')}
        </ModalHeader>
        <ModalBody>
          <div className="mb-4 flex items-center gap-3">
            <Avatar
              src={resolveAvatarUrl(item.avatar_url) || undefined}
              name={resolveUserDisplayName(item)}
              size="lg"
            />
            <div>
              <p className="text-lg font-semibold tracking-tight">{item.first_name} {item.last_name}</p>
              <p className="text-sm text-muted">{item.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-muted">{t('insurance.label_type')}</p>
              <p className="font-medium">{formatInsuranceType(item.insurance_type)}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_status')}</p>
              <BrokerStatusChip status={item.status} />
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_provider')}</p>
              <p className="font-medium">{item.provider_name || '—'}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_policy_number')}</p>
              <p className="font-mono font-medium tabular-nums">{item.policy_number || '—'}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_coverage_amount')}</p>
              <p className="font-medium tabular-nums">{item.coverage_amount ? formatCoverage(item.coverage_amount) : '—'}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_start_date')}</p>
              <p className="font-medium tabular-nums">{item.start_date ? formatServerDate(item.start_date) : '—'}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_expiry_date')}</p>
              <p className="font-medium tabular-nums">{item.expiry_date ? formatServerDate(item.expiry_date) : '—'}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_verified_by')}</p>
              <p className="font-medium">
                {item.verifier_first_name
                  ? resolveUserDisplayNameFromPrefix(item as unknown as Record<string, unknown>, 'verifier_')
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_verified_at')}</p>
              <p className="font-medium tabular-nums">{item.verified_at ? formatServerDateTime(item.verified_at) : '—'}</p>
            </div>
            <div>
              <p className="text-muted">{t('insurance.label_created')}</p>
              <p className="font-medium tabular-nums">{formatServerDateTime(item.created_at)}</p>
            </div>
          </div>
          {item.certificate_file_path && (
            <div className="mt-4">
              <p className="mb-1 text-sm text-muted">{t('insurance.label_certificate_file')}</p>
              <a
                href={resolveAssetUrl(item.certificate_file_path)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent hover:underline dark:bg-accent-soft"
              >
                <FileText size={16} aria-hidden="true" />
                {t('insurance.view_certificate_file')}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          )}
          {item.notes && (
            <div className="mt-4">
              <p className="mb-1 text-sm text-muted">{t('insurance.label_notes')}</p>
              <p className="rounded-lg bg-surface-secondary p-3 text-sm">{item.notes}</p>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>
            {t('insurance.close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default InsuranceCertificateViewModal;
