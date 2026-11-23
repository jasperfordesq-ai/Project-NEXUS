// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BillingAutomationPage
 * "Automatic checks", a page of its own in the Platform team panel's Money
 * menu: /platform-team/billing/automatic-checks.
 *
 * The settings and the "What would happen today" list are BillingAutomationCard,
 * which sat at the top of Billing control until 23 Nov 2026. Billing control
 * keeps one line (BillingAutomationSummary) and a link here.
 *
 * Platform team only: the panel's route guard keeps everyone else out, and
 * every address the card calls starts with requireGodPlatformAdmin().
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { Button } from '@/components/ui';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageHeader } from '../../components/PageHeader';
import { BillingAutomationCard } from './BillingAutomationCard';

export function BillingAutomationPage() {
  const { t } = useTranslation('admin_billing');
  usePageTitle(t('automation.title'));
  const { tenantPath } = useTenant();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('automation.title')}
        description={t('automation.page_desc')}
        actions={
          <Button
            as={Link}
            to={tenantPath('/platform-team/billing')}
            size="sm"
            variant="tertiary"
            startContent={<ArrowLeft size={14} />}
          >
            {t('billing.control_title')}
          </Button>
        }
      />

      <BillingAutomationCard showTitle={false} />
    </div>
  );
}

export default BillingAutomationPage;
