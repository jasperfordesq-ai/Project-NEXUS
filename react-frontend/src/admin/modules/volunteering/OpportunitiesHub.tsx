// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Opportunities & shifts — one sidebar entry for the opportunity list and
 * the two shift queues that used to be their own pages. Swap requests only
 * exist when the community has switched on "swaps need admin approval", and
 * group bookings only when the alpha Group sign-ups tab is on, so those tabs
 * appear only then (owner decision 2026-10-18: no always-empty pages).
 */

import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { VolunteeringHubTabs } from './VolunteeringHubTabs';

export default function OpportunitiesHub() {
  const { t } = useTranslation('admin_nav');
  const { volunteeringConfig } = useTenant();

  return (
    <VolunteeringHubTabs
      ariaLabel={t('volunteering_nav.opportunities')}
      tabs={[
        { key: 'opportunities', href: '/admin/volunteering/opportunities', label: t('volunteering_nav.opportunities') },
        {
          key: 'swaps',
          href: '/admin/volunteering/opportunities/swaps',
          label: t('volunteering_nav.tab_swaps'),
          visible: volunteeringConfig['volunteering.swap_requires_admin'] === true,
        },
        {
          key: 'group-bookings',
          href: '/admin/volunteering/opportunities/group-bookings',
          label: t('volunteering_nav.group_bookings'),
          visible: volunteeringConfig['volunteering.tab_group_signups'] === true,
        },
      ]}
    />
  );
}
