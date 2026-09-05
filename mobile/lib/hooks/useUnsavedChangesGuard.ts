// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { useNavigation } from 'expo-router';

import type { ConfirmOptions } from '@/components/ui/useConfirm';

interface UnsavedChangesGuardOptions {
  /** True while the form holds input the member has not saved. */
  isDirty: boolean;
  /** True while saving, or after a save has succeeded and the screen is leaving on purpose. */
  isBusy?: boolean;
  /** The screen's `confirm` from `useConfirm()` — it must also render `confirmDialog`. */
  confirm: (options: ConfirmOptions) => void;
  title: string;
  message: string;
  discardLabel: string;
  cancelLabel: string;
}

/**
 * Ask before a form with unsaved input is left — by Back, Cancel, the Android back
 * button or an iOS swipe. One implementation for every form, lifted from
 * edit-profile.tsx so listing creation (audit 2026-09-05, F05) does not grow a
 * second, slightly different one.
 *
 * `beforeRemove` covers every way a screen can be popped, including gestures, and
 * `navigation.dispatch(e.data.action)` replays the exact navigation the member
 * asked for once they confirm. Pass `isBusy` true from the moment a save succeeds,
 * or the guard will challenge the screen's own `router.replace` to the result.
 */
export function useUnsavedChangesGuard({
  isDirty,
  isBusy = false,
  confirm,
  title,
  message,
  discardLabel,
  cancelLabel,
}: UnsavedChangesGuardOptions): void {
  const navigation = useNavigation();

  useEffect(() => {
    if (!isDirty || isBusy) return undefined;
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      confirm({
        title,
        message,
        confirmLabel: discardLabel,
        cancelLabel,
        variant: 'danger',
        onConfirm: () => navigation.dispatch(e.data.action),
      });
    });
    return unsubscribe;
  }, [navigation, isDirty, isBusy, confirm, title, message, discardLabel, cancelLabel]);
}
