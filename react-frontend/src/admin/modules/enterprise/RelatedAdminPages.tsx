// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Related admin pages" section of the admin Settings page: peer configuration
 * pages that live on their own routes. Always visible.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Compass from 'lucide-react/icons/compass';
import { Button } from '@/components/ui';
import { useTenant } from '@/contexts';
import { SettingsSection, SettingsRow } from '../system/settings/SettingsSection';
import { RELATED_ADMIN_PAGES } from './systemConfigSchema';

export const RELATED_PAGES_SECTION_ID = 'related';

export function RelatedAdminPages() {
  const { t } = useTranslation(['admin_enterprise', 'admin_system']);
  const { tenantPath } = useTenant();

  return (
    <SettingsSection
      id={RELATED_PAGES_SECTION_ID}
      icon={<Compass size={20} aria-hidden="true" />}
      tone="neutral"
      title={t('enterprise.related_admin_pages')}
      description={t('admin_system:admin_settings.section_related_desc')}
      layout="rows"
    >
      {RELATED_ADMIN_PAGES.map((entry) => (
        <SettingsRow key={entry.href} label={t(entry.labelKey)} help={t(entry.descriptionKey)}>
          <Button
            as={Link}
            to={tenantPath(entry.href)}
            size="sm"
            variant="secondary"
            endContent={<ArrowRight size={14} aria-hidden="true" />}
          >
            {t('enterprise.open_related_page', { name: t(entry.destLabelKey) })}
          </Button>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

export default RelatedAdminPages;
