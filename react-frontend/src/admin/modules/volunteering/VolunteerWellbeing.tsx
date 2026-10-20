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

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useAuth } from '@/contexts';
import { isAdminTierUser } from '@/lib/access';
import { PageHeader } from '../../components/PageHeader';
import { WellbeingAlertsPanel, type WellbeingAlert } from './WellbeingAlertsPanel';
import { WellbeingAlertDrawer } from './WellbeingAlertDrawer';
import { WellbeingSettingsCard } from './WellbeingSettingsCard';

export function VolunteerWellbeing() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.wellbeing_page_title'));
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);

  const canManageSettings = isAdminTierUser(user);

  // A bell or email link lands on ?alert={id}: open that alert at once.
  useEffect(() => {
    const raw = searchParams.get('alert');
    const id = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isInteger(id) && id > 0) {
      setOpenId(id);
    }
  }, [searchParams]);

  const open = useCallback((alert: WellbeingAlert) => {
    const id = typeof alert.id === 'string' ? Number.parseInt(alert.id, 10) : alert.id;
    if (typeof id === 'number' && Number.isInteger(id)) {
      setOpenId(id);
    }
  }, []);

  const close = useCallback(() => {
    setOpenId(null);
    if (searchParams.has('alert')) {
      const next = new URLSearchParams(searchParams);
      next.delete('alert');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
