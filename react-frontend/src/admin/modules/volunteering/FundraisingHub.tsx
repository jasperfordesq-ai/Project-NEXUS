// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Fundraising & donations — one sidebar entry for the campaigns page and the
 * donation refunds page, which work on the same donations (2026-10-18).
 */

import { useTranslation } from 'react-i18next';
import { VolunteeringHubTabs } from './VolunteeringHubTabs';

export default function FundraisingHub() {
  const { t } = useTranslation('admin_nav');

  return (
    <VolunteeringHubTabs
      ariaLabel={t('volunteering_nav.fundraising_donations')}
      tabs={[
        { key: 'campaigns', href: '/admin/volunteering/fundraising/campaigns', label: t('volunteering_nav.tab_campaigns') },
        { key: 'donations', href: '/admin/volunteering/fundraising/donations', label: t('volunteering_nav.tab_donations') },
      ]}
    />
  );
}
