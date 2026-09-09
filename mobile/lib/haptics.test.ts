// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The shared Button vibrated on EVERY press of every variant, and toasts and
 * confirmations added their own on top, so the app buzzed on plain navigation as hard as it
 * did on sending credits. There was no way to stop it short of turning off system haptics
 * for the whole phone. Audit 2026-09-09, item 15.
 *
 * Two halves are under test: the preference actually silences every kind of feedback, and
 * it survives a restart.
 */

import { Platform } from 'react-native';

/*
  jest-setup mocks this module globally so every screen test gets stub feedback functions.
  This suite is testing the on/off gate that lives INSIDE those functions, so it needs the
  real ones — with expo-haptics itself mocked below, which is the actual boundary.
*/
jest.unmock('@/lib/haptics');

import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  hapticsEnabled,
  impactAsync,
  initHaptics,
  notificationAsync,
  resetHapticsForTests,
  selectionAsync,
  setHapticsEnabled,
  subscribeToHaptics,
} from './haptics';

const mockImpact = jest.fn();
const mockNotification = jest.fn();
const mockSelection = jest.fn();
const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn();

jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => mockImpact(...args),
  notificationAsync: (...args: unknown[]) => mockNotification(...args),
  selectionAsync: (...args: unknown[]) => mockSelection(...args),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
  },
}));

describe('haptics preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetHapticsForTests();
    Platform.OS = 'ios';
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('vibrates by default, because that is the established behaviour', async () => {
    expect(hapticsEnabled()).toBe(true);

    await impactAsync(ImpactFeedbackStyle.Light);
    expect(mockImpact).toHaveBeenCalled();
  });

  it('silences every kind of feedback when switched off', async () => {
    // 🔴 All three, not just the button impact. A member who turns vibration off and still
    // feels the toast on every error has not been given the setting they asked for.
    await setHapticsEnabled(false);

    await impactAsync(ImpactFeedbackStyle.Light);
    await notificationAsync(NotificationFeedbackType.Success);
    await selectionAsync();

    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it('remembers the choice', async () => {
    await setHapticsEnabled(false);
    expect(mockStorageSet).toHaveBeenCalledWith('nexus_haptics_enabled', '0');

    await setHapticsEnabled(true);
    expect(mockStorageSet).toHaveBeenCalledWith('nexus_haptics_enabled', '1');
  });

  it('restores the choice at startup', async () => {
    mockStorageGet.mockResolvedValue('0');
    await initHaptics();

    expect(hapticsEnabled()).toBe(false);
    await impactAsync(ImpactFeedbackStyle.Light);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('stays on when nothing was ever stored', async () => {
    mockStorageGet.mockResolvedValue(null);
    await initHaptics();

    expect(hapticsEnabled()).toBe(true);
  });

  it('keeps the setting for this session even if the write fails', async () => {
    // A preference is not data. Losing the write should not lose the member's choice now.
    mockStorageSet.mockRejectedValue(new Error('keychain unavailable'));

    await setHapticsEnabled(false);

    expect(hapticsEnabled()).toBe(false);
  });

  it('tells a rendered switch when the value changes', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToHaptics(listener);

    await setHapticsEnabled(false);
    expect(listener).toHaveBeenCalledWith(false);

    unsubscribe();
    await setHapticsEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
