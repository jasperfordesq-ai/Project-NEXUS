// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Info from 'lucide-react/icons/info';
import { useTenant } from '@/contexts';
import { useExternalFederationStatus } from './useExternalFederationStatus';
import { isOnPanelPath } from './panelPath';

/**
 * The pages that carry traffic to or from OTHER installations. Must list the
 * same pages the sidebar marks `externalGated`.
 */
const EXTERNAL_PAGES = [
  '/partner-timebanks/external-partners',
  '/partner-timebanks/credit-commons',
  '/partner-timebanks/inbound-api',
  '/partner-timebanks/api-keys',
  '/partner-timebanks/webhooks',
  '/partner-timebanks/api-docs',
];

/**
 * Notice shown while links to other installations are switched off.
 *
 * Two different situations, deliberately shown differently:
 *
 * 1. **External partner federation is off** (the normal state in production
 *    since 2026-07-27). A calm note, shown ONLY on the pages that concern
 *    other installations. Until November 2026 it was a red alarm on every
 *    page of the panel, including Partnerships and Credit agreements — which
 *    are about communities on this same installation and are not affected. A
 *    permanent red banner on unaffected pages teaches operators to ignore red
 *    banners, and made working pages look broken.
 *
 *    The "partnerships on this platform are not affected" sentence is
 *    load-bearing: an operator who reads only "switched off" may conclude
 *    same-installation partnerships are broken too.
 *
 * 2. **Emergency lockdown** stops ALL partnering, same-installation included
 *    (FederationFeatureService::isOperationAllowed). That is shown in red on
 *    every page, and without the "not affected" sentence, which would be
 *    false.
 */
export function ExternalFederationBanner() {
  const { t } = useTranslation('partners');
  const { tenantPath } = useTenant();
  const { pathname } = useLocation();
  const status = useExternalFederationStatus();

  // Render nothing until known, and nothing when external federation is live —
  // a banner that flashes on every page load would train operators to ignore it.
  if (!status || status.effective) return null;

  const lockdown = status.emergencyLockdown;

  if (!lockdown) {
    const onExternalPage = EXTERNAL_PAGES.some((page) => isOnPanelPath(pathname, page, tenantPath));
    if (!onExternalPage) return null;
  }

  const Icon = lockdown ? AlertTriangle : Info;

  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-3 rounded-lg border p-4 ${
        lockdown ? 'border-danger bg-danger/10' : 'border-divider bg-surface-secondary'
      }`}
    >
      <Icon aria-hidden="true" size={20} className={`mt-0.5 shrink-0 ${lockdown ? 'text-danger' : 'text-muted'}`} />
      <div className="min-w-0 flex-1">
        <p className={`font-semibold ${lockdown ? 'text-danger' : 'text-foreground'}`}>
          {lockdown
            ? t('external_federation.banner_title_lockdown')
            : t('external_federation.banner_title')}
        </p>
        <p className={`mt-1 text-sm ${lockdown ? 'text-danger-soft-foreground' : 'text-muted'}`}>
          {t('external_federation.banner_body')}
        </p>
        {status.reason ? (
          <p className={`mt-1 text-sm italic ${lockdown ? 'text-danger-soft-foreground' : 'text-muted'}`}>{status.reason}</p>
        ) : null}
        {!lockdown && (
          <p className="mt-2 text-sm text-foreground">{t('external_federation.banner_internal_unaffected')}</p>
        )}
        <Link
          to={tenantPath('/super-admin/federation')}
          className={`mt-2 inline-block text-sm font-medium underline ${lockdown ? 'text-danger' : 'text-foreground'}`}
        >
          {t('external_federation.banner_manage_link')}
        </Link>
      </div>
    </div>
  );
}

export default ExternalFederationBanner;
