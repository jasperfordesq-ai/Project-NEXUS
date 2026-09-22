// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetWorkspace = jest.fn();
const mockGetConflicts = jest.fn();
const mockPurgeExpired = jest.fn();
const mockLoadSessionForReview = jest.fn();
const mockPurgeSession = jest.fn();
const mockConfirm = jest.fn();
const mockShowToast = jest.fn();
const mockCameraPermission = jest.fn();
const mockGetCameraPermission = jest.fn();
let mockPermissionState = { granted: false, canAskAgain: true };
const mockPendingRegistration = jest.fn();
const mockReserveRegistration = jest.fn();
const mockRecoverRegistration = jest.fn();
const mockCompleteRegistration = jest.fn();
const mockCacheWorkspace = jest.fn();
const mockCachedWorkspace = jest.fn();
const mockInvalidateCache = jest.fn();
const mockReconcileConflicts = jest.fn();
jest.mock('@/lib/offlineRegistrationRecovery', () => ({ recoverOfflineRegistration: (...args: unknown[]) => mockRecoverRegistration(...args) }));

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  downloadOfflineCheckinManifest: jest.fn(),
  getOfflineCheckinConflicts: (...args: unknown[]) => mockGetConflicts(...args),
  getOfflineCheckinWorkspace: (...args: unknown[]) => mockGetWorkspace(...args),
  registerOfflineCheckinDevice: jest.fn(),
  resolveOfflineCheckinConflict: jest.fn(),
  revokeOfflineCheckinDevice: jest.fn(),
}));

jest.mock('@/lib/eventOfflineCheckinStore', () => ({
  cacheMobileOfflineWorkspace: (...args: unknown[]) => mockCacheWorkspace(...args),
  loadCachedMobileOfflineWorkspace: (...args: unknown[]) => mockCachedWorkspace(...args),
  invalidateCachedMobileOfflineWorkspace: (...args: unknown[]) => mockInvalidateCache(...args),
  getPendingOfflineRegistration: (...args: unknown[]) => mockPendingRegistration(...args),
  reserveOfflineRegistration: (...args: unknown[]) => mockReserveRegistration(...args),
  completeOfflineRegistration: (...args: unknown[]) => mockCompleteRegistration(...args),
  activateMobileOfflineSession: jest.fn(),
  enqueueMobileOfflineCredential: jest.fn(),
  loadMobileOfflineSessionForReview: (...args: unknown[]) => mockLoadSessionForReview(...args),
  purgeMobileOfflineSession: (...args: unknown[]) => mockPurgeSession(...args),
  purgeRevokedOrExpiredMobileSessions: (...args: unknown[]) => mockPurgeExpired(...args),
  refreshMobileOfflineManifest: jest.fn(),
  syncMobileOfflineSession: jest.fn(),
  reconcileMobileOfflineConflicts: (...args: unknown[]) => mockReconcileConflicts(...args),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>Camera active</Text>;
  },
  useCameraPermissions: () => [mockPermissionState, mockCameraPermission, mockGetCameraPermission],
}));

jest.mock('@/components/ui/Icon', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), confirmDialog: null }),
}));
jest.mock('@/components/ui/AccentIcon', () => () => null);
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#2563eb' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options && 'count' in options ? `${key}:${String(options.count)}`
        : options && 'state' in options ? `${key}:${String(options.state)}` : key
    ),
  }),
}));

import EventOfflineCheckinCard from './EventOfflineCheckinCard';
import { ApiResponseError } from '@/lib/api/client';

const emptyWorkspace = {
  event_id: 77,
  manifest_version: 3,
  devices: [],
};

describe('EventOfflineCheckinCard', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    mockGetCameraPermission.mockResolvedValue({ granted: true });
    mockPermissionState = { granted: false, canAskAgain: true };
    mockCacheWorkspace.mockImplementation(async session => session);
    mockReconcileConflicts.mockImplementation(async session => session);
    mockCachedWorkspace.mockResolvedValue({ session: null, workspace: null, inactive: null });
    mockInvalidateCache.mockResolvedValue(undefined);
    mockGetWorkspace.mockResolvedValue(emptyWorkspace);
    mockGetConflicts.mockResolvedValue({ items: [] });
    mockPurgeExpired.mockResolvedValue(undefined);
    mockLoadSessionForReview.mockResolvedValue({ session: null, inactive: null });
    mockPurgeSession.mockResolvedValue(undefined);
    mockCameraPermission.mockResolvedValue({ granted: true });
    mockPendingRegistration.mockResolvedValue(null);
    mockReserveRegistration.mockResolvedValue({ eventId: 77, label: 'Door tablet', stage: 'register' });
    mockCompleteRegistration.mockResolvedValue(undefined);
  });

  it.each([0, 502, 503, 504])('restores saved attendance only for unavailable-server status %s', async status => {
    mockGetWorkspace.mockRejectedValue(new ApiResponseError(status, 'Unavailable'));
    mockCachedWorkspace.mockResolvedValue({ workspace: emptyWorkspace, inactive: null, session: {
      eventId: 77, deviceId: 5, manifest: { manifest_version: 3 },
      queue: [{ clientNonce: 'saved', displayName: 'Saved attendee', operation: 'check_in', state: 'pending' }],
    } });
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    expect(await screen.findByTestId('offline-cached-workspace')).toBeTruthy();
    expect(screen.getByText('Saved attendee')).toBeTruthy();
    expect(screen.getByText('scan.title')).toBeTruthy();
    expect(screen.queryByText('device.title')).toBeNull();
    expect(screen.queryByText('conflicts.title')).toBeNull();
    expect(mockGetConflicts).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 422])('does not restore cached authority after server refusal %s', async status => {
    mockGetWorkspace.mockRejectedValue(new ApiResponseError(status, 'Refused'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    expect(await screen.findByText('workspace.loadErrorTitle')).toBeTruthy();
    expect(mockCachedWorkspace).not.toHaveBeenCalled();
    if (status !== 422) expect(mockInvalidateCache).toHaveBeenCalledWith(77);
  });

  it('shows expired cached attendance read-only and ignores a late cache after departure', async () => {
    mockGetWorkspace.mockRejectedValue(new ApiResponseError(0, 'Offline'));
    const cached = { workspace: emptyWorkspace, inactive: 'manifest_expired', session: {
      eventId: 77, deviceId: 5, manifest: { manifest_version: 3 }, queue: [],
    } };
    mockCachedWorkspace.mockResolvedValueOnce(cached);
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    expect(await screen.findByTestId('event-offline-checkin-read-only')).toBeTruthy();
    expect(screen.queryByText('scan.title')).toBeNull();
    screen.unmount();
    let finish!: (value: unknown) => void;
    mockCachedWorkspace.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const departed = render(<EventOfflineCheckinCard eventId={77} />);
    await waitFor(() => expect(finish).toBeDefined());
    departed.unmount();
    await act(async () => { finish(cached); });
    expect(mockGetConflicts).not.toHaveBeenCalled();
  });

  it('loads the event workspace, purges stale device data, and shows an honest not-ready state', async () => {
    const { findByText } = render(<EventOfflineCheckinCard eventId={77} />);

    expect(await findByText('workspace.title')).toBeTruthy();
    expect(await findByText('device.empty')).toBeTruthy();
    expect(await findByText('workspace.notReady')).toBeTruthy();
    expect(await findByText('conflicts.empty')).toBeTruthy();
    expect(mockGetWorkspace).toHaveBeenCalledWith(77);
    expect(mockPurgeExpired).toHaveBeenCalledWith(emptyWorkspace);
  });

  it.each(['granted', 'settings failure'])('recovers permanent camera refusal: %s', async scenario => {
    mockPermissionState = { granted: false, canAskAgain: false };
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, label: 'Door', status: 'active' }] });
    mockLoadSessionForReview.mockResolvedValue({ inactive: null, session: {
      eventId: 77, deviceId: 5, manifest: { manifest_version: 3 }, queue: [],
    } });
    let resume: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { resume = callback; return { remove: jest.fn() }; });
    const settings = jest.spyOn(Linking, 'openSettings');
    if (scenario === 'settings failure') settings.mockRejectedValue(new Error('unavailable'));
    else settings.mockResolvedValue(undefined);
    try {
      const screen = render(<EventOfflineCheckinCard eventId={77} />);
      fireEvent.press(await screen.findByText('notifications:permissionCard.openSettings'));
      await waitFor(() => expect(settings).toHaveBeenCalledTimes(1));
      expect(mockCameraPermission).not.toHaveBeenCalled();
      expect(screen.queryByText('Camera active')).toBeNull();
      if (scenario === 'settings failure') {
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'scan.cameraUnavailable' })));
      } else {
        await act(async () => resume?.('active'));
        expect(mockGetCameraPermission).toHaveBeenCalledTimes(1);
        mockPermissionState = { granted: true, canAskAgain: true };
        screen.rerender(<EventOfflineCheckinCard eventId={77} />);
        fireEvent.press(screen.getByText('scan.openCamera'));
        expect(await screen.findByText('Camera active')).toBeTruthy();
        expect(mockCameraPermission).not.toHaveBeenCalled();
      }
    } finally { settings.mockRestore(); }
  });

  it.each(['refused', 'error', 'departed', 'double tap'])('handles camera permission: %s', async (scenario) => {
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, label: 'Door', status: 'active' }] });
    mockLoadSessionForReview.mockResolvedValue({ inactive: null, session: {
      eventId: 77, deviceId: 5, manifest: { manifest_version: 3 }, queue: [],
    } });
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    mockCameraPermission.mockImplementation(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    const button = await screen.findByText('scan.openCamera');
    act(() => { fireEvent.press(button); if (scenario === 'double tap') fireEvent.press(button); });
    if (scenario === 'departed') screen.unmount();
    await act(async () => {
      if (scenario === 'error') fail(new Error('permission service unavailable'));
      else finish({ granted: scenario !== 'refused' });
    });
    expect(mockCameraPermission).toHaveBeenCalledTimes(1);
    if (scenario === 'double tap') expect(screen.getByText('Camera active')).toBeTruthy();
    else if (scenario === 'departed') expect(mockShowToast).not.toHaveBeenCalled();
    else {
      expect(screen.queryByText('Camera active')).toBeNull();
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'scan.cameraUnavailable' }));
    }
  });

  it('shows a visible load failure and retries the actual request', async () => {
    mockGetWorkspace.mockRejectedValueOnce(new Error('offline'));
    const { findByText, getByText } = render(<EventOfflineCheckinCard eventId={77} />);

    expect(await findByText('workspace.loadErrorTitle')).toBeTruthy();
    expect(getByText('workspace.loadErrorDescription')).toBeTruthy();
    fireEvent.press(getByText('workspace.retry'));

    expect(await findByText('workspace.title')).toBeTruthy();
    await waitFor(() => expect(mockGetWorkspace).toHaveBeenCalledTimes(2));
  });

  it('registers only once when the button is pressed twice before rendering busy state', async () => {
    let fail!: (error: Error) => void;
    mockRecoverRegistration.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByText('device.empty');
    fireEvent.changeText(screen.getByPlaceholderText('device.labelPlaceholder'), 'Door tablet');
    act(() => {
      fireEvent.press(screen.getByText('device.register'));
      fireEvent.press(screen.getByText('device.register'));
    });
    await waitFor(() => expect(mockRecoverRegistration).toHaveBeenCalledTimes(1));
    await act(async () => { fail(new Error('offline')); });
    expect(mockReserveRegistration).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch registration when reservation finishes after departure', async () => {
    let finish!: (value: unknown) => void;
    mockReserveRegistration.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByText('device.empty');
    fireEvent.changeText(screen.getByPlaceholderText('device.labelPlaceholder'), 'Door tablet');
    fireEvent.press(screen.getByText('device.register'));
    screen.unmount();
    await act(async () => { finish({ device: { secret: 'test-device' } }); });
    expect(mockRecoverRegistration).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it.each(['register', 'reauthorize'])('restores %s recovery without dispatch even when workspace loading fails', async (stage) => {
    mockPendingRegistration.mockResolvedValue({ eventId: 77, label: 'Saved door', stage });
    mockGetWorkspace.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByTestId('offline-registration-recovery');
    expect(screen.getByText('Saved door')).toBeTruthy();
    expect(mockRecoverRegistration).not.toHaveBeenCalled();
    mockRecoverRegistration.mockResolvedValue({ pending: null, session: { queue: [] }, workspace: emptyWorkspace });
    fireEvent.press(screen.getByText(stage === 'reauthorize' ? 'recovery.reauthorize' : 'recovery.resume'));
    await waitFor(() => expect(mockRecoverRegistration).toHaveBeenCalledWith(77, stage === 'reauthorize' ? 'reauthorize' : 'resume', expect.any(Function)));
    await waitFor(() => expect(screen.queryByTestId('offline-registration-recovery')).toBeNull());
    expect(mockReserveRegistration).not.toHaveBeenCalled();
  });

  it('blocks another registration while a saved request is unresolved', async () => {
    mockPendingRegistration.mockResolvedValue({ eventId: 77, label: 'Saved door', stage: 'register' });
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByTestId('offline-registration-recovery');
    fireEvent.changeText(screen.getByPlaceholderText('device.labelPlaceholder'), 'Other door');
    fireEvent.press(screen.getByText('device.register'));
    expect(mockReserveRegistration).not.toHaveBeenCalled();
    expect(mockRecoverRegistration).not.toHaveBeenCalled();
  });

  it('shows the saved recovery step after a partially completed attempt fails', async () => {
    const saved = { eventId: 77, label: 'Door tablet', stage: 'activate', secret: 'never-display-this' };
    mockRecoverRegistration.mockImplementationOnce(async () => {
      mockPendingRegistration.mockResolvedValue(saved);
      throw new Error('manifest unavailable');
    });
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByText('device.empty');
    fireEvent.changeText(screen.getByPlaceholderText('device.labelPlaceholder'), 'Door tablet');
    fireEvent.press(screen.getByText('device.register'));
    await screen.findByTestId('offline-registration-recovery');
    expect(screen.getByText('recovery.resume')).toBeTruthy();
    expect(screen.queryByText('never-display-this')).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('does not expose registration controls when reading pending storage fails', async () => {
    mockPendingRegistration.mockRejectedValueOnce(new Error('storage unavailable'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByText('workspace.loadErrorTitle');
    expect(screen.queryByText('device.register')).toBeNull();
    expect(mockRecoverRegistration).not.toHaveBeenCalled();
  });

  it.each([null, 'manifest_expired'])('allows checking a processing batch even if no local item remains pending (%s)', async inactive => {
    const { syncMobileOfflineSession } = require('@/lib/eventOfflineCheckinStore');
    const session = { eventId: 77, deviceId: 5, manifest: { manifest_version: 3 },
      queue: [], activeBatchId: 'still-processing', activeBatchNonces: ['one'] };
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, label: 'Door', status: 'active' }] });
    mockLoadSessionForReview.mockResolvedValue({ session, inactive });
    syncMobileOfflineSession.mockResolvedValue({ session, batch: { batch: { status: 'processing' } } });
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    fireEvent.press(await screen.findByText(inactive ? 'queue.checkResult' : 'queue.sync'));
    if (inactive) expect(screen.queryByText('scan.title')).toBeNull();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'queue.processing' })));
    expect(syncMobileOfflineSession).toHaveBeenCalledTimes(1);
  });

  it('shows stopped processing after restoration and warns instead of claiming progress', async () => {
    const { syncMobileOfflineSession } = require('@/lib/eventOfflineCheckinStore');
    const session = { eventId: 77, deviceId: 5, manifest: { manifest_version: 3 },
      queue: [], activeBatchId: 'stopped-batch', activeBatchNonces: ['one'], activeBatchStatus: 'dead_letter' };
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, label: 'Door', status: 'active' }] });
    mockLoadSessionForReview.mockResolvedValue({ session, inactive: null });
    syncMobileOfflineSession.mockResolvedValue({ session, batch: { batch: { status: 'dead_letter' } } });
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    expect(await screen.findByTestId('offline-batch-stopped')).toBeTruthy();
    expect(screen.getByText('queue.stoppedDescription')).toBeTruthy();
    fireEvent.press(screen.getByText('queue.checkResult'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith({ title: 'queue.stoppedTitle', variant: 'warning' }));
    expect(screen.queryByText('queue.processing')).toBeNull();
  });

  it.each(['confirmed', 'departed', 'failed'])('stops only the pending setup after confirmation: %s', async (outcome) => {
    const pending = { eventId: 77, label: 'Saved door', stage: 'reauthorize' };
    mockPendingRegistration.mockResolvedValue(pending);
    mockGetWorkspace.mockRejectedValueOnce(new Error('not permitted'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByTestId('offline-registration-recovery');
    fireEvent.press(screen.getByText('recovery.stop'));
    expect(mockCompleteRegistration).not.toHaveBeenCalled();
    const confirmation = mockConfirm.mock.calls[0][0];
    expect(confirmation.message).toBe('recovery.stopDescription');
    if (outcome === 'departed') screen.unmount();
    if (outcome === 'failed') mockCompleteRegistration.mockRejectedValueOnce(new Error('storage failure'));
    if (outcome === 'confirmed') mockPendingRegistration.mockResolvedValue(null);
    await act(async () => { await confirmation.onConfirm(); });
    expect(mockPurgeSession).not.toHaveBeenCalled();
    if (outcome === 'departed') expect(mockCompleteRegistration).not.toHaveBeenCalled();
    else {
      expect(mockCompleteRegistration).toHaveBeenCalledWith(pending);
      if (outcome === 'confirmed') expect(screen.queryByTestId('offline-registration-recovery')).toBeNull();
      else expect(screen.getByTestId('offline-registration-recovery')).toBeTruthy();
    }
  });

  it.each(['syncing', 'departed'])('ignores a pending purge confirmation while %s', async (state) => {
    const { syncMobileOfflineSession } = require('@/lib/eventOfflineCheckinStore');
    const session = {
      eventId: 77, deviceId: 5, manifest: { manifest_version: 3 },
      queue: [{ clientNonce: 'n1', displayName: 'Ada', operation: 'check_in', state: 'pending' }],
    };
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, label: 'Door', status: 'active' }] });
    mockLoadSessionForReview.mockResolvedValue({ session, inactive: null });
    let finish!: (value: unknown) => void;
    jest.mocked(syncMobileOfflineSession).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await screen.findByText('Ada');
    fireEvent.press(screen.getByTestId('event-offline-checkin-purge'));
    const confirmation = mockConfirm.mock.calls[0][0];
    if (state === 'syncing') {
      act(() => {
        fireEvent.press(screen.getByText('queue.sync'));
        fireEvent.press(screen.getByText('queue.sync'));
      });
      expect(syncMobileOfflineSession).toHaveBeenCalledTimes(1);
    } else {
      screen.unmount();
    }
    await act(async () => { await confirmation.onConfirm(); });
    expect(mockPurgeSession).not.toHaveBeenCalled();
    if (state === 'syncing') {
      await act(async () => { finish({ session, batch: null }); });
      await act(async () => { await confirmation.onConfirm(); });
      expect(mockPurgeSession).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('event-offline-checkin-purge'));
      await act(async () => { await mockConfirm.mock.calls.at(-1)[0].onConfirm(); });
      expect(mockPurgeSession).toHaveBeenCalledTimes(1);
    }
  });

  it('does not process device storage when a workspace response arrives after departure', async () => {
    let finish!: (value: unknown) => void;
    mockGetWorkspace.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    screen.unmount();
    await act(async () => { finish(emptyWorkspace); });
    expect(mockPurgeExpired).not.toHaveBeenCalled();
    expect(mockGetConflicts).not.toHaveBeenCalled();
  });

  it('keeps the latest retry when an older workspace request fails later', async () => {
    mockGetWorkspace.mockRejectedValueOnce(new Error('initial failure'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    const retry = await screen.findByText('workspace.retry');
    let failOlder!: (error: Error) => void;
    mockGetWorkspace.mockImplementationOnce(() => new Promise((_resolve, reject) => { failOlder = reject; }));
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await screen.findByText('device.empty');
    await act(async () => { failOlder(new Error('late failure')); });
    expect(screen.queryByText('workspace.loadErrorTitle')).toBeNull();
    expect(screen.getByText('device.empty')).toBeTruthy();
  });

  it('keeps current conflicts when an older conflict retry fails later', async () => {
    mockGetConflicts.mockRejectedValueOnce(new Error('initial failure'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    const retry = await screen.findByText('workspace.retry');
    let failOlder!: (error: Error) => void;
    mockGetConflicts.mockImplementationOnce(() => new Promise((_resolve, reject) => { failOlder = reject; }));
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await screen.findByText('conflicts.empty');
    await act(async () => { failOlder(new Error('late failure')); });
    expect(screen.getByText('conflicts.empty')).toBeTruthy();
    expect(screen.queryByText('workspace.retry')).toBeNull();
  });

  it('does not process a stale successful workspace after a newer retry completes', async () => {
    mockGetWorkspace.mockRejectedValueOnce(new Error('initial failure'));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    const retry = await screen.findByText('workspace.retry');
    let finishOlder!: (value: unknown) => void;
    mockGetWorkspace.mockImplementationOnce(() => new Promise((resolve) => { finishOlder = resolve; }));
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await screen.findByText('device.empty');
    await act(async () => {
      finishOlder({ ...emptyWorkspace, devices: [{ id: 9, label: 'Obsolete device', version: 1, status: 'active' }] });
    });
    expect(screen.queryByText('Obsolete device')).toBeNull();
    expect(mockPurgeExpired).toHaveBeenCalledTimes(1);
    expect(mockLoadSessionForReview).not.toHaveBeenCalled();
  });

  it('does not download or refresh a manifest when session review finishes after departure', async () => {
    const { downloadOfflineCheckinManifest } = require('@/lib/api/eventOfflineCheckin');
    const { refreshMobileOfflineManifest } = require('@/lib/eventOfflineCheckinStore');
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, status: 'active' }] });
    let finishReview!: (value: unknown) => void;
    mockLoadSessionForReview.mockImplementationOnce(() => new Promise((resolve) => { finishReview = resolve; }));
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    await waitFor(() => expect(mockLoadSessionForReview).toHaveBeenCalled());
    screen.unmount();
    await act(async () => {
      finishReview({ inactive: null, session: { manifest: { manifest_version: 2 }, deviceSecret: 'test-secret' } });
    });
    expect(downloadOfflineCheckinManifest).not.toHaveBeenCalled();
    expect(refreshMobileOfflineManifest).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  /**
   * 🔴 S4-19. An expired roster used to be purged on load along with every never-synced
   * check-in, silently. It now stays on the device read-only: the pending count is
   * announced, nothing new can be scanned, and the data leaves only after the member
   * confirms a purge that names what will be lost.
   */
  it('keeps an expired session read-only, announces the unsynced count, and purges only after confirmation', async () => {
    mockGetWorkspace.mockResolvedValue({
      ...emptyWorkspace,
      devices: [{ id: 5, label: 'Door tablet', version: 1, status: 'active' }],
    });
    const pendingItem = {
      clientNonce: 'n1', registrationId: 1, userId: 9, displayName: 'Ada', operation: 'check_in',
      observedAt: '2026-09-01T18:05:00Z', expectedAttendanceVersion: 1, credentialFingerprint: 'abcdef0123456789',
      credentialHashReference: 'a'.repeat(64), reason: null, state: 'pending', code: null, decisionVersion: null,
    };
    mockLoadSessionForReview.mockResolvedValue({
      inactive: 'manifest_expired',
      session: {
        eventId: 77, deviceId: 5, deviceVersion: 1, deviceSecret: 'nxd1_secret', replayWindowMinutes: 1440,
        batchMaxItems: 500, manifest: { manifest_version: 3, device: { id: 5, version: 1 }, expires_at: '2000-01-01T00:00:00Z' },
        queue: [pendingItem, { ...pendingItem, clientNonce: 'n2', displayName: 'Bea' }],
        activeBatchId: null, activeBatchNonces: [], updatedAt: '2026-09-01T18:05:00Z',
      },
    });

    const { findByTestId, getByTestId, queryByText, getByText } = render(<EventOfflineCheckinCard eventId={77} />);

    expect(await findByTestId('event-offline-checkin-read-only')).toBeTruthy();
    expect(getByText('queue.readOnlyExpired')).toBeTruthy();
    // The queue is still listed; scanning is not offered.
    expect(getByText('Ada')).toBeTruthy();
    expect(queryByText('scan.title')).toBeNull();
    // The member is told how many check-ins are waiting, and nothing was deleted.
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'queue.pendingKept:2', variant: 'warning' }));
    expect(mockPurgeSession).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('event-offline-checkin-purge'));
    expect(mockPurgeSession).not.toHaveBeenCalled();
    const options = mockConfirm.mock.calls[0][0] as { message: string; onConfirm: () => Promise<void> };
    expect(options.message).toContain('queue.purgePendingWarning:2');

    await act(async () => { await options.onConfirm(); });
    expect(mockPurgeSession).toHaveBeenCalledWith(77, 5);
  });

  /**
   * 🔴 A 403 during sync used to purge the encrypted queue on the spot — every never-synced
   * check-in gone (audit 2026-09-07, C/F-4). The session is now kept read-only and only the
   * confirmed purge removes it.
   */
  it('keeps the queue when the server refuses a sync with 403', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    const { syncMobileOfflineSession } = require('@/lib/eventOfflineCheckinStore');
    mockGetWorkspace.mockResolvedValue({
      ...emptyWorkspace,
      devices: [{ id: 5, label: 'Door tablet', version: 1, status: 'active' }],
    });
    const pendingItem = {
      clientNonce: 'n1', registrationId: 1, userId: 9, displayName: 'Ada', operation: 'check_in',
      observedAt: '2026-09-01T18:05:00Z', expectedAttendanceVersion: 1, credentialFingerprint: 'abcdef0123456789',
      credentialHashReference: 'a'.repeat(64), reason: null, state: 'pending', code: null, decisionVersion: null,
    };
    mockLoadSessionForReview.mockResolvedValue({
      inactive: null,
      session: {
        eventId: 77, deviceId: 5, deviceVersion: 1, deviceSecret: 'nxd1_secret', replayWindowMinutes: 1440,
        batchMaxItems: 500, manifest: { manifest_version: 3, device: { id: 5, version: 1 }, expires_at: '2099-01-01T00:00:00Z' },
        queue: [pendingItem],
        activeBatchId: null, activeBatchNonces: [], updatedAt: '2026-09-01T18:05:00Z',
      },
    });
    jest.mocked(syncMobileOfflineSession).mockRejectedValueOnce(new ApiResponseError(403, 'Device revoked'));

    const { findByText, getByText, findByTestId } = render(<EventOfflineCheckinCard eventId={77} />);

    fireEvent.press(await findByText('queue.sync'));

    expect(await findByTestId('event-offline-checkin-read-only')).toBeTruthy();
    expect(getByText('queue.readOnlyRevoked')).toBeTruthy();
    expect(getByText('Ada')).toBeTruthy();
    expect(mockPurgeSession).not.toHaveBeenCalled();
  });
});


describe('resolved conflict queue presentation', () => {
  it.each(['reopen', 'resolve'])('reconciles a saved conflict on %s without resending attendance', async scenario => {
    jest.resetAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
    const saved = { eventId: 77, deviceId: 5, manifest: { manifest_version: 3 }, queue: [
      { clientNonce: 'saved-conflict', displayName: 'Ada', operation: 'undo', state: 'conflict' },
    ] };
    mockGetWorkspace.mockResolvedValue({ ...emptyWorkspace, devices: [{ id: 5, status: 'active' }] });
    mockPendingRegistration.mockResolvedValue(null);
    mockLoadSessionForReview.mockResolvedValue({ session: saved, inactive: null });
    mockCacheWorkspace.mockImplementation(async value => value);
    mockReconcileConflicts.mockResolvedValue({ ...saved, queue: [{ ...saved.queue[0], state: 'rejected' }] });
    mockGetConflicts.mockResolvedValue({ items: [] });
    if (scenario === 'resolve') {
      mockReconcileConflicts.mockResolvedValueOnce(saved);
      mockGetConflicts.mockResolvedValue({ items: [{ item_id: 8, member: { display_name: 'Ada' }, current_attendance: { state: 'checked_in', version: 3 }, conflict: { decision_version: 1 } }] });
      require('@/lib/api/eventOfflineCheckin').resolveOfflineCheckinConflict.mockResolvedValue({ items: [] });
    }
    const screen = render(<EventOfflineCheckinCard eventId={77} />);
    if (scenario === 'resolve') {
      await screen.findByText('conflicts.reject');
      expect(screen.getByText('conflicts.current:events:attendance.states.checked_in')).toBeTruthy();
      fireEvent.changeText(screen.getByLabelText('conflicts.reason'), 'Keep the verified record');
      fireEvent.press(screen.getByText('conflicts.reject'));
    }
    expect(await screen.findByText('queue.states.rejected')).toBeTruthy();
    expect(screen.queryByText('queue.states.conflict')).toBeNull();
    expect(mockReconcileConflicts).toHaveBeenCalledWith(saved);
    expect(require('@/lib/eventOfflineCheckinStore').syncMobileOfflineSession).not.toHaveBeenCalled();
  });
});
