// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts';
import { Button } from '@/components/ui/Button';

export function AuthUnavailableScreen() {
  const { t } = useTranslation('common');
  const { refreshUser } = useAuth();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4" role="alert">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-theme-primary">{t('errors.unexpected')}</h1>
        <p className="mt-2 text-sm text-theme-muted">{t('errors.connection_failed_detail')}</p>
        <Button className="mt-5" onPress={() => { void refreshUser(); }}>{t('actions.retry')}</Button>
      </div>
    </div>
  );
}
