// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Create or edit an insurance certificate. One modal for both: `certificate`
 * null means create (member picker, POST), otherwise edit (member fixed,
 * PUT). Owns its form state and the save call; the page only learns that
 * something was saved so it can reload.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminInsurance } from '@/admin/api/adminApi';
import type { InsuranceCertificate } from '@/admin/api/types';
import { InsuranceCertificateForm } from './InsuranceCertificateForm';
import {
  EMPTY_INSURANCE_FORM,
  insuranceFormFromCertificate,
  useInsuranceFormatting,
  type InsuranceFormValues,
} from './insuranceShared';

interface InsuranceCertificateFormModalProps {
  isOpen: boolean;
  /** The certificate being edited, or null to create a new one. */
  certificate: InsuranceCertificate | null;
  onClose: () => void;
  /** Called after a successful create or update. */
  onSaved: () => void;
}

/** Only the fields the broker filled go in a create; blanks are omitted. */
export function buildCreatePayload(values: InsuranceFormValues): Partial<InsuranceCertificate> {
  const payload: Record<string, unknown> = {
    user_id: Number(values.user_id),
    insurance_type: values.insurance_type,
  };
  if (values.provider_name) payload.provider_name = values.provider_name;
  if (values.policy_number) payload.policy_number = values.policy_number;
  if (values.coverage_amount) payload.coverage_amount = Number(values.coverage_amount);
  if (values.start_date) payload.start_date = values.start_date;
  if (values.expiry_date) payload.expiry_date = values.expiry_date;
  if (values.notes) payload.notes = values.notes;
  return payload as Partial<InsuranceCertificate>;
}

/** An update sends every field, blanks as null, so a cleared field is cleared. */
export function buildUpdatePayload(values: InsuranceFormValues): Partial<InsuranceCertificate> {
  return {
    insurance_type: values.insurance_type,
    provider_name: values.provider_name || null,
    policy_number: values.policy_number || null,
    coverage_amount: values.coverage_amount ? Number(values.coverage_amount) : null,
    start_date: values.start_date || null,
    expiry_date: values.expiry_date || null,
    notes: values.notes || null,
  };
}

export function InsuranceCertificateFormModal({
  isOpen,
  certificate,
  onClose,
  onSaved,
}: InsuranceCertificateFormModalProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const { symbol } = useInsuranceFormatting();
  const [values, setValues] = useState<InsuranceFormValues>(EMPTY_INSURANCE_FORM);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the modal opens for a (different) record.
  useEffect(() => {
    if (!isOpen) return;
    setValues(certificate ? insuranceFormFromCertificate(certificate) : EMPTY_INSURANCE_FORM);
  }, [isOpen, certificate]);

  const isEdit = certificate !== null;

  const handleSave = async () => {
    if (!isEdit && !values.user_id) {
      toast.error(t('insurance.select_member_required'));
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const res = await adminInsurance.update(certificate.id, buildUpdatePayload(values));
        if (res?.success) {
          toast.success(t('insurance.update_success'));
          onSaved();
          onClose();
        } else {
          toast.error(res?.error || t('insurance.update_failed'));
        }
      } else {
        const res = await adminInsurance.create(buildCreatePayload(values));
        if (res?.success || res?.data) {
          toast.success(t('insurance.create_success'));
          onSaved();
          onClose();
        } else {
          toast.error(res?.error || t('insurance.create_failed'));
        }
      }
    } catch {
      toast.error(isEdit ? t('insurance.update_failed') : t('insurance.create_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          {isEdit
            ? <Pencil size={20} className="text-accent" aria-hidden="true" />
            : <Plus size={20} className="text-accent" aria-hidden="true" />}
          {isEdit ? t('insurance.modal_edit_title') : t('insurance.modal_create_title')}
        </ModalHeader>
        <ModalBody className="gap-4">
          <InsuranceCertificateForm
            values={values}
            onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
            symbol={symbol}
            member={certificate}
            isDisabled={saving}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
            {t('insurance.cancel')}
          </Button>
          <Button variant="primary" onPress={handleSave} isPending={saving}>
            {isEdit ? t('insurance.save_changes') : t('insurance.add_certificate')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default InsuranceCertificateFormModal;
