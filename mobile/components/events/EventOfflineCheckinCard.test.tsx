// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetWorkspace = jest.fn();
const mockGetConflicts = jest.fn();
const mockPurgeExpired = jest.fn();
const mockLoadSession = jest.fn();
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
  loadMobileOfflineSession: (...args: unknown[]) => mockLoadSession(...args),
  purgeMobileOfflineSession: jest.fn(),
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
  useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#2563eb' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    mockLoadSession.mockResolvedValue(null);
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
});
