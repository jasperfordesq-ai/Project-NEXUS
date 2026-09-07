// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { renderHook } from '@testing-library/react-native';

const mockDispatch = jest.fn();
const mockPreventRemove = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ dispatch: (...args: unknown[]) => mockDispatch(...args) }),
}));

/*
  🔴 `usePreventRemove` is mocked rather than exercised through a real NavigationContainer,
  because what this hook is responsible for is exactly the two things asserted below: WHEN
  it asks React Navigation to protect the screen, and WHAT it does when React Navigation
  tells it a removal was prevented. Whether prevention itself works on a native stack is
  React Navigation's job — and the reason this hook was moved onto their hook in the first
  place (audit 2026-09-06, F08): the previous `beforeRemove` + `preventDefault()` approach
  is documented as not working properly on native-stack, which is what Expo Router's
  `Stack` resolves to.
*/
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args),
}));

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const labels = {
  title: 'Unsaved changes',
  message: 'Discard?',
  discardLabel: 'Discard',
  cancelLabel: 'Cancel',
};

/** Replay what React Navigation does when it stops a protected screen being removed. */
function firePrevented() {
  const callback = mockPreventRemove.mock.calls.at(-1)?.[1] as
    (options: { data: { action: unknown } }) => void;
  callback({ data: { action: { type: 'GO_BACK' } } });
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks React Navigation to protect a dirty screen', () => {
    renderHook(() => useUnsavedChangesGuard({ isDirty: true, confirm: jest.fn(), ...labels }));
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  it('holds the screen and asks before discarding dirty input', () => {
    const confirm = jest.fn();
    renderHook(() => useUnsavedChangesGuard({ isDirty: true, confirm, ...labels }));

    firePrevented();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Unsaved changes', confirmLabel: 'Discard', variant: 'danger',
    }));
    expect(mockDispatch).not.toHaveBeenCalled();

    // Confirming replays the exact navigation the member asked for.
    (confirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  it('does not intercept a clean form', () => {
    const confirm = jest.fn();
    renderHook(() => useUnsavedChangesGuard({ isDirty: false, confirm, ...labels }));

    expect(mockPreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
    expect(confirm).not.toHaveBeenCalled();
  });

  /**
   * 🔴 After a CONFIRMED save the screen leaves on purpose with `router.replace`.
   * Without `hasSaved` the guard would challenge that very navigation.
   */
  it('stands down once a save is confirmed', () => {
    const confirm = jest.fn();
    const { rerender, unmount } = renderHook(
      (props: { hasSaved: boolean }) => useUnsavedChangesGuard({
        isDirty: true, hasSaved: props.hasSaved, confirm, ...labels,
      }),
      { initialProps: { hasSaved: false } },
    );
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));

    rerender({ hasSaved: true });
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));

    unmount();
  });

  /**
   * 🔴 Audit 2026-09-06, F03. A pending write used to disarm the guard, so a member could
   * walk out of a form mid-save — losing the draft if the request then failed, or being
   * yanked forward if it succeeded. A save that has been STARTED is not a save that has
   * been KEPT, so the screen stays protected until the write is confirmed.
   */
  it('keeps protecting a dirty screen while a save is still in flight', () => {
    renderHook(() => useUnsavedChangesGuard({
      isDirty: true, isSaving: true, confirm: jest.fn(), ...labels,
    }));
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  it('offers to wait rather than to discard while a save is in flight', () => {
    const confirm = jest.fn();
    renderHook(() => useUnsavedChangesGuard({
      isDirty: true, isSaving: true, confirm, ...labels,
    }));

    firePrevented();

    const options = confirm.mock.calls[0][0] as { title: string; message: string; confirmLabel: string; cancelLabel: string };
    // Not the discard wording: nothing is being thrown away yet, a request is running.
    expect(options.title).not.toBe(labels.title);
    expect(options.message).not.toBe(labels.message);
    expect(options.confirmLabel).not.toBe(labels.discardLabel);
    expect(mockDispatch).not.toHaveBeenCalled();

    // Leaving anyway is still the member's call.
    (confirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
  });

  it('protects a dirty screen again when a save fails', () => {
    const { rerender } = renderHook(
      (props: { isSaving: boolean }) => useUnsavedChangesGuard({
        isDirty: true, isSaving: props.isSaving, confirm: jest.fn(), ...labels,
      }),
      { initialProps: { isSaving: true } },
    );

    // The request rejects: still dirty, no longer saving.
    rerender({ isSaving: false });

    expect(mockPreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
  });

  it('does not navigate after the screen has been unmounted', () => {
    const confirm = jest.fn();
    const { unmount } = renderHook(() => useUnsavedChangesGuard({
      isDirty: true, confirm, ...labels,
    }));

    firePrevented();
    unmount();
    (confirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm();

    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
