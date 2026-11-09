// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';

import Globe from 'lucide-react/icons/globe';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';

/**
 * Opt-in call to action shown when a federation browse endpoint rejects the
 * request with FEDERATION_NOT_ENABLED (the viewer has not opted in yet).
 * Mirrors the notice FederationMessagesPage renders, with generic wording.
 */
export function FederationOptInNotice() {
  const { t } = useTranslation('federation');
  const { tenantPath } = useTenant();

  return (
    <GlassCard className="p-4 border-l-4 border-accent bg-accent/10">
      <div className="flex items-start gap-3">
        <Globe className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <h3 className="font-semibold text-theme-primary">{t('optin_notice.title')}</h3>
          <p className="text-sm text-theme-muted mt-1">{t('optin_notice.description')}</p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/federation/onboarding')}
          size="sm"
          className="bg-accent-strong text-white flex-shrink-0"
        >
          {t('optin_notice.cta')}
        </Button>
      </div>
    </GlassCard>
  );
}

export default FederationOptInNotice;
