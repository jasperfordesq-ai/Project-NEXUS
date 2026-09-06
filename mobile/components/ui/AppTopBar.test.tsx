// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { BackHandler, Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

/*
  🔴 expo-router is mocked locally rather than through jest-setup, whose `useFocusEffect` is
  an inert `jest.fn()`. The whole point of this file after the 2026-09-06 audit (F10) is
  WHEN the Android back listener exists, so a stub that never runs the effect would assert
  nothing. `router` is reproduced without `canGoBack`, matching a stack with no history —
  the component checks for the method before calling it, so its absence means "cannot go
  back" and the fallback path is exercised.
*/
jest.mock('expo-router', () => {
  // Built inside the factory: a `const` at module scope is still uninitialised when the
  // component under test first requires this module, and the mock resolves to undefined.
  const focus: { callback: (() => (() => void) | void) | null } = { callback: null };
  return {
    __focus: focus,
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useFocusEffect: (cb: () => (() => void) | void) => { focus.callback = cb; },
  };
});

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
}));

import { router } from 'expo-router';

import AppTopBar from './AppTopBar';

const mockRouter = router as unknown as { replace: jest.Mock; back: jest.Mock; push: jest.Mock };
const mockFocus = (jest.requireMock('expo-router') as {
  __focus: { callback: (() => (() => void) | void) | null };
}).__focus;

describe('AppTopBar', () => {
  let hardwareBackHandler: (() => boolean) | null = null;
  const removeHardwareBackHandler = jest.fn();

  /** Run the focus effect the way React Navigation does when the screen gains focus. */
  function focusScreen(): (() => void) | void {
    return mockFocus.callback?.();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    hardwareBackHandler = null;
    mockFocus.callback = null;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'android',
    });
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_eventName, handler) => {
      hardwareBackHandler = () => handler() === true;
      return {
        remove: () => {
          hardwareBackHandler = null;
          removeHardwareBackHandler();
        },
      };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses fallback navigation from the visible back button when stack history is unavailable', () => {
    const { getByLabelText } = render(
      <AppTopBar title="Create Group" backLabel="Back" fallbackHref="/(tabs)/groups" />,
    );

    fireEvent.press(getByLabelText('Back'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/groups');
  });

  it('maps Android hardware back to the same fallback navigation', () => {
    render(<AppTopBar title="Create Group" backLabel="Back" fallbackHref="/(tabs)/groups" />);
    focusScreen();

    expect(hardwareBackHandler).toBeTruthy();
    expect(hardwareBackHandler?.()).toBe(true);
    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/groups');
  });

  /*
    🔴 Audit F10. `BackHandler` is a GLOBAL stack and this listener returns `true`, which
    consumes the press outright — so a bar registered for as long as it was MOUNTED could
    swallow Back on behalf of a screen the member was not looking at. Tabs stay mounted when
    you switch between them, and so does a stack screen with another pushed on top of it, so
    Back could run an unseen screen's fallback and send the member somewhere they had not
    asked to go.
  */
  it('does not listen for Android back before the screen is focused', () => {
    render(<AppTopBar title="Create Group" backLabel="Back" fallbackHref="/(tabs)/groups" />);

    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
    expect(hardwareBackHandler).toBeNull();
  });

  it('stops listening for Android back as soon as the screen loses focus', () => {
    render(<AppTopBar title="Create Group" backLabel="Back" fallbackHref="/(tabs)/groups" />);

    const blur = focusScreen();
    expect(hardwareBackHandler).toBeTruthy();

    blur?.();

    expect(removeHardwareBackHandler).toHaveBeenCalled();
    expect(hardwareBackHandler).toBeNull();
  });
});
