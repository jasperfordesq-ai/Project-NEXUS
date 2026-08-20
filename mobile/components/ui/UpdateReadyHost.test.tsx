// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "update ready — restart" prompt.
 *
 * The assertions worth having are all about restraint. This is the OPTIONAL half of the
 * update story, and the dangerous failure is not that it fails to appear — it is that it
 * appears too often, or blocks, or appears in development where "Restart" does nothing.
 * Any of those trains people to dismiss update prompts, which devalues
 * `UpdateRequiredScreen`, the one that genuinely matters.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockShow = jest.fn();
jest.mock('./AppToast', () => ({
  useAppToast: () => ({ show: mockShow, hide: jest.fn(), isToastVisible: false }),
}));

const mockReloadAsync = jest.fn().mockResolvedValue(undefined);
const mockReportException = jest.fn();
jest.mock('@/lib/observability/report', () => ({
  reportException: (...args: unknown[]) => mockReportException(...args),
}));

// 🔴 `mock`-prefixed on purpose: jest refuses any other out-of-scope variable inside a
// mock factory ("Invalid variable access"), which is exactly what these are.
let mockUpdatesState = { isUpdatePending: false, isUpdateAvailable: false };
let mockIsEnabled = true;

jest.mock('expo-updates', () => ({
  get isEnabled() {
    return mockIsEnabled;
  },
  useUpdates: () => mockUpdatesState,
  reloadAsync: (...args: unknown[]) => mockReloadAsync(...args),
}));

import UpdateReadyHost from './UpdateReadyHost';

/** The toast payload from the nth call. */
function toastPayload(call = 0): Record<string, unknown> {
  return mockShow.mock.calls[call]?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  mockShow.mockClear();
  mockReloadAsync.mockClear();
  mockReportException.mockClear();
  mockUpdatesState = { isUpdatePending: false, isUpdateAvailable: false };
  mockIsEnabled = true;
});

describe('UpdateReadyHost', () => {
  it('renders nothing', () => {
    const { toJSON } = render(<UpdateReadyHost />);

    expect(toJSON()).toBeNull();
  });

  it('says nothing when no update is waiting', () => {
    render(<UpdateReadyHost />);

    expect(mockShow).not.toHaveBeenCalled();
  });

  it('says nothing for an update that is merely AVAILABLE but not downloaded', () => {
    // Offering a restart before the new version is on the device would restart into the
    // same build the member is already running.
    mockUpdatesState = { isUpdatePending: false, isUpdateAvailable: true };

    render(<UpdateReadyHost />);

    expect(mockShow).not.toHaveBeenCalled();
  });

  it('🔴 offers a restart once an update is downloaded and pending', async () => {
    mockUpdatesState = { isUpdatePending: true, isUpdateAvailable: true };

    render(<UpdateReadyHost />);

    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));
    expect(toastPayload().title).toBe('Update ready');
    expect(toastPayload().actionLabel).toBe('Restart now');
  });

  it('🔴 stays out of the way — it is a toast, and dismissable', async () => {
    // Deliberately NOT blocking. UpdateRequiredScreen blocks because the server has
    // refused the build; this one is a convenience, and a blocking prompt for an optional
    // restart teaches people to dismiss the one that matters.
    mockUpdatesState = { isUpdatePending: true, isUpdateAvailable: true };

    render(<UpdateReadyHost />);

    await waitFor(() => expect(mockShow).toHaveBeenCalled());
    // Persistent so it is not missed, but still a toast the member can ignore.
    expect(toastPayload().duration).toBe('persistent');
  });

  it('🔴 announces only ONCE per pending update', async () => {
    mockUpdatesState = { isUpdatePending: true, isUpdateAvailable: true };

    const { rerender } = render(<UpdateReadyHost />);
    await waitFor(() => expect(mockShow).toHaveBeenCalledTimes(1));

    rerender(<UpdateReadyHost />);
    rerender(<UpdateReadyHost />);

    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('🔴 says nothing when updates are disabled (dev client, Expo Go)', () => {
    // Without this guard the prompt appears in development and "Restart" does nothing —
    // the fastest possible way to teach the owner to distrust it.
    mockIsEnabled = false;
    mockUpdatesState = { isUpdatePending: true, isUpdateAvailable: true };

    render(<UpdateReadyHost />);

    expect(mockShow).not.toHaveBeenCalled();
  });

  it('restarts when the action is pressed', async () => {
    mockUpdatesState = { isUpdatePending: true, isUpdateAvailable: true };

    render(<UpdateReadyHost />);
    await waitFor(() => expect(mockShow).toHaveBeenCalled());

    (toastPayload().onActionPress as () => void)();

    expect(mockReloadAsync).toHaveBeenCalledTimes(1);
  });

  it('🔴 reports rather than crashes when the restart fails', async () => {
    // reloadAsync REJECTS if updates are unavailable or a reload is already in flight. An
    // unhandled rejection on a purely optional convenience would surface as a crash.
    mockReloadAsync.mockRejectedValueOnce(new Error('cannot reload'));
    mockUpdatesState = { isUpdatePending: true, isUpdateAvailable: true };

    render(<UpdateReadyHost />);
    await waitFor(() => expect(mockShow).toHaveBeenCalled());

    expect(() => (toastPayload().onActionPress as () => void)()).not.toThrow();
    await waitFor(() => expect(mockReportException).toHaveBeenCalled());
  });
});
