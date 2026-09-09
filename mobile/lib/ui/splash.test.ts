// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Holding a splash open is a promise to close it, and the close lives inside the
 * provider tree. The tests that matter most here are the ones about NOT keeping it: a
 * splash that never lifts is a far worse failure than the flash this replaced, and it
 * would look exactly like a hung app. Audit 2026-09-09, item 7.
 */

import { SPLASH_MAX_HOLD_MS, holdSplash, releaseSplash, resetSplashStateForTests } from './splash';

const mockPreventAutoHideAsync = jest.fn();
const mockHideAsync = jest.fn();

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: (...args: unknown[]) => mockPreventAutoHideAsync(...args),
  hideAsync: (...args: unknown[]) => mockHideAsync(...args),
}));

describe('splash hold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetSplashStateForTests();
    mockPreventAutoHideAsync.mockResolvedValue(true);
    mockHideAsync.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the native splash up until it is released', () => {
    holdSplash();

    expect(mockPreventAutoHideAsync).toHaveBeenCalled();
    expect(mockHideAsync).not.toHaveBeenCalled();
  });

  it('lets it go when the app says it is ready', async () => {
    holdSplash();
    await releaseSplash();

    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });

  it('dismisses itself when nothing ever releases it', async () => {
    // The provider tree throws, or a session check never settles. Without this the member
    // sits on a splash screen for ever with no error and no way out.
    holdSplash();

    jest.advanceTimersByTime(SPLASH_MAX_HOLD_MS);
    await Promise.resolve();

    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });

  it('hides only once, however many callers ask', async () => {
    // RootNavigator and ErrorBoundary can both fire, and so can the backstop.
    holdSplash();
    await releaseSplash();
    await releaseSplash();
    jest.advanceTimersByTime(SPLASH_MAX_HOLD_MS);
    await Promise.resolve();

    expect(mockHideAsync).toHaveBeenCalledTimes(1);
  });

  it('survives a splash that has already gone', async () => {
    // preventAutoHideAsync rejects after a Fast Refresh; hideAsync can reject on web.
    mockPreventAutoHideAsync.mockRejectedValue(new Error('already hidden'));
    mockHideAsync.mockRejectedValue(new Error('no splash'));

    holdSplash();
    await expect(releaseSplash()).resolves.toBeUndefined();
  });
});
