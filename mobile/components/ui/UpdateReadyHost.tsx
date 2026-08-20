// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tells the member when a downloaded update is ready, and offers to restart.
 *
 * 🔴 The last third of the update story. `app.json` sets
 * `updates.checkAutomatically: "ON_LOAD"` with `fallbackToCacheTimeout: 0`, so the app
 * fetches a published fix in the background and applies it **on some later cold start** —
 * silently, whenever the member happens to fully quit and reopen the app. Nothing in the
 * app code touched `expo-updates` at all, so a fix could sit downloaded on a phone for
 * days while the member kept hitting the bug it repaired.
 *
 * This is deliberately the OPPOSITE of `UpdateRequiredScreen`:
 *
 *   UpdateRequiredScreen  the server has REFUSED this build. Blocking, no way out, the
 *                         only exit is installing a newer one. That is the policy.
 *   UpdateReadyHost       a fix is already downloaded and merely waiting. Optional,
 *                         dismissable, and it never interrupts what the member is doing.
 *
 * Conflating the two would be the worst outcome: a blocking prompt for an optional
 * restart trains people to dismiss the one that matters.
 *
 * A toast is the right shape here rather than a screen or a modal — it carries an action,
 * it does not steal focus, and the member can ignore it and carry on. `AppToast` already
 * supports `actionLabel`/`onActionPress`, so nothing new is invented.
 */

import { useEffect, useRef } from 'react';
import * as Updates from 'expo-updates';
import { useTranslation } from 'react-i18next';

import { useAppToast } from './AppToast';
import { reportException } from '@/lib/observability/report';

export default function UpdateReadyHost(): null {
  const { t } = useTranslation(['common']);
  const { show } = useAppToast();
  const { isUpdatePending } = Updates.useUpdates();

  // Shown once per pending update. Without this the effect re-announces on every render
  // that touches the toast, and an unignorable prompt is exactly what this must not be.
  const announced = useRef(false);

  useEffect(() => {
    // 🔴 `isEnabled` is false in a dev client and in Expo Go, where there is no update
    // mechanism at all. Without this guard the prompt could appear in development and
    // "Restart" would do nothing — the fastest way to teach the owner to distrust it.
    if (!Updates.isEnabled) return;
    if (!isUpdatePending) return;
    if (announced.current) return;

    announced.current = true;

    show({
      title: t('common:updateReady.title'),
      description: t('common:updateReady.description'),
      variant: 'accent',
      // Persistent: a fix waiting to be applied is worth more than four seconds of
      // attention, and the member can still dismiss it.
      duration: 'persistent',
      actionLabel: t('common:updateReady.action'),
      onActionPress: () => {
        // reloadAsync REJECTS if updates are unavailable or already reloading. An
        // unhandled rejection here would surface as a crash on a purely optional
        // convenience, so it is caught and reported rather than thrown.
        void Updates.reloadAsync().catch((error: unknown) => {
          reportException(error, { context: 'update-restart' }, 'update-reload-failed');
        });
      },
    });
  }, [isUpdatePending, show, t]);

  return null;
}
