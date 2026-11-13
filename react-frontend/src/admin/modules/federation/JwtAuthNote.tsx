// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import KeyRound from 'lucide-react/icons/key-round';
import { useTranslation } from 'react-i18next';
import { Card, CardBody } from '@/components/ui';

/**
 * Pointer for the platform operator: JWT-based partner sign-in is configured
 * at platform level (Super Admin → Federation Controls), not per community.
 *
 * It lives on the External platforms page, next to the connections it is
 * about. Until November 2026 it sat in the middle of Network settings, where
 * a non-technical admin met an environment-variable name between the master
 * switch and the partnership preferences.
 */
export function JwtAuthNote() {
  const { t } = useTranslation('admin_federation', { keyPrefix: 'federation' });

  return (
    <Card className="border border-border">
      <CardBody className="flex flex-row items-start gap-3 text-sm">
        <KeyRound aria-hidden="true" size={18} className="text-muted mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{t('jwt_federation_auth_platform_title')}</p>
          <p className="text-muted mt-1">
            {t('jwt_federation_auth_platform_intro')}{' '}
            <strong>{t('external_partners')}</strong>{' '}
            {t('jwt_federation_auth_platform_middle')}{' '}
            <code className="text-xs bg-surface-secondary px-1 rounded">FEDERATION_JWT_SECRET</code>{' '}
            {t('jwt_federation_auth_platform_suffix')}{' '}
            <strong>{t('label_super_admin')} / {t('federation_controls')}</strong>.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

export default JwtAuthNote;
