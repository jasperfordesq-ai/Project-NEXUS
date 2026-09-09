// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useCallback, useState } from 'react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmAccessibilityLabel?: string;
  cancelAccessibilityLabel?: string;
  confirmTestID?: string;
  cancelTestID?: string;
  /** 'danger' (default) for destructive actions, 'primary' otherwise. */
  variant?: 'primary' | 'danger';
  onConfirm: () => void | Promise<void>;
}

/**
 * Branded replacement for the confirmation form of `Alert.alert(title, msg,
 * [cancel, confirm])`. Returns an imperative `confirm(options)` opener plus a
 * `confirmDialog` element to render once in the screen tree:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   ...
 *   confirm({ title, message, confirmLabel, cancelLabel, variant: 'danger',
 *             onConfirm: () => doDelete() });
 *   ...
 *   return (<>{screen}{confirmDialog}</>);
 *
 * The dialog shows a spinner while an async `onConfirm` resolves, then closes.
 * Errors thrown by `onConfirm` still close the dialog — surface them with a
 * toast inside the action itself.
 *
 * 🔴 `variant` defaults to `'primary'`. It defaulted to `'danger'` until 2026-09-09, and
 * because most confirmations ARE destructive nobody noticed that the ones which are not
 * had gone red too: enrolling on a course, confirming a marketplace purchase, confirming
 * delivery, completing a group exchange and sending credits from the wallet all asked with
 * a red button. Red is how this app says "this takes something away". Spending it on
 * ordinary affirmative actions is how it stops meaning anything on the actions that matter.
 *
 * Pass `variant: 'danger'` for delete, remove, leave, block, cancel, withdraw, decline,
 * unpublish, archive and sign-out. Everything else takes the default.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
  }, []);

  const close = useCallback(() => {
    if (isConfirming) return;
    setOptions(null);
  }, [isConfirming]);

  const handleConfirm = useCallback(async () => {
    if (!options) return;
    const action = options.onConfirm;
    setIsConfirming(true);
    try {
      await action();
    } finally {
      setIsConfirming(false);
      setOptions(null);
    }
  }, [options]);

  const confirmDialog = (
    <ConfirmDialog
      visible={options !== null}
      title={options?.title ?? ''}
      message={options?.message}
      cancelLabel={options?.cancelLabel ?? ''}
      confirmLabel={options?.confirmLabel ?? ''}
      cancelAccessibilityLabel={options?.cancelAccessibilityLabel}
      confirmAccessibilityLabel={options?.confirmAccessibilityLabel}
      cancelTestID={options?.cancelTestID}
      confirmTestID={options?.confirmTestID}
      variant={options?.variant ?? 'primary'}
      isConfirming={isConfirming}
      onClose={close}
      onConfirm={handleConfirm}
    />
  );

  return { confirm, confirmDialog };
}
