// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockAuthenticate = jest.fn();
const mockCapability = jest.fn();
const mockEnabled = jest.fn();
const mockLogout = jest.fn();
let mockAuthState = { isAuthenticated: true, isLoading: false, sessionRestoreFailed: false };

jest.mock('react-native-screens', () => {
  const { View } = require('react-native');
  return { ...jest.requireActual('react-native-screens'), FullWindowOverlay: ({ children }: { children: React.ReactNode }) => <View testID="full-window-overlay">{children}</View> };
});
jest.mock('@/lib/biometricLock', () => ({
  biometricFailureKey: (reason: string) => reason === 'no_hardware' ? 'noHardware' : reason === 'not_enrolled' ? 'notEnrolled' : reason,
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  biometricCapability: (...args: unknown[]) => mockCapability(...args),
  isBiometricLockEnabled: (...args: unknown[]) => mockEnabled(...args),
}));

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => ({ ...mockAuthState, logout: mockLogout }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#2563eb' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff', text: '#111111', textSecondary: '#555555', error: '#b91c1c',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import BiometricLockGate from './BiometricLockGate';

/*
  🔴 The gate's async assertions carry an explicit 5s timeout, matching `clubs.test.tsx`.
  React Native Testing Library's default is 1s of WALL CLOCK, and this suite failed twice on
  CI (runs 34023091751 and 34023747965) at two different `waitFor`s while passing here every
  time — the gate is one of the few screens that awaits a real promise chain through several
  state transitions, and the release gate runs the whole suite `--runInBand --coverage` on a
  4-vCPU runner. Checked before reaching for the timeout: the suite logs no "not wrapped in
  act" warnings, so the updates are being flushed; and a component change to stop the
  decision effect cancelling itself was written, tested and REVERTED because a test driving
  five re-renders during a pending check passed against the unfixed component. The
  assertions themselves are unchanged.
*/
const SLOW_CI = { timeout: 5000 };

describe('BiometricLockGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockReset();
    mockLogout.mockReset();
    mockAuthState = { isAuthenticated: true, isLoading: false, sessionRestoreFailed: false };
    mockEnabled.mockResolvedValue(true);
    mockCapability.mockResolvedValue({ usable: true });
    mockAuthenticate.mockResolvedValue({ ok: true });
    mockLogout.mockResolvedValue(undefined);
  });

  /*
    F-040. On iOS every `presentation: 'modal'` route is a native sheet presented ABOVE the React
    Native root view, so a lock drawn as an absolutely-positioned sibling inside that root is
    covered by any modal a queued deep link or notification opens. The lock must live in its own
    window above everything (FullWindowOverlay). Android draws modals inside the same view tree.
  */
  it.each([['ios', true], ['android', false]] as const)('on %s renders the lock in a full-window overlay: %s', async (os, overlay) => {
    const { Platform } = require('react-native');
    const original = Platform.OS;
    Platform.OS = os;
    // Keep the prompt pending so the lock stays up while we inspect where it is drawn.
    mockAuthenticate.mockReturnValue(new Promise(() => undefined));
    try {
      const view = render(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
      const lock = await view.findByTestId('biometric-lock-gate', {}, SLOW_CI);
      const insideOverlay = view.queryByTestId('full-window-overlay') !== null
        && within(view.getByTestId('full-window-overlay')).queryByTestId('biometric-lock-gate') !== null;
      expect(lock).toBeTruthy();
      expect(insideOverlay).toBe(overlay);
      view.unmount();
    } finally {
      Platform.OS = original;
    }
  });

  /*
    F-119: the lock used to run only at a cold start, so a phone handed over (or picked up)
    with the app merely backgrounded opened straight into the account. It re-locks when the
    app returns after more than RELOCK_AFTER_BACKGROUND_MS in the background.
  */
  describe('re-locking after time in the background (F-119)', () => {
    const { AppState } = require('react-native');
    let appStateHandler: ((state: string) => void) | undefined;
    let now = 1_000_000;
    let addListener: jest.SpyInstance;
    let clock: jest.SpyInstance;

    beforeEach(() => {
      appStateHandler = undefined;
      now = 1_000_000;
      addListener = jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
        const [type, handler] = args as [string, (state: string) => void];
        if (type === 'change') appStateHandler = handler;
        return { remove: jest.fn() };
      });
      clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      addListener.mockRestore();
      clock.mockRestore();
    });

    async function unlockedGate() {
      const view = render(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
      await waitFor(() => expect(view.queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
      return view;
    }

    it('locks again, and prompts, when the app returns after a long absence', async () => {
      const { RELOCK_AFTER_BACKGROUND_MS } = require('./BiometricLockGate');
      mockAuthenticate.mockResolvedValueOnce({ ok: true }).mockReturnValueOnce(new Promise(() => undefined));
      const view = await unlockedGate();

      act(() => { appStateHandler?.('background'); });
      now += RELOCK_AFTER_BACKGROUND_MS + 1;
      act(() => { appStateHandler?.('active'); });

      // Covered at once — the account must not show while the preference is re-read.
      expect(view.queryByText('Private account')).toBeNull();
      expect(await view.findByTestId('biometric-lock-gate', {}, SLOW_CI)).toBeTruthy();
      await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledTimes(2), SLOW_CI);
    });

    it('does not re-lock after a short trip away from the app', async () => {
      const { RELOCK_AFTER_BACKGROUND_MS } = require('./BiometricLockGate');
      const view = await unlockedGate();

      act(() => { appStateHandler?.('background'); });
      now += RELOCK_AFTER_BACKGROUND_MS - 1_000;
      act(() => { appStateHandler?.('active'); });

      expect(view.queryByTestId('biometric-lock-gate')).toBeNull();
      expect(view.getByText('Private account')).toBeTruthy();
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    });

    it('stays open after a long absence when the member has turned the lock off', async () => {
      const { RELOCK_AFTER_BACKGROUND_MS } = require('./BiometricLockGate');
      const view = await unlockedGate();
      mockEnabled.mockResolvedValue(false);

      act(() => { appStateHandler?.('background'); });
      now += RELOCK_AFTER_BACKGROUND_MS + 1;
      act(() => { appStateHandler?.('active'); });

      await waitFor(() => expect(view.queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
      expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    });

    it('keeps the iOS lock in its full-window overlay when it re-locks (F-040)', async () => {
      const { Platform } = require('react-native');
      const original = Platform.OS;
      Platform.OS = 'ios';
      try {
        const { RELOCK_AFTER_BACKGROUND_MS } = require('./BiometricLockGate');
        mockAuthenticate.mockResolvedValueOnce({ ok: true }).mockReturnValueOnce(new Promise(() => undefined));
        const view = await unlockedGate();

        act(() => { appStateHandler?.('background'); });
        now += RELOCK_AFTER_BACKGROUND_MS + 1;
        act(() => { appStateHandler?.('active'); });

        await view.findByTestId('biometric-lock-gate', {}, SLOW_CI);
        expect(within(view.getByTestId('full-window-overlay')).queryByTestId('biometric-lock-gate')).not.toBeNull();
      } finally {
        Platform.OS = original;
      }
    });
  });

  it('starts one prompt for rapid unlock taps', async () => {
    let finish!: (value: { ok: boolean; reason?: string }) => void;
    mockAuthenticate.mockResolvedValueOnce({ ok: false, reason: 'cancelled' })
      .mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
    await view.findByTestId('biometric-lock-error');
    act(() => {
      fireEvent.press(view.getByText('settings:biometricLock.unlock'));
      fireEvent.press(view.getByText('settings:biometricLock.unlock'));
    });
    const calls = mockAuthenticate.mock.calls.length;
    await act(async () => { finish({ ok: true }); });
    expect(calls).toBe(2); // Startup prompt plus one deliberate retry.
  });

  it('keeps content covered when an old prompt succeeds during sign-out', async () => {
    let finishPrompt!: (value: { ok: true }) => void;
    let finishLogout!: () => void;
    mockAuthenticate.mockReturnValueOnce(new Promise(resolve => { finishPrompt = resolve; }));
    mockLogout.mockReturnValueOnce(new Promise<void>(resolve => { finishLogout = resolve; }));
    const view = render(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledTimes(1));
    act(() => {
      fireEvent.press(view.getByText('common:labels.signOut'));
      fireEvent.press(view.getByText('common:labels.signOut'));
    });
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('biometric-sign-out').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(view.getByTestId('biometric-sign-out').props.accessibilityLabel).toBe('common:labels.signOut');
    expect(view.getByTestId('biometric-unlock').props.accessibilityLabel).toBe('settings:biometricLock.unlock');
    expect(view.getByTestId('biometric-unlock').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => { finishPrompt({ ok: true }); });
    const covered = view.queryByTestId('biometric-lock-gate') !== null;
    await act(async () => { finishLogout(); });
    expect(covered).toBe(true);
  });

  it('keeps the lock recoverable after a sign-out failure', async () => {
    mockAuthenticate.mockResolvedValueOnce({ ok: false, reason: 'cancelled' }).mockResolvedValueOnce({ ok: true });
    mockLogout.mockRejectedValueOnce(new Error('Local failure'));
    const view = render(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
    await view.findByTestId('biometric-lock-error');
    fireEvent.press(view.getByTestId('biometric-sign-out'));
    expect(await view.findByText('common:errors.generic')).toBeTruthy();
    expect(view.queryByText('Private account')).toBeNull();
    // Press inside act so the unlock's resolved prompt commits before the assertion. Pressed
    // bare, the state update lands outside act and React defers it: measured 810 ms to open
    // locally (40 ms inside act), which crossed waitFor's 1 s default on every CI release-gate
    // run of 87bfd3080 while passing here - a timing flake, not a lock defect.
    await act(async () => { fireEvent.press(view.getByTestId('biometric-unlock')); });
    await waitFor(() => expect(view.queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
  });

  it('never blocks a signed-out member from reaching the login UI', async () => {
    mockAuthState = { isAuthenticated: false, isLoading: false, sessionRestoreFailed: false };
    const { getByText, queryByTestId } = render(
      <BiometricLockGate><Text>Login form</Text></BiometricLockGate>,
    );

    expect(getByText('Login form')).toBeTruthy();
    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('keeps protected content covered until successful device authentication', async () => {
    let finishAuthentication: ((value: { ok: true }) => void) | undefined;
    mockAuthenticate.mockReturnValue(new Promise((resolve) => { finishAuthentication = resolve; }));

    const { getByText, getByTestId, queryByTestId } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );

    expect(getByText('Private account', { includeHiddenElements: true })).toBeTruthy();
    expect(() => getByText('Private account')).toThrow();
    expect(getByTestId('biometric-lock-gate')).toBeTruthy();
    await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledWith('settings:biometricLock.prompt'));

    // Resolved inside `act` so React has flushed the update before the assertion. Without
    // it this raced and failed intermittently on CI, which is a slower machine than this one.
    await act(async () => {
      finishAuthentication?.({ ok: true });
    });
    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
  });

  it('shows an honest failure, permits retry, and always permits sign out', async () => {
    mockAuthenticate
      .mockResolvedValueOnce({ ok: false, reason: 'cancelled' })
      .mockResolvedValueOnce({ ok: true });

    const { findByTestId, getByText, queryByTestId } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );

    expect(await findByTestId('biometric-lock-error')).toHaveTextContent(
      'settings:biometricLock.errors.cancelled',
    );
    await act(async () => { fireEvent.press(getByText('common:labels.signOut')); });
    expect(mockLogout).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.press(getByText('settings:biometricLock.unlock')); });
    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
  });

  /*
    🔴 The escape hatch has to actually lead somewhere. The test above proves the Sign out
    BUTTON calls `logout()`; it then retries biometrics and never checks what the member
    sees once the session has actually ended. That gap hid a real trap: the gate made its
    lock/open decision once per app start, so an auth change arriving afterwards was
    ignored and the opaque overlay stayed on top of the login form the member had just been
    returned to. Cancel the prompt, sign out, and the app was unusable until reinstall — for
    exactly the member the hatch exists for, the one whose sensor has stopped reading.

    Asserting on the overlay being GONE, not on `logout` having been called.
  */
  it('uncovers the login screen when the session ends while the gate is locked', async () => {
    mockAuthenticate.mockResolvedValue({ ok: false, reason: 'cancelled' });

    const { findByTestId, getByText, queryByTestId, rerender } = render(
      <BiometricLockGate><Text>Login form</Text></BiometricLockGate>,
    );

    // Locked, prompt refused, escape hatch on screen.
    expect(await findByTestId('biometric-lock-error')).toBeTruthy();
    fireEvent.press(getByText('common:labels.signOut'));
    expect(mockLogout).toHaveBeenCalledTimes(1);

    // `logout()` ends the session. Re-render with the state the real provider would publish.
    mockAuthState = { isAuthenticated: false, isLoading: false, sessionRestoreFailed: false };
    await act(async () => {
      rerender(<BiometricLockGate><Text>Login form</Text></BiometricLockGate>);
    });

    await waitFor(() => expect(queryByTestId('biometric-lock-gate')).toBeNull(), SLOW_CI);
    expect(getByText('Login form')).toBeTruthy();
  });

  it('still locks a stored session recovered after an offline restore failure', async () => {
    mockAuthState = { isAuthenticated: false, isLoading: false, sessionRestoreFailed: true };
    mockAuthenticate.mockResolvedValue({ ok: false, reason: 'cancelled' });
    const view = render(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
    await waitFor(() => expect(view.queryByTestId('biometric-lock-gate')).toBeNull());
    mockAuthState = { isAuthenticated: true, isLoading: false, sessionRestoreFailed: false };
    view.rerender(<BiometricLockGate><Text>Private account</Text></BiometricLockGate>);
    expect(await view.findByTestId('biometric-lock-error')).toBeTruthy();
    expect(view.queryByText('Private account')).toBeNull();
  });

  it('requires authentication even when capability detection is unavailable', async () => {
    mockCapability.mockResolvedValue({ usable: false });
    mockAuthenticate.mockResolvedValue({ ok: false, reason: 'unavailable' });
    const { findByTestId, queryByText } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );

    expect(await findByTestId('biometric-lock-error')).toBeTruthy();
    expect(queryByText('Private account')).toBeNull();
    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('keeps the session locked when the saved preference cannot be read', async () => {
    mockEnabled.mockRejectedValue(new Error('Keychain unavailable'));
    const { findByTestId, queryByText } = render(
      <BiometricLockGate><Text>Private account</Text></BiometricLockGate>,
    );
    expect(await findByTestId('biometric-lock-error')).toHaveTextContent('settings:biometricLock.errors.unavailable');
    expect(queryByText('Private account')).toBeNull();
  });
});
