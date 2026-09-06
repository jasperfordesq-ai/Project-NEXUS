// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback } from 'react';
import { usePreventRemove } from '@react-navigation/native';
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
 * 🔴 Built on `usePreventRemove`, NOT on `navigation.addListener('beforeRemove')` +
 * `e.preventDefault()` — which is what this did until the 2026-09-06 audit (F08).
 *
 * Expo Router's `Stack` resolves to **native-stack**, and React Navigation states plainly
 * that preventing removal with a `beforeRemove` listener does not work properly there,
 * recommending this hook instead; the installed native-stack even ships a warning for a
 * screen the native side has already removed while JS still holds it via that listener.
 * The consequence is not cosmetic. The native gesture — an iOS swipe-back, an Android
 * predictive back — can tear the screen down natively while JS believes it prevented the
 * removal, which is how a member ends up with either the typed content gone after choosing
 * "keep editing", or a screen still on the stack that no longer responds. It affected
 * registration and every create/edit form in the app, not one screen.
 *
 * `usePreventRemove` is the supported route to the same behaviour: React Navigation tells
 * the native stack the screen is protected, and `navigation.dispatch(data.action)` replays
 * the exact navigation the member asked for once they confirm.
 *
 * Pass `isBusy` true from the moment a save succeeds, or the guard will challenge the
 * screen's own `router.replace` to the result.
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

  const onPrevented = useCallback(
    ({ data }: { data: { action: Parameters<typeof navigation.dispatch>[0] } }) => {
      confirm({
        title,
        message,
        confirmLabel: discardLabel,
        cancelLabel,
        variant: 'danger',
        onConfirm: () => navigation.dispatch(data.action),
      });
    },
    [cancelLabel, confirm, discardLabel, message, navigation, title],
  );

  usePreventRemove(isDirty && !isBusy, onPrevented);
}
