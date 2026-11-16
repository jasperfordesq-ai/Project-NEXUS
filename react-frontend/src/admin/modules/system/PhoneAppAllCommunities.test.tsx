// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts({}));

import { PhoneAppAllCommunities, type NativeAppPlatformStats } from './PhoneAppAllCommunities';

const platform: NativeAppPlatformStats = {
  members_with_app: 57,
  native_devices: 51,
  devices_by_platform: { android: 40, ios: 11 },
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
      tenant_name: null,
      tenant_slug: null,
      members_with_app: 9,
      native_devices: 7,
      last_joined_at: null,
    },
  ],
  recent_members: [
    {
      user_id: 77,
      tenant_id: 2,
      tenant_name: 'hOUR Timebank',
      display_name: 'Sam Carter',
      username: 'samc',
      phones: ['ios'],
      notifications_on: true,
      first_seen_at: '2026-08-21T07:30:41+00:00',
      last_opened_at: '2026-08-22T07:30:41+00:00',
    },
  ],
};

describe('PhoneAppAllCommunities', () => {
  it('shows the platform totals with the Android and iPhone split', () => {
    render(<PhoneAppAllCommunities platform={platform} />);

    expect(screen.getByText('57')).toBeInTheDocument();
    expect(screen.getByText('51')).toBeInTheDocument();
    expect(screen.getByText('40 on Android · 11 on iPhone')).toBeInTheDocument();
  });

  it('lists each community and the newest members to sign in on the app', () => {
    render(<PhoneAppAllCommunities platform={platform} />);

    expect(screen.getAllByText('hOUR Timebank').length).toBeGreaterThan(0);
    expect(screen.getByText('hour-timebank')).toBeInTheDocument();
    expect(screen.getByText('Sam Carter')).toBeInTheDocument();
    expect(screen.getByText('@samc')).toBeInTheDocument();
  });

  it('still names a community that has no name on record', () => {
    render(<PhoneAppAllCommunities platform={platform} />);

    expect(screen.getByText(/11/, { selector: 'div.font-medium' })).toBeInTheDocument();
  });

  it('copes with a reply that has no lists at all', () => {
    const bare = { ...platform, by_tenant: undefined, recent_members: undefined } as unknown as NativeAppPlatformStats;
    render(<PhoneAppAllCommunities platform={bare} />);

    expect(screen.getByText('57')).toBeInTheDocument();
  });

  it('uses no insider words', () => {
    const { container } = render(<PhoneAppAllCommunities platform={platform} />);

    expect(container.textContent ?? '').not.toMatch(/\b(push|god mode|registered|registration|FCM|APNs|PWA|tenant|native)\b/i);
  });
});
