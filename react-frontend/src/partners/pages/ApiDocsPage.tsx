// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Developer Guide
 * Thin wrapper around the admin ApiDocumentation module (reference docs
 * for the Federation API, aimed at partner developers).
 */

import { useTranslation } from 'react-i18next';
import BookOpen from 'lucide-react/icons/book-open';
import ApiDocumentation from '@/admin/modules/federation/ApiDocumentation';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function ApiDocsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.api_docs.title')}
      description={t('pages.api_docs.description')}
      icon={BookOpen}
      color="neutral"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <ApiDocumentation />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
