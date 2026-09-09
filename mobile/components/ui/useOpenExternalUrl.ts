// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `openExternalUrl` with the member told when it did not work.
 *
 * 🔴 The point of this hook is that saying nothing is the easy path and the wrong one. Six
 * call sites were `void Linking.openURL(x)` with no catch at all, so a device with nothing
 * able to open the link produced an unhandled rejection and, from the member's side, a
 * button that did nothing whatsoever. A one-line toast is the difference between "this app
 * is broken" and "this phone cannot open that". Audit 2026-09-09, item 9.
 *
 * Use `openExternalUrl` directly only where a failure genuinely needs no message — the feed
 * card's link preview, where the card stays readable and there is nothing to recover.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppToast } from '@/components/ui/AppToast';
import { openExternalUrl, type OpenExternalUrlOptions, type OpenExternalUrlOutcome } from '@/lib/utils/openExternalUrl';

export function useOpenExternalUrl() {
  const { t } = useTranslation('common');
  const { show: showToast } = useAppToast();

  return useCallback(
    async (url: string | null | undefined, options?: OpenExternalUrlOptions): Promise<OpenExternalUrlOutcome> => {
      const outcome = await openExternalUrl(url, options);

      if (outcome === 'invalid') {
        // Missing, malformed, or a scheme the app refuses. The member did nothing wrong and
        // there is nothing for them to fix, so this says what happened and stops.
        showToast({ title: t('errors.linkUnavailable'), variant: 'warning' });
      } else if (outcome === 'unopenable') {
        showToast({ title: t('errors.linkOpenFailed'), variant: 'danger' });
      }

      return outcome;
    },
    [showToast, t],
  );
}
