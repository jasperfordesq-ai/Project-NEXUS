// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTenant } from '@/contexts';
import { useExternalFederationStatus } from './useExternalFederationStatus';

/**
 * Panel-wide notice shown while external partner federation is switched off.
 *
 * Rendered once from PartnersLayout so it appears above every page in this
 * panel. Without it the panel presents external partners, protocol config,
 * API keys and webhooks as fully live while the platform is refusing all
 * external traffic — the operator's mental model and reality diverge silently.
 *
 * The "internal is unaffected" sentence is load-bearing: this panel also holds
 * same-install partnerships, and an operator who reads only "federation
 * disabled" may conclude those are broken too and switch the gate back on.
 */
export function ExternalFederationBanner() {
  const { t } = useTranslation('partners');
  const { tenantPath } = useTenant();
  const status = useExternalFederationStatus();

  // Render nothing until known, and nothing when external federation is live —
  // a banner that flashes on every page load would train operators to ignore it.
  if (!status || status.effective) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-danger bg-danger-50 p-4 dark:bg-danger-950"
    >
      <AlertTriangle aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-danger">
          {status.emergencyLockdown
            ? t('external_federation.banner_title_lockdown')
            : t('external_federation.banner_title')}
        </p>
        <p className="mt-1 text-sm text-danger-700 dark:text-danger-300">
          {t('external_federation.banner_body')}
        </p>
        {status.reason ? (
          <p className="mt-1 text-sm italic text-danger-700 dark:text-danger-300">{status.reason}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted">{t('external_federation.banner_internal_unaffected')}</p>
        <Link
          to={tenantPath('/super-admin/federation')}
          className="mt-2 inline-block text-sm font-medium text-danger underline"
        >
          {t('external_federation.banner_manage_link')}
        </Link>
      </div>
    </div>
  );
}

export default ExternalFederationBanner;
