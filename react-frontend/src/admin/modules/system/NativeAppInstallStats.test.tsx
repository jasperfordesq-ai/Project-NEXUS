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
  },
}));

vi.mock('@/contexts', () => createMockContexts({}));

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

import { NativeAppInstallStats } from './NativeAppInstallStats';

const tenantBlock = {
  tenant_id: 2,
  native_devices: 8,
  native_users: 6,
  web_subscriptions: 12,
  web_users: 9,
  push_enabled_users: 13,
  devices_by_platform: { android: 7, ios: 1 },
  first_registered_at: '2026-01-04T08:06:30+00:00',
  last_registered_at: '2026-09-04T20:25:28+00:00',
  recent_devices: [
    {
      user_id: 41,
      display_name: 'Aoife Brennan',
      username: 'aoife',
      email: 'aoife@example.test',
      platform: 'android',
      registered_at: '2026-09-04T20:25:28+00:00',
      last_seen_at: '2026-09-05T09:00:00+00:00',
    },
  ],
};

const platformBlock = {
  native_devices: 10,
  native_users: 8,
  web_subscriptions: 20,
  web_users: 15,
  push_enabled_users: 21,
  devices_by_platform: { android: 9, ios: 1 },
  first_registered_at: '2026-01-04T08:06:30+00:00',
  last_registered_at: '2026-09-04T20:25:28+00:00',
  tenants_with_installs: 3,
  by_tenant: [
    {
      tenant_id: 2,
      tenant_name: 'hOUR Timebank',
      tenant_slug: 'hour-timebank',
      native_devices: 8,
      native_users: 6,
      last_registered_at: '2026-09-04T20:25:28+00:00',
    },
    {
      tenant_id: 11,
      tenant_name: 'Minehead and Coast',
      tenant_slug: 'minehead-and-coast',
      native_devices: 1,
      native_users: 1,
      last_registered_at: '2026-08-21T07:30:41+00:00',
    },
  ],
  recent_devices: [
    {
      user_id: 77,
      tenant_id: 11,
      tenant_name: 'Minehead and Coast',
      display_name: 'Sam Carter',
      username: 'samc',
      platform: 'android',
      registered_at: '2026-08-21T07:30:41+00:00',
      last_seen_at: '2026-08-22T07:30:41+00:00',
    },
  ],
};

function resolveWith(data: unknown) {
  mockAdminSettings.getNativeAppInstallStats.mockResolvedValue({ success: true, data });
}

describe('NativeAppInstallStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the tenant figures', async () => {
    resolveWith({ tenant_id: 2, is_god: false, scope: 'tenant', tenant: tenantBlock, platform: null });

    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
  });

  it('names the members who registered a device', async () => {
    resolveWith({ tenant_id: 2, is_god: false, scope: 'tenant', tenant: tenantBlock, platform: null });

    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());
    expect(screen.getByText('aoife@example.test')).toBeInTheDocument();
  });

  it('warns that these are not app-store install counts', async () => {
    resolveWith({ tenant_id: 2, is_god: false, scope: 'tenant', tenant: tenantBlock, platform: null });

    render(<NativeAppInstallStats />);

    // The disclaimer is the guard against these numbers being read as Play
    // Store installs. If this assertion is ever deleted, read the component
    // docblock before deciding it is redundant.
    await waitFor(() =>
      expect(screen.getByText(/not Google Play or App Store install counts/i)).toBeInTheDocument(),
    );
  });

  it('hides the cross-tenant block from a non-god admin', async () => {
    resolveWith({ tenant_id: 2, is_god: false, scope: 'tenant', tenant: tenantBlock, platform: null });

    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());
    expect(screen.queryByText('All communities')).not.toBeInTheDocument();
    expect(screen.queryByText('Minehead and Coast')).not.toBeInTheDocument();
    expect(screen.queryByText('Sam Carter')).not.toBeInTheDocument();
  });

  it('shows the cross-tenant block to a god operator', async () => {
    resolveWith({ tenant_id: 2, is_god: true, scope: 'platform', tenant: tenantBlock, platform: platformBlock });

    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('All communities')).toBeInTheDocument());
    expect(screen.getAllByText('Minehead and Coast').length).toBeGreaterThan(0);
    expect(screen.getByText('Sam Carter')).toBeInTheDocument();
    expect(screen.getByText('hour-timebank')).toBeInTheDocument();
  });

  it('falls back to the username when a member has no name', async () => {
    resolveWith({
      tenant_id: 2,
      is_god: false,
      scope: 'tenant',
      tenant: {
        ...tenantBlock,
        recent_devices: [{
          user_id: 99,
          display_name: null,
          username: 'quietone',
          email: null,
          platform: 'ios',
          registered_at: null,
          last_seen_at: null,
        }],
      },
      platform: null,
    });

    render(<NativeAppInstallStats />);

    await waitFor(() => expect(screen.getByText('@quietone')).toBeInTheDocument());
  });

  it('shows an empty state rather than an error when nobody has installed it', async () => {
    resolveWith({
      tenant_id: 2,
      is_god: false,
      scope: 'tenant',
      tenant: {
        ...tenantBlock,
        native_devices: 0,
        native_users: 0,
        web_subscriptions: 0,
        push_enabled_users: 0,
        devices_by_platform: { android: 0, ios: 0 },
        first_registered_at: null,
        last_registered_at: null,
        recent_devices: [],
      },
      platform: null,
    });

    render(<NativeAppInstallStats />);

    await waitFor(() =>
      expect(screen.getByText('Nobody has registered the app yet.')).toBeInTheDocument(),
    );
  });

  it('reports a failed load instead of rendering zeroes', async () => {
    // A network failure must not look like "nobody has installed the app".
    mockAdminSettings.getNativeAppInstallStats.mockRejectedValue(new Error('boom'));

    render(<NativeAppInstallStats />);

    await waitFor(() =>
      expect(screen.getByText('Could not load app install figures.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Nobody has registered the app yet.')).not.toBeInTheDocument();
  });
});
