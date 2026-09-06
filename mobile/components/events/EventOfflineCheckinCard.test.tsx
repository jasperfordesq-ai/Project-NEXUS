// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetWorkspace = jest.fn();
const mockGetConflicts = jest.fn();
const mockPurgeExpired = jest.fn();
const mockLoadSessionForReview = jest.fn();
const mockPurgeSession = jest.fn();
const mockConfirm = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  downloadOfflineCheckinManifest: jest.fn(),
  getOfflineCheckinConflicts: (...args: unknown[]) => mockGetConflicts(...args),
  getOfflineCheckinWorkspace: (...args: unknown[]) => mockGetWorkspace(...args),
  registerOfflineCheckinDevice: jest.fn(),
  resolveOfflineCheckinConflict: jest.fn(),
  revokeOfflineCheckinDevice: jest.fn(),
}));

jest.mock('@/lib/eventOfflineCheckinStore', () => ({
  activateMobileOfflineSession: jest.fn(),
  enqueueMobileOfflineCredential: jest.fn(),
  loadMobileOfflineSessionForReview: (...args: unknown[]) => mockLoadSessionForReview(...args),
  purgeMobileOfflineSession: (...args: unknown[]) => mockPurgeSession(...args),
  purgeRevokedOrExpiredMobileSessions: (...args: unknown[]) => mockPurgeExpired(...args),
  refreshMobileOfflineManifest: jest.fn(),
  syncMobileOfflineSession: jest.fn(),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
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
      options && 'count' in options ? `${key}:${String(options.count)}` : key
    ),
  }),
}));

import EventOfflineCheckinCard from './EventOfflineCheckinCard';

const emptyWorkspace = {
  event_id: 77,
  manifest_version: 3,
  devices: [],
};

describe('EventOfflineCheckinCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetWorkspace.mockResolvedValue(emptyWorkspace);
    mockGetConflicts.mockResolvedValue({ items: [] });
    mockPurgeExpired.mockResolvedValue(undefined);
    mockLoadSessionForReview.mockResolvedValue({ session: null, inactive: null });
    mockPurgeSession.mockResolvedValue(undefined);
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

  it('shows a visible load failure and retries the actual request', async () => {
    mockGetWorkspace.mockRejectedValueOnce(new Error('offline'));
    const { findByText, getByText } = render(<EventOfflineCheckinCard eventId={77} />);

    expect(await findByText('workspace.loadErrorTitle')).toBeTruthy();
    expect(getByText('workspace.loadErrorDescription')).toBeTruthy();
    fireEvent.press(getByText('workspace.retry'));

    expect(await findByText('workspace.title')).toBeTruthy();
    await waitFor(() => expect(mockGetWorkspace).toHaveBeenCalledTimes(2));
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

    await options.onConfirm();
    expect(mockPurgeSession).toHaveBeenCalledWith(77, 5);
  });
});
