// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Safeguarding Page
 *
 * The broker panel intentionally reuses the full admin safeguarding dashboard
 * so flagged messages, guardian assignments, member preferences, and future
 * safeguarding fixes remain in parity across both admin surfaces.
 *
 * To make the shared dashboard feel native here, it is framed in the broker
 * BrokerPageShell (danger domain, shield icon, broker-namespace copy). The
 * admin component renders its own PageHeader card, which would duplicate the
 * shell's title — the admin module is NOT forked or edited; instead the
 * AdminEmbed provider tells PageHeader to render only its action buttons
 * (Refresh / New assignment) as a slim toolbar row.
 *
 * The embedded dashboard keeps owning the document title (usePageTitle) and
 * all data fetching/permissions exactly as before.
 */

import { useTranslation } from 'react-i18next';
import Shield from 'lucide-react/icons/shield';
import { useTenant } from '@/contexts';
import { SafeguardingDashboard } from '@/admin/modules/safeguarding/SafeguardingDashboard';
import { VolunteerSafeguarding } from '@/admin/modules/volunteering/VolunteerSafeguarding';
import { BrokerPageShell } from '../components';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';

export default function SafeguardingPage() {
  const { t } = useTranslation('broker');
  const { hasFeature } = useTenant();

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.title')}
      description={t('safeguarding.description')}
      icon={Shield}
      color="danger"
    >
      <AdminEmbed>
        <SafeguardingDashboard routeBase="/broker/safeguarding" />
      </AdminEmbed>
      {/* F-536: volunteering incidents alert brokers and coordinators and link
          here, so they are handled here. DLP assignment stays admin-only. */}
      {hasFeature('volunteering') && (
        <section aria-labelledby="broker-volunteering-incidents" className="mt-8 space-y-2">
          <h2 id="broker-volunteering-incidents" className="text-lg font-semibold">
            {t('safeguarding.volunteering_incidents_title')}
          </h2>
          <p className="text-sm text-muted">{t('safeguarding.volunteering_incidents_description')}</p>
          <AdminEmbed>
            <VolunteerSafeguarding canAssignDlp={false} />
          </AdminEmbed>
        </section>
      )}
    </BrokerPageShell>
  );
}
