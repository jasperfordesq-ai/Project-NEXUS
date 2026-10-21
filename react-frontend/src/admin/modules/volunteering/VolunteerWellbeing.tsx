// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin › Volunteering › Wellbeing — the page behind the sidebar badge, the
 * overview's attention row and every wellbeing bell and email (which link here
 * with ?alert={id}).
 *
 * The alert list and the alert drawer are open to brokers and coordinators as
 * well as admins (they are told about these alerts). The settings card — who is
 * told first, and the support box — is for community administrators only.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useAuth } from '@/contexts';
import { isAdminTierUser } from '@/lib/access';
import { PageHeader } from '../../components/PageHeader';
import { WellbeingAlertsPanel } from './WellbeingAlertsPanel';
import { WellbeingAlertDrawer } from './WellbeingAlertDrawer';
import { WellbeingSettingsCard } from './WellbeingSettingsCard';
import { useWellbeingAlertDeepLink } from './useWellbeingAlertDeepLink';

export function VolunteerWellbeing() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.wellbeing_page_title'));
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  // ?alert={id} from a bell or email opens that alert at once.
  const { openId, open, close } = useWellbeingAlertDeepLink();

  const canManageSettings = isAdminTierUser(user);

  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.wellbeing_page_title')}
        description={t('volunteering.wellbeing_page_desc')}
        actions={
          <Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={changed}>
            {t('volunteering.refresh')}
          </Button>
        }
      />

      <WellbeingAlertsPanel refreshKey={refreshKey} onOpen={open} />

      {canManageSettings && <WellbeingSettingsCard />}

      <WellbeingAlertDrawer alertId={openId} isOpen={openId !== null} onClose={close} onChanged={changed} />
    </div>
  );
}

export default VolunteerWellbeing;
