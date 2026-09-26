// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import SearchX from 'lucide-react/icons/search-x';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

/** Shown for a guide that does not exist, or whose feature this community has switched off. */
export function HelpNotFound() {
  const { t } = useTranslation('help_centre');
  const { tenantPath } = useTenant();
  return (
    <div className="mx-auto max-w-2xl px-1 py-8 sm:px-0">
      <GlassCard className="p-8 text-center">
        <SearchX className="mx-auto h-10 w-10 text-theme-subtle" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-theme-primary">{t('not_found_title')}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-theme-muted">{t('not_found_body')}</p>
        <Button as={Link} to={tenantPath('/help')} color="primary" className="mt-6">
          {t('not_found_button')}
        </Button>
      </GlassCard>
    </div>
  );
}
