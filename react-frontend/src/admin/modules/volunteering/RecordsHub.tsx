// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Training & certificates — one sidebar entry for the three records a
 * volunteer holds: safeguarding training, qualifications and hours
 * certificates (2026-10-18). Each tab is the unchanged page, at its own
 * address under /admin/volunteering/records/.
 */

import { useTranslation } from 'react-i18next';
import { VolunteeringHubTabs } from './VolunteeringHubTabs';

export default function RecordsHub() {
  const { t } = useTranslation('admin_nav');

  return (
    <VolunteeringHubTabs
      ariaLabel={t('volunteering_nav.training_certificates')}
      tabs={[
        { key: 'training', href: '/admin/volunteering/records/training', label: t('volunteering_nav.training') },
        { key: 'qualifications', href: '/admin/volunteering/records/qualifications', label: t('volunteering_nav.qualifications') },
        { key: 'certificates', href: '/admin/volunteering/records/certificates', label: t('volunteering_nav.certificates') },
      ]}
    />
  );
}
