// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VettingPolicyCard — the safeguarding contact policy card at the top of the
 * Vetting page: jurisdiction, required confirmation and purpose, the
 * coordinator and "no policy" notices, and the standing "do not upload
 * vetting documents" notice.
 *
 * The jurisdiction itself is chosen on the broker Configuration page
 * (Compliance & Safeguarding card, Oct 2026) — a tenant-wide setting only an
 * admin may change does not belong on a broker's work queue. An admin gets
 * a link there; everyone else just reads the policy. Until Oct 2026 the
 * dropdown and its own Save button lived here.
 *
 * Extracted from VettingPage in October 2026.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Info from 'lucide-react/icons/info';
import ShieldCheck from 'lucide-react/icons/shield-check';
import type { SafeguardingVettingPolicy, VettingPolicyResponse } from '@/admin/api/types';
import { Card, CardBody } from '@/components/ui';
import { useTenant } from '@/contexts';
import { BrokerSkeleton } from '../BrokerSkeleton';
import { JURISDICTION_SETTING_PATH } from '../configuration/configurationSchema';

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
}

export function VettingPolicyCard({
  policyLoading,
  policyError,
  policy,
  policyData,
  isCoordinator,
  canRecordDecision,
  canConfigurePolicy,
}: VettingPolicyCardProps) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();

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
              <>
                <div className="mt-2 grid gap-2 text-sm text-muted sm:grid-cols-3">
                  <p><span className="font-medium text-foreground">{t('vetting.policy_jurisdiction')}:</span> {policy.label}</p>
                  <p><span className="font-medium text-foreground">{t('vetting.policy_attestation')}:</span> {policy.attestation_label || t('vetting.scheme_unavailable')}</p>
                  <p><span className="font-medium text-foreground">{t('vetting.policy_purpose')}:</span> {t('vetting.purpose_safeguarded_contact')}</p>
                </div>
                {canConfigurePolicy && policyData && (
                  <Link
                    to={tenantPath(JURISDICTION_SETTING_PATH)}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {t('vetting.change_jurisdiction_link')}
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                )}
              </>
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

        <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
          <p className="text-sm font-semibold text-foreground">{t('vetting.privacy_title')}</p>
          <p className="mt-1 text-sm leading-6 text-muted">{t('vetting.privacy_body')}</p>
        </div>
      </CardBody>
    </Card>
  );
}

export default VettingPolicyCard;
