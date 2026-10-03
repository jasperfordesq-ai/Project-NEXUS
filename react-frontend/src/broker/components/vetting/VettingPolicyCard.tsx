// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VettingPolicyCard — the safeguarding contact policy card at the top of the
 * Vetting page: jurisdiction, required confirmation and purpose, the
 * coordinator and "no policy" notices, the jurisdiction control (admins only;
 * everyone else reads the value in full-contrast text marked Admin only) and
 * the standing "do not upload vetting documents" notice.
 *
 * Extracted from VettingPage in October 2026; behaviour unchanged.
 */

import { useTranslation } from 'react-i18next';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Info from 'lucide-react/icons/info';
import ShieldCheck from 'lucide-react/icons/shield-check';
import type { SafeguardingVettingPolicy, VettingPolicyResponse } from '@/admin/api/types';
import { Button, Card, CardBody, Select, SelectItem } from '@/components/ui';
import { AdminOnlyBadge } from '../AdminOnlyBadge';
import { BrokerSkeleton } from '../BrokerSkeleton';

export interface VettingPolicyCardProps {
  policyLoading: boolean;
  policyError: boolean;
  /** The effective policy (from the policy endpoint, or the stats fallback). */
  policy: SafeguardingVettingPolicy | null;
  policyData: VettingPolicyResponse | null;
  isCoordinator: boolean;
  /** False when the jurisdiction is set but has no supported contact policy. */
  canRecordDecision: boolean;
  /** Only an admin may choose the jurisdiction (owner decision, 3 Oct 2026). */
  canConfigurePolicy: boolean;
  selectedJurisdiction: string;
  onJurisdictionChange: (code: string) => void;
  savingPolicy: boolean;
  onSavePolicy: () => void;
}

export function VettingPolicyCard({
  policyLoading,
  policyError,
  policy,
  policyData,
  isCoordinator,
  canRecordDecision,
  canConfigurePolicy,
  selectedJurisdiction,
  onJurisdictionChange,
  savingPolicy,
  onSavePolicy,
}: VettingPolicyCardProps) {
  const { t } = useTranslation('broker');

  return (
    <Card className="rounded-2xl border border-divider/70 bg-surface">
      <CardBody className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-success" size={20} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-foreground">{t('vetting.policy_title')}</h2>
            {policyLoading ? (
              <BrokerSkeleton variant="cards" count={1} className="mt-2" />
            ) : policyError || !policy ? (
              <p className="mt-1 text-sm text-danger">{t('vetting.policy_load_error')}</p>
            ) : (
              <div className="mt-2 grid gap-2 text-sm text-muted sm:grid-cols-3">
                <p><span className="font-medium text-foreground">{t('vetting.policy_jurisdiction')}:</span> {policy.label}</p>
                <p><span className="font-medium text-foreground">{t('vetting.policy_attestation')}:</span> {policy.attestation_label || t('vetting.scheme_unavailable')}</p>
                <p><span className="font-medium text-foreground">{t('vetting.policy_purpose')}:</span> {t('vetting.purpose_safeguarded_contact')}</p>
              </div>
            )}
          </div>
        </div>

        {isCoordinator && (
          <div className="flex items-start gap-2 rounded-xl border border-divider/70 bg-surface-secondary p-3 text-sm text-foreground">
            <Info size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <p>{t('vetting.coordinator_view_only')}</p>
          </div>
        )}

        {/* "Not set" is announced by the panel-wide JurisdictionNotice above
            every broker page; this covers a jurisdiction that is set but has
            no supported contact-vetting policy. */}
        {!policyLoading && policy && policy.configured && !canRecordDecision && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-surface p-3 text-sm text-foreground">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <p>{t('vetting.policy_not_available')}</p>
          </div>
        )}

        {policyData && (
          <div className="border-t border-divider/70 pt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span id="jurisdiction-label" className="text-sm font-medium text-foreground">
                {t('vetting.jurisdiction_label')}
              </span>
              {!canConfigurePolicy && <AdminOnlyBadge />}
            </div>
            {canConfigurePolicy ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Select
                  className="sm:max-w-md"
                  aria-labelledby="jurisdiction-label"
                  placeholder={t('vetting.jurisdiction_placeholder')}
                  selectedKeys={selectedJurisdiction ? new Set([selectedJurisdiction]) : new Set()}
                  onSelectionChange={(keys) => onJurisdictionChange(String(Array.from(keys)[0] ?? ''))}
                >
                  {policyData.jurisdictions.map((jurisdiction) => (
                    <SelectItem key={jurisdiction.code} id={jurisdiction.code} textValue={jurisdiction.label}>
                      {jurisdiction.label}
                    </SelectItem>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  isPending={savingPolicy}
                  isDisabled={!selectedJurisdiction || selectedJurisdiction === policyData.policy.jurisdiction}
                  onPress={onSavePolicy}
                >
                  {t('vetting.save_jurisdiction')}
                </Button>
              </div>
            ) : (
              <>
                {/* Plain full-contrast text, not a disabled dropdown: a disabled
                    control is drawn faded, and the broker needs to read the
                    current value. */}
                <div
                  role="textbox"
                  aria-readonly="true"
                  aria-labelledby="jurisdiction-label"
                  className="rounded-xl border border-divider bg-surface-secondary px-3 py-2 text-sm font-medium text-foreground sm:max-w-md"
                >
                  {policyData.policy.configured ? policyData.policy.label : t('vetting.jurisdiction_placeholder')}
                </div>
                <p className="mt-2 text-sm text-foreground">{t('vetting.jurisdiction_admin_only_hint')}</p>
              </>
            )}
          </div>
        )}

        <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
          <p className="text-sm font-semibold text-foreground">{t('vetting.privacy_title')}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{t('vetting.privacy_body')}</p>
        </div>
      </CardBody>
    </Card>
  );
}

export default VettingPolicyCard;
