// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { renderHook } from '@testing-library/react-native';

const listeners: Record<string, (e: unknown) => void> = {};
const mockDispatch = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({
    addListener: (event: string, handler: (e: unknown) => void) => {
      listeners[event] = handler;
      return mockUnsubscribe;
    },
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  }),
}));

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

function fireBeforeRemove() {
  const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
  listeners.beforeRemove?.(e);
  return e;
}

const labels = { title: 'Unsaved changes', message: 'Discard?', discardLabel: 'Discard', cancelLabel: 'Cancel' };

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  it('holds the screen and asks before discarding dirty input', () => {
    const confirm = jest.fn();
    renderHook(() => useUnsavedChangesGuard({ isDirty: true, confirm, ...labels }));

    const e = fireBeforeRemove();

    expect(e.preventDefault).toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unsaved changes', confirmLabel: 'Discard', variant: 'danger' }));
    expect(mockDispatch).not.toHaveBeenCalled();

    // Confirming replays the exact navigation the member asked for.
    (confirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  it('does not intercept a clean form', () => {
    const confirm = jest.fn();
    renderHook(() => useUnsavedChangesGuard({ isDirty: false, confirm, ...labels }));

    expect(listeners.beforeRemove).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  /**
   * 🔴 After a successful save the screen leaves on purpose with `router.replace`.
   * Without `isBusy` the guard would challenge that very navigation.
   */
  it('stands down while busy or after a save, and unsubscribes', () => {
    const confirm = jest.fn();
    const { rerender, unmount } = renderHook(
      (props: { isBusy: boolean }) => useUnsavedChangesGuard({ isDirty: true, isBusy: props.isBusy, confirm, ...labels }),
      { initialProps: { isBusy: false } },
    );
    expect(listeners.beforeRemove).toBeDefined();

    rerender({ isBusy: true });
    expect(mockUnsubscribe).toHaveBeenCalled();

    unmount();
  });
});
