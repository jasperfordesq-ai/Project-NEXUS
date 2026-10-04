// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shown on every broker-panel page (BrokerLayout) and every admin-panel page
 * (AdminLayout) while the community has no safeguarding jurisdiction. Until one is chosen, brokers cannot record vetting decisions
 * and members who asked to be contacted only by vetted people cannot be
 * reached (the contact gate fails closed — docs/SAFEGUARDING-AND-CONSENT.md).
 * Only an admin can choose it (owner decision, 3 Oct 2026), so an admin gets
 * a button to the setting and everyone else is told who to ask.
 *
 * The setting is the first row of the Compliance & Safeguarding card on the
 * broker Configuration page (Oct 2026; it was on the Vetting page before).
 */

import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { Alert, Button } from '@/components/ui';
import { useTenant } from '@/contexts';
import { JURISDICTION_SETTING_PATH } from '@/broker/components/configuration/configurationSchema';

interface JurisdictionNoticeProps {
  /** The viewer is an admin and can set the jurisdiction. */
  canSet: boolean;
}

export function JurisdictionNotice({ canSet }: JurisdictionNoticeProps) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const settingPath = tenantPath(JURISDICTION_SETTING_PATH);
  // The button is noise on the page that holds the setting.
  const onConfigurationPage = pathname === tenantPath('/broker/configuration');

  return (
    <Alert
      // Appears after the dashboard read resolves, so announce it politely.
      role="status"
      color="warning"
      className="mb-4 rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface p-4 shadow-sm sm:p-5"
      classNames={{
        title: 'text-base font-semibold text-foreground',
        description: 'text-sm leading-6 text-foreground',
        icon: 'text-warning',
      }}
      icon={<ShieldAlert size={22} aria-hidden="true" />}
      title={t('jurisdiction_notice.title')}
      description={(
        <>
          <p>{t('jurisdiction_notice.intro')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t('jurisdiction_notice.effect_vetting')}</li>
            <li>{t('jurisdiction_notice.effect_contact')}</li>
          </ul>
          <p className="mt-3 font-semibold">
            {canSet ? t('jurisdiction_notice.action_admin') : t('jurisdiction_notice.action_ask_admin')}
          </p>
          {canSet && !onConfigurationPage && (
            <Button
              className="mt-3"
              size="sm"
              variant="primary"
              onPress={() => navigate(settingPath)}
            >
              {t('jurisdiction_notice.set_button')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          )}
        </>
      )}
    />
  );
}

export default JurisdictionNotice;
