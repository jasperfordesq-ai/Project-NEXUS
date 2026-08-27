// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 `jest-setup.ts` mocks `@/lib/haptics` GLOBALLY, for every test in the suite.
 * That is the right default — it gives screen tests complete
 * `ImpactFeedbackStyle` / `NotificationFeedbackType` enums without each of them
 * re-stubbing expo-haptics — but it also means the real module was unreachable,
 * and reported 0% coverage for a reason that looked like "nobody wrote a test"
 * when it was really "no test could reach it".
 *
 * `jest.unmock` below is what makes the real implementation testable. It is the
 * first use of it in this codebase; the same pattern is needed for anything else
 * jest-setup.ts mocks globally (OfflineBanner, TenantBanner, LoadingSpinner,
 * Skeleton).
 *
 * What is worth pinning: haptics must be a no-op on web rather than throwing,
 * and a device that cannot vibrate must never break the action the feedback was
 * decorating.
 */

jest.unmock('@/lib/haptics');

const mockImpactAsync = jest.fn();
const mockNotificationAsync = jest.fn();
const mockSelectionAsync = jest.fn();

jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpactAsync(...args),
  notificationAsync: (...args: unknown[]) => mockNotificationAsync(...args),
  selectionAsync: (...args: unknown[]) => mockSelectionAsync(...args),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

type HapticsModule = typeof import('./haptics');

/**
 * `Platform.OS` is read inside each function rather than captured at module
 * load, but the module still needs a fresh require per platform because the
 * react-native mock is installed per isolated registry. Only `Platform` is
 * mocked — spreading the real react-native module eagerly evaluates its lazy
 * getters and throws on missing TurboModules under Jest.
 */
function loadHapticsFor(os: 'ios' | 'android' | 'web'): HapticsModule {
  let loaded: HapticsModule;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    loaded = require('./haptics');
  });
  return loaded!;
}

describe('haptic feedback on a device', () => {
  let haptics: HapticsModule;

  beforeEach(() => {
    jest.clearAllMocks();
    mockImpactAsync.mockResolvedValue(undefined);
    mockNotificationAsync.mockResolvedValue(undefined);
    mockSelectionAsync.mockResolvedValue(undefined);
    haptics = loadHapticsFor('ios');
  });

  it('passes the requested impact style through', async () => {
    await haptics.impactAsync(haptics.ImpactFeedbackStyle.Medium);

    expect(mockImpactAsync).toHaveBeenCalledWith('medium');
  });

  it('passes the requested notification type through', async () => {
    await haptics.notificationAsync(haptics.NotificationFeedbackType.Success);

    expect(mockNotificationAsync).toHaveBeenCalledWith('success');
  });

  it('triggers selection feedback', async () => {
    await haptics.selectionAsync();

    expect(mockSelectionAsync).toHaveBeenCalled();
  });

  it('re-exports the full style and type enums the shared controls rely on', () => {
    // Button.tsx and friends read these off this module, so a missing member
    // becomes `undefined` passed to the native call rather than a type error.
    expect(haptics.ImpactFeedbackStyle).toEqual({ Light: 'light', Medium: 'medium', Heavy: 'heavy' });
    expect(haptics.NotificationFeedbackType).toEqual({
      Success: 'success',
      Warning: 'warning',
      Error: 'error',
    });
  });
});

describe('haptic feedback when the hardware refuses', () => {
  let haptics: HapticsModule;

  beforeEach(() => {
    jest.clearAllMocks();
    haptics = loadHapticsFor('android');
  });

  it('swallows an impact failure so the action it decorated still completes', async () => {
    mockImpactAsync.mockRejectedValue(new Error('no vibrator'));

    await expect(haptics.impactAsync(haptics.ImpactFeedbackStyle.Light)).resolves.toBeUndefined();
  });

  it('swallows a notification failure', async () => {
    mockNotificationAsync.mockRejectedValue(new Error('no vibrator'));

    await expect(
      haptics.notificationAsync(haptics.NotificationFeedbackType.Error)
    ).resolves.toBeUndefined();
  });

  it('swallows a selection failure', async () => {
    mockSelectionAsync.mockRejectedValue(new Error('no vibrator'));

    await expect(haptics.selectionAsync()).resolves.toBeUndefined();
  });
});

describe('haptic feedback on web', () => {
  let haptics: HapticsModule;

  beforeEach(() => {
    jest.clearAllMocks();
    haptics = loadHapticsFor('web');
  });

  it('never reaches the native module at all', async () => {
    // expo-haptics throws on web, so this has to short-circuit rather than
    // rely on the try/catch.
    await haptics.impactAsync(haptics.ImpactFeedbackStyle.Heavy);
    await haptics.notificationAsync(haptics.NotificationFeedbackType.Warning);
    await haptics.selectionAsync();

    expect(mockImpactAsync).not.toHaveBeenCalled();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
    expect(mockSelectionAsync).not.toHaveBeenCalled();
  });
});
