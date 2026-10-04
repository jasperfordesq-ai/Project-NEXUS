// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The safeguarding jurisdiction as a row of the "Compliance & Safeguarding"
 * card on the broker Configuration page (moved here from the Vetting page,
 * Oct 2026: a tenant-wide setting only an admin may change belongs with the
 * other admin-only settings, not on a broker's work queue).
 *
 * It is not part of the broker configuration object: the page saves it
 * through the vetting policy endpoint, which also rewrites the country
 * preset for members' safeguarding preferences. An admin gets the dropdown;
 * everyone else reads the value in full-contrast text marked Admin only.
 * Under the control, the confirmation the chosen jurisdiction requires.
 */

import { useTranslation } from 'react-i18next';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import type { VettingPolicyResponse } from '@/admin/api/types';
import { Select, SelectItem, Skeleton } from '@/components/ui';
import { SettingRow } from './ConfigurationSection';

export interface JurisdictionSettingRowProps {
  policyData: VettingPolicyResponse | null;
  loading: boolean;
  error: boolean;
  /** Only an admin may choose the jurisdiction (owner decision, 3 Oct 2026). */
  canEdit: boolean;
  /** The jurisdiction code being edited (the saved one until changed). */
  value: string;
  onChange: (code: string) => void;
}

export function JurisdictionSettingRow({ policyData, loading, error, canEdit, value, onChange }: JurisdictionSettingRowProps) {
  const { t } = useTranslation('broker');

  const selected = policyData?.jurisdictions.find((option) => option.code === value) ?? null;
  const currentLabel = selected?.label
    ?? (policyData?.policy.configured ? policyData.policy.label : t('vetting.jurisdiction_placeholder'));
  // A jurisdiction can be set yet have no supported contact-vetting policy.
  const policyUnavailable = selected !== null && !selected.contact_policy_available;

  const renderControl = () => {
    if (loading) {
      return <Skeleton className="h-9 w-56 rounded-xl" />;
    }
    if (error || !policyData) {
      return <p className="text-sm text-danger">{t('configuration.jurisdiction_load_error')}</p>;
    }
    if (canEdit) {
      return (
        <Select
          className="w-56 sm:w-72"
          size="sm"
          aria-label={t('vetting.jurisdiction_label')}
          placeholder={t('vetting.jurisdiction_placeholder')}
          selectedKeys={value ? new Set([value]) : new Set()}
          onSelectionChange={(keys) => onChange(String(Array.from(keys)[0] ?? ''))}
        >
          {policyData.jurisdictions.map((jurisdiction) => (
            <SelectItem key={jurisdiction.code} id={jurisdiction.code} textValue={jurisdiction.label}>
              {jurisdiction.label}
            </SelectItem>
          ))}
        </Select>
      );
    }
    // Plain full-contrast text, not a disabled dropdown: a disabled control is
    // drawn faded, and the broker needs to read the current value.
    return (
      <div
        role="textbox"
        aria-readonly="true"
        aria-label={t('vetting.jurisdiction_label')}
        className="w-56 rounded-xl border border-divider bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground sm:w-72"
      >
        {currentLabel}
      </div>
    );
  };

  return (
    <SettingRow
      label={t('vetting.jurisdiction_label')}
      help={t('configuration.field_safeguarding_jurisdiction_help')}
      locked={!canEdit}
    >
      <div className="flex flex-col items-end gap-2">
        {renderControl()}
        {!loading && !error && policyData && (
          <p className="max-w-72 text-right text-xs leading-5 text-muted">
            {t('vetting.policy_attestation')}: {selected?.attestation_label ?? policyData.policy.attestation_label ?? t('vetting.scheme_unavailable')}
          </p>
        )}
        {policyUnavailable && (
          <p className="flex max-w-72 items-start gap-1.5 text-right text-xs leading-5 text-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <span>{t('vetting.policy_not_available')}</span>
          </p>
        )}
      </div>
    </SettingRow>
  );
}

export default JurisdictionSettingRow;
