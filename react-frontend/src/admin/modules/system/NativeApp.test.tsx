// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

/**
 * The page used to carry a 24-field settings form, a "Deployment Readiness"
 * panel and a "build manifest" download. Every one of those saved or showed
 * values nothing read (E-127 / F-621), so they were removed on 13 Nov 2026.
 *
 * `adminSettings` is mocked WITHOUT the three removed calls on purpose: if the
 * page ever asks for settings again, it throws here.
 */
const { mockAdminSettings } = vi.hoisted(() => ({
  mockAdminSettings: {
    getNativeAppInstallStats: vi.fn(),
    getNativeAppMembers: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts({}));

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import { NativeApp } from './NativeApp';

describe('NativeApp page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue({ success: true, data: null });
    mockAdminSettings.getNativeAppMembers.mockResolvedValue({ success: true, data: [], meta: { total: 0 } });
  });

  it('is called "Phone app" and says what it is for', async () => {
    render(<NativeApp />);

    expect(await screen.findByRole('heading', { name: 'Phone app' })).toBeInTheDocument();
    expect(screen.getByText('See which members of this community are signed in on the phone app.')).toBeInTheDocument();
  });

  it('asks the server who has the app', async () => {
    render(<NativeApp />);

    await waitFor(() => expect(mockAdminSettings.getNativeAppInstallStats).toHaveBeenCalledTimes(1));
  });

  it('has no settings form: nothing to save, nothing to export', async () => {
    render(<NativeApp />);
    await waitFor(() => expect(mockAdminSettings.getNativeAppInstallStats).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /bundle|package|store id|sender|prefix|url/i })).not.toBeInTheDocument();
  });

  it('does not offer a place to paste push credentials', async () => {
    render(<NativeApp />);
    await waitFor(() => expect(mockAdminSettings.getNativeAppInstallStats).toHaveBeenCalled());

    expect(screen.queryByLabelText(/fcm server key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/apns/i)).not.toBeInTheDocument();
  });
});
