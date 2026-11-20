// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockAuth = {
  isAuthenticated: true,
  logout: jest.fn(),
};

const mockTenant: {
  tenant: { slug: string; name: string; billing_paused?: boolean } | null;
  tenantSlug: string;
} = {
  tenant: { slug: 'hour-timebank', name: 'hOUR Timebank' },
  tenantSlug: 'hour-timebank',
};

let mockPathname = '/home';
const mockReplace = jest.fn();
const mockReleaseSplash = jest.fn();

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => mockAuth,
}));
jest.mock('@/lib/context/TenantContext', () => ({
  ...jest.requireActual('@/lib/context/TenantContext'),
  useTenantContext: () => mockTenant,
}));
jest.mock('expo-router', () => ({
  usePathname: () => mockPathname,
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('@/lib/ui/splash', () => ({
  releaseSplash: () => mockReleaseSplash(),
}));

import CommunityPausedGate from './CommunityPausedGate';
import { communityPausedStore } from '@/lib/billing/communityPausedStore';

function renderGate() {
  return render(
    <CommunityPausedGate>
      <Text>App content</Text>
    </CommunityPausedGate>,
  );
}

describe('CommunityPausedGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    communityPausedStore.__resetForTests();
    mockAuth.isAuthenticated = true;
    mockAuth.logout = jest.fn().mockResolvedValue(undefined);
    mockTenant.tenant = { slug: 'hour-timebank', name: 'hOUR Timebank' };
    mockTenant.tenantSlug = 'hour-timebank';
    mockPathname = '/home';
  });

  it('shows the app when the community is not paused', () => {
    const { getByText, queryByTestId } = renderGate();
    expect(getByText('App content')).toBeTruthy();
    expect(queryByTestId('community-paused-screen')).toBeNull();
  });

  it('replaces the app when the bootstrap says the community is paused', () => {
    mockTenant.tenant = { slug: 'hour-timebank', name: 'hOUR Timebank', billing_paused: true };
    const { queryByText, getByTestId, getByText } = renderGate();

    expect(queryByText('App content')).toBeNull();
    expect(getByTestId('community-paused-screen')).toBeTruthy();
    expect(getByText('hOUR Timebank is paused')).toBeTruthy();
    expect(getByText('This community is not available at the moment. Please contact its organisers.')).toBeTruthy();
  });

  /** Members are never told the pause is about money. */
  it('never mentions payment', () => {
    mockTenant.tenant = { slug: 'hour-timebank', name: 'hOUR Timebank', billing_paused: true };
    const { toJSON } = renderGate();
    expect(JSON.stringify(toJSON())).not.toMatch(/pay|bill|money|invoice/i);
  });

  it('replaces the app as soon as any request is refused with COMMUNITY_PAUSED', () => {
    const { getByTestId, queryByText } = renderGate();
    expect(queryByText('App content')).toBeTruthy();

    act(() => communityPausedStore.markPaused('hour-timebank'));

    expect(getByTestId('community-paused-screen')).toBeTruthy();
    expect(queryByText('App content')).toBeNull();
  });

  it('names the community generically when its details could not be loaded', () => {
    mockTenant.tenant = null;
    communityPausedStore.markPaused('hour-timebank');
    const { getByText } = renderGate();
    expect(getByText('This community is paused')).toBeTruthy();
  });

  it('ignores a pause recorded for a community that is no longer selected', () => {
    communityPausedStore.markPaused('another-community');
    const { getByText } = renderGate();
    expect(getByText('App content')).toBeTruthy();
  });

  /**
   * 🔴 The screen must never sign anyone out by itself. Signing out is the member's
   * choice, made with the button.
   */
  it('offers a signed-in member a sign-out, and only signs out when pressed', async () => {
    communityPausedStore.markPaused('hour-timebank');
    const { getByTestId } = renderGate();

    expect(mockAuth.logout).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('community-paused-sign-out'));

    await waitFor(() => expect(mockAuth.logout).toHaveBeenCalledTimes(1));
  });

  it('offers no sign-out to someone who is not signed in', () => {
    mockAuth.isAuthenticated = false;
    communityPausedStore.markPaused('hour-timebank');
    const { queryByTestId, getByTestId } = renderGate();

    expect(queryByTestId('community-paused-sign-out')).toBeNull();
    expect(getByTestId('community-paused-choose-community')).toBeTruthy();
  });

  it('lets the member go to the community picker', async () => {
    communityPausedStore.markPaused('hour-timebank');
    const { getByTestId, getByText } = renderGate();

    fireEvent.press(getByTestId('community-paused-choose-community'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/select-tenant'));
    // The picker has to be able to render, so the app is let through while it opens.
    expect(getByText('App content')).toBeTruthy();
  });

  it('keeps out of the way on the community picker itself', () => {
    mockPathname = '/select-tenant';
    communityPausedStore.markPaused('hour-timebank');
    const { getByText } = renderGate();
    expect(getByText('App content')).toBeTruthy();
  });

  it('lets the splash go, because the screens that normally release it are not mounted', () => {
    communityPausedStore.markPaused('hour-timebank');
    renderGate();
    expect(mockReleaseSplash).toHaveBeenCalled();
  });

  /**
   * A fresh bootstrap that no longer says paused means the community was restored.
   * Without this the member would stay on the paused screen until the app restarted.
   */
  it('forgets a recorded pause when a fresh bootstrap says the community is open', () => {
    communityPausedStore.markPaused('hour-timebank');
    mockTenant.tenant = { slug: 'hour-timebank', name: 'hOUR Timebank', billing_paused: true };
    const view = renderGate();
    expect(view.getByTestId('community-paused-screen')).toBeTruthy();

    mockTenant.tenant = { slug: 'hour-timebank', name: 'hOUR Timebank' };
    view.rerender(
      <CommunityPausedGate>
        <Text>App content</Text>
      </CommunityPausedGate>,
    );

    expect(communityPausedStore.getSnapshot()).toBeNull();
    expect(view.getByText('App content')).toBeTruthy();
  });

  /** The screen makes no requests of its own, so it cannot loop. */
  it('does not re-fetch anything while shown', () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    communityPausedStore.markPaused('hour-timebank');
    renderGate();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
