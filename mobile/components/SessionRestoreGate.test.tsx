// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockAuth = {
  isLoading: false,
  isAuthenticated: false,
  sessionRestoreFailed: false,
  retrySessionRestore: jest.fn(),
  logout: jest.fn(),
};

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => mockAuth,
}));

import SessionRestoreGate from './SessionRestoreGate';

function renderGate() {
  return render(
    <SessionRestoreGate>
      <Text>App content</Text>
    </SessionRestoreGate>,
  );
}

describe('SessionRestoreGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.isLoading = false;
    mockAuth.isAuthenticated = false;
    mockAuth.sessionRestoreFailed = false;
    mockAuth.retrySessionRestore = jest.fn().mockResolvedValue(undefined);
    mockAuth.logout = jest.fn().mockResolvedValue(undefined);
  });

  it('shows the app when start-up resolved normally', () => {
    const { getByText } = renderGate();
    expect(getByText('App content')).toBeTruthy();
  });

  /**
   * 🔴 Audit 2026-09-06, F09. A member whose credentials are intact but whose phone had
   * no signal at launch must not be dropped on a login form — they cannot sign in either.
   * They are offered a retry, and signing out stays their choice.
   */
  it('replaces the app with a retry when start-up could not reach the server', () => {
    mockAuth.sessionRestoreFailed = true;
    const { queryByText, getByTestId } = renderGate();

    expect(queryByText('App content')).toBeNull();
    expect(getByTestId('session-restore-failed')).toBeTruthy();
  });

  it('retries the stored session on request', async () => {
    mockAuth.sessionRestoreFailed = true;
    const { getByTestId } = renderGate();

    fireEvent.press(getByTestId('session-restore-retry'));

    await waitFor(() => expect(mockAuth.retrySessionRestore).toHaveBeenCalledTimes(1));
    expect(mockAuth.logout).not.toHaveBeenCalled();
  });

  it('lets the member sign out instead', async () => {
    mockAuth.sessionRestoreFailed = true;
    const { getByTestId } = renderGate();

    fireEvent.press(getByTestId('session-restore-sign-out'));

    await waitFor(() => expect(mockAuth.logout).toHaveBeenCalledTimes(1));
  });

  it('gets out of the way as soon as a retry succeeds', () => {
    mockAuth.sessionRestoreFailed = false;
    mockAuth.isAuthenticated = true;
    const { getByText } = renderGate();

    expect(getByText('App content')).toBeTruthy();
  });
});
