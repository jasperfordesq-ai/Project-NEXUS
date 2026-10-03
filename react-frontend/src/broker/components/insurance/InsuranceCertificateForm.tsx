// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The certificate fields. Until October 2026 the create and the edit modal
 * each carried their own copy of these (~150 lines apiece); this is the one
 * copy. Create mode shows the shared member picker; edit mode shows the
 * certificate's member read-only, because a certificate never changes hands.
 */

import { useTranslation } from 'react-i18next';
import { Avatar, DatePicker, Input, Select, SelectItem, Textarea } from '@/components/ui';
import { MemberSearchPicker } from '@/admin/components';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import type { InsuranceCertificate } from '@/admin/api/types';
import {
  INSURANCE_TYPE_KEYS,
  INSURANCE_TYPE_LABEL_KEYS,
  fromDateValue,
  toDateValue,
  type InsuranceFormValues,
} from './insuranceShared';

/** The member a certificate already belongs to (edit mode). */
export type InsuranceFormMember = Pick<InsuranceCertificate, 'first_name' | 'last_name' | 'email' | 'avatar_url'>;

interface InsuranceCertificateFormProps {
  values: InsuranceFormValues;
  onChange: (patch: Partial<InsuranceFormValues>) => void;
  /** Tenant currency symbol shown before the coverage amount. */
  symbol: string;
  /** When set the member is fixed and shown read-only; otherwise the picker renders. */
  member?: InsuranceFormMember | null;
  isDisabled?: boolean;
}

export function InsuranceCertificateForm({
  values,
  onChange,
  symbol,
  member = null,
  isDisabled = false,
}: InsuranceCertificateFormProps) {
  const { t } = useTranslation('broker');

  return (
    <>
      {member ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3">
          <Avatar
            src={resolveAvatarUrl(member.avatar_url) || undefined}
            name={resolveUserDisplayName(member)}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{member.first_name} {member.last_name}</p>
            <p className="truncate text-xs text-muted">{member.email}</p>
          </div>
        </div>
      ) : (
        <MemberSearchPicker
          value={values.user_id}
          onValueChange={(user_id) => onChange({ user_id })}
          label={t('insurance.search_member_label')}
          placeholder={t('insurance.search_member_placeholder')}
          noResultsText={t('insurance.no_members_found')}
          clearText={t('insurance.change')}
          isRequired
        />
      )}

      <Select
        label={t('insurance.field_insurance_type')}
        selectedKeys={[values.insurance_type]}
        onSelectionChange={(keys) => {
          const val = Array.from(keys)[0] as InsuranceCertificate['insurance_type'] | undefined;
          if (val) onChange({ insurance_type: val });
        }}
        variant="secondary"
        isRequired
        isDisabled={isDisabled}
      >
        {INSURANCE_TYPE_KEYS.map((key) => (
          <SelectItem key={key} id={key}>{t(INSURANCE_TYPE_LABEL_KEYS[key])}</SelectItem>
        ))}
      </Select>

      <Input
        label={t('insurance.field_provider_name')}
        placeholder={t('insurance.field_provider_name_placeholder')}
        value={values.provider_name}
        onValueChange={(provider_name) => onChange({ provider_name })}
        variant="secondary"
        isDisabled={isDisabled}
      />
      <Input
        label={t('insurance.field_policy_number')}
        placeholder={t('insurance.field_policy_number_placeholder')}
        value={values.policy_number}
        onValueChange={(policy_number) => onChange({ policy_number })}
        variant="secondary"
        isDisabled={isDisabled}
      />
      {/* The tenant's own currency — hard-coding a symbol was wrong for
          every community outside the eurozone. */}
      <Input
        label={t('insurance.field_coverage_amount')}
        placeholder={t('insurance.field_coverage_amount_placeholder')}
        value={values.coverage_amount}
        onValueChange={(coverage_amount) => onChange({ coverage_amount })}
        variant="secondary"
        type="number"
        startContent={<span className="text-sm text-muted">{symbol}</span>}
        isDisabled={isDisabled}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DatePicker
          label={t('insurance.field_start_date')}
          value={toDateValue(values.start_date)}
          onChange={(value) => onChange({ start_date: fromDateValue(value) })}
          variant="secondary"
          fullWidth
          isDisabled={isDisabled}
        />
        <DatePicker
          label={t('insurance.field_expiry_date')}
          value={toDateValue(values.expiry_date)}
          onChange={(value) => onChange({ expiry_date: fromDateValue(value) })}
          variant="secondary"
          fullWidth
          isDisabled={isDisabled}
        />
      </div>
      <Textarea
        label={t('insurance.field_notes')}
        placeholder={t('insurance.field_notes_placeholder')}
        value={values.notes}
        onValueChange={(notes) => onChange({ notes })}
        variant="secondary"
        minRows={3}
        isDisabled={isDisabled}
      />
    </>
  );
}

export default InsuranceCertificateForm;
