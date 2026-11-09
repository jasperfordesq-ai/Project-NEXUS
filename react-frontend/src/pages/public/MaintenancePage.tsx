// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Maintenance Mode Page
 * Shown to non-admin users when the platform is under maintenance.
 */


import Wrench from 'lucide-react/icons/wrench';
import LogIn from 'lucide-react/icons/log-in';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';

export function MaintenancePage() {
  const { t } = useTranslation('public');
  usePageTitle(t('maintenance.title'));
  const { tenant, tenantPath } = useTenant();
  const tenantName = tenant?.name || 'Project NEXUS';
  const adminPath = tenantPath('/admin');

  return (
    <div className="min-h-screen bg-linear-to-br from-accent-soft to-surface flex items-center justify-center p-4">
      <PageMeta title={t('page_meta.maintenance.title')} noIndex />
      {/* Tell prerender services (Prerender.io, Google) this is temporary.
          503 = "come back later, don't cache or de-index this page." */}
      <Helmet>
        <meta name="prerender-status-code" content="503" />
        <meta name="prerender-header" content="Retry-After: 600" />
      </Helmet>
      <Card className="max-w-lg w-full">
        <Card.Content className="text-center py-12 px-6 gap-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-linear-to-br from-accent-strong to-accent-soft rounded-full flex items-center justify-center">
              <Wrench size={40} className="text-white" aria-hidden="true" />
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-bold text-foreground">
              {t('maintenance.title')}
            </h1>

            <p className="text-lg text-muted">
              <strong>{tenantName}</strong> {t('maintenance.description')}
            </p>

            <p className="text-muted">
              {t('maintenance.apology')}
            </p>
          </div>

          <div className="rounded-lg bg-accent-soft dark:bg-accent-soft border border-accent dark:border-accent px-4 py-3 text-left">
            <div className="flex gap-3 items-start">
              <Info size={18} className="text-accent mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-sm text-muted">
                {t('maintenance.deploy_notice')}
              </p>
            </div>
          </div>

          <div className="text-sm text-muted mt-4">
            {t('maintenance.thanks')}
          </div>

          <div className="pt-4 border-t border-divider">
            <Button
              as={Link}
              to={adminPath}
              startContent={<LogIn size={18} aria-hidden="true" />}
              size="sm"
            >
              {t('maintenance.admin_login')}
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

export default MaintenancePage;
