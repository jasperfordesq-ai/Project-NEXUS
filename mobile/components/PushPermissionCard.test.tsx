// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The behaviour under test is that the app ASKS. Until 2026-09-09 nothing outside the
 * Settings switch ever passed `requestPermission = true`, so on iOS and Android 13+ the
 * system dialog was never raised and a new member silently received no notifications at
 * all. The first assertion below — `registerForPushNotifications` called with `true` — is
 * the one that would have caught it.
 *
 * The rest pin the "once, ever" rule, which is what stops the fix becoming a nag.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import PushPermissionCard from './PushPermissionCard';

const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn();
const mockIsPushPermissionGranted = jest.fn();
const mockRegisterForPushNotifications = jest.fn();

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
  },
}));

jest.mock('@/lib/notifications', () => ({
  isPushPermissionGranted: (...args: unknown[]) => mockIsPushPermissionGranted(...args),
  registerForPushNotifications: (...args: unknown[]) => mockRegisterForPushNotifications(...args),
}));

describe('PushPermissionCard', () => {
  /*
    Spied on the real `Linking` the component imports rather than module-mocked: a mock of
    the whole react-native module drifts from the real surface, and `openSettings` rejecting
    is a case this component has to survive. Same approach as organisation-detail.test.tsx.
  */
  let openSettings: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
    mockIsPushPermissionGranted.mockResolvedValue(false);
    mockRegisterForPushNotifications.mockResolvedValue('registered');
  });

  afterEach(() => {
    openSettings.mockRestore();
  });

  it('offers notifications to a member who has never been asked', async () => {
    render(<PushPermissionCard />);

    expect(await screen.findByTestId('push-permission-card')).toBeTruthy();
  });

  it('raises the system permission dialog when the member accepts', async () => {
    render(<PushPermissionCard />);

    fireEvent.press(await screen.findByTestId('push-permission-enable'));

    // 🔴 `true` is the whole point. `false` — the default every other caller used — checks
    // the permission without ever showing the member a dialog.
    await waitFor(() => expect(mockRegisterForPushNotifications).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.queryByTestId('push-permission-card')).toBeNull());
  });

  it('records the decision and closes when the member says not now', async () => {
    render(<PushPermissionCard />);

    fireEvent.press(await screen.findByTestId('push-permission-dismiss'));

    await waitFor(() => expect(mockStorageSet).toHaveBeenCalledWith('nexus_push_prompt_decision', 'dismissed'));
    await waitFor(() => expect(screen.queryByTestId('push-permission-card')).toBeNull());
    expect(mockRegisterForPushNotifications).not.toHaveBeenCalled();
  });

  it('never asks a second time, whichever answer was given', async () => {
    for (const decision of ['asked', 'dismissed']) {
      mockStorageGet.mockResolvedValue(decision);
      const view = render(<PushPermissionCard />);

      await waitFor(() => expect(mockStorageGet).toHaveBeenCalled());
      expect(screen.queryByTestId('push-permission-card')).toBeNull();
      view.unmount();
      jest.clearAllMocks();
      mockStorageSet.mockResolvedValue(undefined);
    }
  });

  it('stays away when the member already allowed notifications', async () => {
    mockIsPushPermissionGranted.mockResolvedValue(true);
    render(<PushPermissionCard />);

    await waitFor(() => expect(mockIsPushPermissionGranted).toHaveBeenCalled());
    expect(screen.queryByTestId('push-permission-card')).toBeNull();
  });

  it('offers system settings only once the OS has refused', async () => {
    mockRegisterForPushNotifications.mockResolvedValue('permission-denied');
    render(<PushPermissionCard />);

    // Not on offer before the member has said yes — it would be a dead end.
    expect(screen.queryByTestId('push-permission-settings')).toBeNull();

    fireEvent.press(await screen.findByTestId('push-permission-enable'));

    const settings = await screen.findByTestId('push-permission-settings');
    fireEvent.press(settings);
    expect(openSettings).toHaveBeenCalled();
    await waitFor(() => expect(mockStorageSet).toHaveBeenCalledWith('nexus_push_prompt_decision', 'asked'));
  });

  it('does not send the member to system settings when registration merely failed', async () => {
    mockRegisterForPushNotifications.mockResolvedValue('failed');
    render(<PushPermissionCard />);

    fireEvent.press(await screen.findByTestId('push-permission-enable'));

    // handleEnable awaits TWO promises — the registration call and the storage
    // write that records "the member has been asked" — before it hides the card,
    // so the default waitFor window is tight on a loaded runner. This failed once
    // on a CI Android job (1 of 3,854) while passing repeatedly on the developer
    // machine; the component is deterministic (a 'failed' result always sets the
    // card hidden), so the wait is widened rather than the behaviour changed.
    await waitFor(() => expect(screen.queryByTestId('push-permission-card')).toBeNull(), {
      timeout: 5000,
    });
    expect(screen.queryByTestId('push-permission-settings')).toBeNull();
  });
});
