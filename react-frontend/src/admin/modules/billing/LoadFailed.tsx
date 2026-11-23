// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "This could not be loaded", with a way to try again.
 *
 * Branch payments, Branch plans and Revenue each showed one red line and
 * nothing to press, so the only way forward was to know to reload the page.
 * The words go inside the Alert: given children, the shared Alert drops its
 * `title`.
 */

import { useTranslation } from 'react-i18next';
import { Alert, Button } from '@/components/ui';

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('admin_billing');

  return (
    <Alert color="danger" role="alert">
      <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">{message}</span>
        <Button size="sm" variant="secondary" onPress={onRetry}>
          {t('control.try_again')}
        </Button>
      </div>
    </Alert>
  );
}
