// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Image as ExpoImage } from 'expo-image';

const mockReplace = jest.fn();
const mockSetTenantSlug = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn();
const mockLogout = jest.fn().mockResolvedValue(undefined);
/** Order matters in one of the cases below, so record the sequence, not just the calls. */
const callOrder: string[] = [];
let mockIsAuthenticated = false;
let mockApiState: {
  data: { data: Array<{ id: number; slug: string; name: string; logo_url: string | null }> } | null;
  isLoading: boolean;
  error: string | null;
} = {
  data: {
      data: [
        { id: 1, slug: 'hour-timebank', name: 'hOUR Timebank', logo_url: null },
        { id: 2, slug: 'west-cork', name: 'West Cork Timebank', logo_url: '/uploads/tenants/west-cork.png' },
      ],
  },
  isLoading: false,
  error: null,
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: () => ({ ...mockApiState, refresh: mockRefresh }),
}));

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: mockIsAuthenticated, logout: mockLogout }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({
    tenantSlug: 'hour-timebank',
    setTenantSlug: mockSetTenantSlug,
  }),
}));

jest.mock('@/lib/api/tenant', () => ({
  listTenants: jest.fn(),
}));

/*
  A faithful stand-in for the real dialog rather than an auto-confirming one: the point of
  these cases is that NOTHING happens until the member agrees, so a stub that confirms by
  itself would assert the opposite of what is being protected. It honours `visible`, shows
  the title and message, and wires each button to the handler the screen passed in.
*/
jest.mock('@/components/ui/ConfirmDialog', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      visible,
      title,
      message,
      cancelLabel,
      confirmLabel,
      cancelTestID,
      confirmTestID,
      onClose,
      onConfirm,
    }: Record<string, unknown>) =>
      visible ? (
        <View>
          <Text>{title as string}</Text>
          <Text>{message as string}</Text>
          <Pressable testID={cancelTestID as string} onPress={onClose as () => void}>
            <Text>{cancelLabel as string}</Text>
          </Pressable>
          <Pressable testID={confirmTestID as string} onPress={onConfirm as () => void}>
            <Text>{confirmLabel as string}</Text>
          </Pressable>
        </View>
      ) : null,
  };
});

import SelectTenantScreen from './select-tenant';

describe('SelectTenantScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    callOrder.length = 0;
    mockLogout.mockImplementation(async () => {
      callOrder.push('logout');
    });
    mockSetTenantSlug.mockImplementation(async () => {
      callOrder.push('setTenantSlug');
    });
    mockIsAuthenticated = false;
    mockApiState = {
      data: {
        data: [
          { id: 1, slug: 'hour-timebank', name: 'hOUR Timebank', logo_url: null },
          { id: 2, slug: 'west-cork', name: 'West Cork Timebank', logo_url: '/uploads/tenants/west-cork.png' },
        ],
      },
      isLoading: false,
      error: null,
    };
  });

  it('renders communities and the selected state', () => {
    const { getByText } = render(<SelectTenantScreen />);

    expect(getByText('Select your timebank')).toBeTruthy();
    expect(getByText('hOUR Timebank')).toBeTruthy();
    expect(getByText('West Cork Timebank')).toBeTruthy();
    expect(getByText('Current community: hOUR Timebank')).toBeTruthy();
    expect(getByText('Selected community')).toBeTruthy();
  });

  it('selects a community and returns to login', async () => {
    const { getByLabelText } = render(<SelectTenantScreen />);

    fireEvent.press(getByLabelText('West Cork Timebank'));

    await waitFor(() => expect(mockSetTenantSlug).toHaveBeenCalledWith('west-cork'));
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });

  /**
   * 🔴 This case used to assert the OPPOSITE — that a signed-in member who picks another
   * community is sent to home with the new community set — and that is precisely the dead
   * end, pinned by a passing test. Walked on a device on 2026-08-24: the app went to home,
   * every request came back 403, and the feed showed the server's own words, "Token tenant
   * does not match requested tenant", beside a Retry button that could never work.
   *
   * An account belongs to one community, so the switch has to sign the member out. Nothing
   * may change until they have been told that.
   */
  it('does not switch a signed-in member until they have agreed to be signed out', async () => {
    mockIsAuthenticated = true;
    const { getByLabelText, getByText } = render(<SelectTenantScreen />);

    fireEvent.press(getByLabelText('West Cork Timebank'));

    await waitFor(() => expect(getByText('Sign out to switch community?')).toBeTruthy());
    // One sentence naming BOTH communities, so the member knows what they are leaving and
    // what they are joining — not a bare "are you sure?".
    expect(
      getByText(/Your account is with hOUR Timebank\. To use West Cork Timebank/),
    ).toBeTruthy();

    expect(mockSetTenantSlug).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('signs out BEFORE changing community, then sends them to sign in', async () => {
    mockIsAuthenticated = true;
    const { getByLabelText, getByTestId } = render(<SelectTenantScreen />);

    fireEvent.press(getByLabelText('West Cork Timebank'));
    await waitFor(() => expect(getByTestId('tenant-switch-confirm')).toBeTruthy());
    fireEvent.press(getByTestId('tenant-switch-confirm'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(mockSetTenantSlug).toHaveBeenCalledWith('west-cork');

    /*
      🔴 The load-bearing assertion. `logout()` calls the server, and that call is only
      valid while the stored community is still the one that issued the token. Change the
      community first and the sign-out itself is refused with the same 403, leaving a live
      session behind on the server.
    */
    expect(callOrder).toEqual(['logout', 'setTenantSlug']);
  });

  it('leaves everything alone if they decide not to switch', async () => {
    mockIsAuthenticated = true;
    const { getByLabelText, getByTestId } = render(<SelectTenantScreen />);

    fireEvent.press(getByLabelText('West Cork Timebank'));
    await waitFor(() => expect(getByTestId('tenant-switch-cancel')).toBeTruthy());
    fireEvent.press(getByTestId('tenant-switch-cancel'));

    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockSetTenantSlug).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not sign anyone out for choosing the community they are already in', async () => {
    mockIsAuthenticated = true;
    const { getByLabelText } = render(<SelectTenantScreen />);

    fireEvent.press(getByLabelText('hOUR Timebank'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/home'));
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('shows a retry state when communities fail to load', () => {
    mockApiState = { data: null, isLoading: false, error: 'Network unavailable' };
    const { getByText } = render(<SelectTenantScreen />);

    expect(getByText('Could not load communities')).toBeTruthy();
    expect(getByText('Network unavailable')).toBeTruthy();

    fireEvent.press(getByText('Retry'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('resolves relative tenant logo URLs', () => {
    const { UNSAFE_getAllByType } = render(<SelectTenantScreen />);

    expect(UNSAFE_getAllByType(ExpoImage)[0].props.source.uri).toBe(
      'https://api.project-nexus.ie/uploads/tenants/west-cork.png',
    );
  });
});
