// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminSettings } = vi.hoisted(() => ({
  mockAdminSettings: {
    getNativeAppInstallStats: vi.fn(),
    // The member list sits inside this block and fetches for itself; its own
    // behaviour is covered in NativeAppMembersTable.test.tsx.
    getNativeAppMembers: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts({}));

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

import { NativeAppInstallStats } from './NativeAppInstallStats';

const tenantBlock = {
  tenant_id: 2,
  members_with_app: 42,
  members_notifications_on: 38,
  native_devices: 39,
  devices_by_platform: { android: 31, ios: 8 },
  last_joined_at: '2026-11-10T20:25:28+00:00',
};

const platformBlock = {
  members_with_app: 57,
  members_notifications_on: 50,
  native_devices: 51,
  devices_by_platform: { android: 40, ios: 11 },
  last_joined_at: '2026-11-10T20:25:28+00:00',
  tenants_with_app: 3,
  by_tenant: [
    {
      tenant_id: 2,
      tenant_name: 'hOUR Timebank',
      tenant_slug: 'hour-timebank',
      members_with_app: 42,
      native_devices: 39,
      last_joined_at: '2026-11-10T20:25:28+00:00',
    },
    {
      tenant_id: 11,
      tenant_name: 'Minehead and Coast',
      tenant_slug: 'minehead-and-coast',
      members_with_app: 9,
      native_devices: 7,
      last_joined_at: '2026-08-21T07:30:41+00:00',
    },
  ],
  recent_members: [
    {
      user_id: 77,
      tenant_id: 11,
      tenant_name: 'Minehead and Coast',
      display_name: 'Sam Carter',
      username: 'samc',
      phones: ['ios'],
      notifications_on: true,
      first_seen_at: '2026-08-21T07:30:41+00:00',
      last_opened_at: '2026-08-22T07:30:41+00:00',
    },
  ],
};

const reply = (platform: typeof platformBlock | null) => ({
  success: true,
  data: {
    tenant_id: 2,
    is_god: platform !== null,
    scope: platform !== null ? 'platform' : 'tenant',
    tenant: tenantBlock,
    platform,
  },
});

describe('NativeAppInstallStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSettings.getNativeAppMembers.mockResolvedValue({ success: true, data: [], meta: { total: 0 } });
  });

  it('shows how many members have the app and how many turned notifications on', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(null));
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('38')).toBeInTheDocument();
    expect(screen.getByText('Members with the app')).toBeInTheDocument();
    expect(screen.getByText('Notifications turned on')).toBeInTheDocument();
  });

  it('gives the Android and iPhone split in plain words', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(null));
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('31 on Android · 8 on iPhone')).toBeInTheDocument());
  });

  it('says these are not download counts', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(null));
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText(/not the number of downloads/i)).toBeInTheDocument());
  });

  it('uses no insider words', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(platformBlock));
    const { container } = render(<NativeAppInstallStats />);
    await waitFor(() => expect(screen.getByText('All communities')).toBeInTheDocument());

    expect(container.textContent ?? '').not.toMatch(/\b(push|god mode|registered|registration|FCM|APNs|PWA|tenant|native)\b/i);
  });

  it('shows the member list for the community', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(null));
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(mockAdminSettings.getNativeAppMembers).toHaveBeenCalled());
  });

  it('hides the all-communities block from an ordinary community admin', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(null));
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.queryByText('All communities')).not.toBeInTheDocument();
    expect(screen.queryByText('Minehead and Coast')).not.toBeInTheDocument();
    expect(screen.queryByText('Sam Carter')).not.toBeInTheDocument();
  });

  it('shows the all-communities block to a platform owner', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue(reply(platformBlock));
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('All communities')).toBeInTheDocument());
    expect(screen.getAllByText('Minehead and Coast').length).toBeGreaterThan(0);
    expect(screen.getByText('Sam Carter')).toBeInTheDocument();
    expect(screen.getByText('hour-timebank')).toBeInTheDocument();
    expect(screen.getByText('57')).toBeInTheDocument();
  });

  it('says "Nobody yet" for the newest member when no one has the app', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockResolvedValue({
      success: true,
      data: {
        tenant_id: 2,
        is_god: false,
        scope: 'tenant',
        tenant: {
          tenant_id: 2,
          members_with_app: 0,
          members_notifications_on: 0,
          native_devices: 0,
          devices_by_platform: { android: 0, ios: 0 },
          last_joined_at: null,
        },
        platform: null,
      },
    });
    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('Nobody yet')).toBeInTheDocument());
  });

  it('reports a failed load instead of showing zeroes, and still shows the list', async () => {
    mockAdminSettings.getNativeAppInstallStats.mockRejectedValue(new Error('network'));
    render(<NativeAppInstallStats />);

    await waitFor(() =>
      expect(screen.getByText("We couldn't load these figures. Please refresh the page to try again.")).toBeInTheDocument(),
    );
    expect(screen.queryByText('Members with the app')).not.toBeInTheDocument();
    expect(mockAdminSettings.getNativeAppMembers).toHaveBeenCalled();
  });
});
