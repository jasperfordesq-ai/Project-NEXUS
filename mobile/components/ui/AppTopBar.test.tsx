// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { BackHandler, Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import AppTopBar from './AppTopBar';

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
}));

describe('AppTopBar', () => {
  let hardwareBackHandler: (() => boolean) | null = null;
  const removeHardwareBackHandler = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    hardwareBackHandler = null;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => 'android',
    });
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_eventName, handler) => {
      hardwareBackHandler = () => handler() === true;
      return {
        remove: () => {
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

    expect(router.replace).toHaveBeenCalledWith('/(tabs)/groups');
  });

  it('maps Android hardware back to the same fallback navigation', () => {
    render(<AppTopBar title="Create Group" backLabel="Back" fallbackHref="/(tabs)/groups" />);

    expect(hardwareBackHandler).toBeTruthy();
    expect(hardwareBackHandler?.()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/groups');
  });
});
