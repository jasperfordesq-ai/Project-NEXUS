// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Configuration — now only the reminder delivery log.
 *
 * This page held a Custom Fields tab (removed 17 Oct 2026, nothing used it),
 * the reminder settings (moved into the Module Configuration window on
 * 18 Oct 2026, beside every other volunteering setting) and the outbound
 * webhooks (moved to the platform Integrations page the same day). What is
 * left is the operational panel: what the reminder jobs have sent, and the
 * super-admin "run due reminders now" button. The page itself retires once
 * the volunteering Overview hosts that panel.
 */

import { usePageTitle } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { ReminderEmailsPanel } from './ReminderEmailsPanel';

export default function VolunteerConfig() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.config_title'));

  return (
    <div className="space-y-6">
      <PageHeader title={t('volunteering.config_title')} description={t('volunteering.config_desc')} />
      <ReminderEmailsPanel />
    </div>
  );
}
