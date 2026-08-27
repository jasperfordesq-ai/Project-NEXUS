// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
}));

import { api } from '@/lib/api/client';
import {
  approveSubAccount,
  blockUser,
  getBlockedUsers,
  getDataExportHistory,
  getManagedSubAccounts,
  getManagerSubAccounts,
  getSubAccountActivity,
  getUserPreferences,
  requestSubAccount,
  revokeSubAccount,
  updateSubAccountPermissions,
} from './settings';

describe('settings sub-account API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads managed and manager account relationships', async () => {
    const relationship = {
      relationship_id: 12,
      relationship_type: 'guardian',
      permissions: { tiers: { credits: 'co_decide' } },
      status: 'active',
      created_at: '2026-08-27T09:00:00Z',
      user_id: 7,
      email: 'member@example.com',
    };
    (api.get as jest.Mock).mockResolvedValue({ data: [relationship] });

    await expect(getManagedSubAccounts()).resolves.toEqual([relationship]);
    await expect(getManagerSubAccounts()).resolves.toEqual([relationship]);

    expect(api.get).toHaveBeenCalledWith('/api/v2/users/me/sub-accounts');
    expect(api.get).toHaveBeenCalledWith('/api/v2/users/me/parent-accounts');
  });

  it('unwraps the real nested export-history envelope', async () => {
    const exportRow = {
      id: 9,
      format: 'zip',
      requested_at: '2026-08-27T09:00:00Z',
      completed_at: null,
      file_size_bytes: null,
    };
    (api.get as jest.Mock).mockResolvedValue({ success: true, data: { exports: [exportRow] } });

    await expect(getDataExportHistory()).resolves.toEqual([exportRow]);
    expect(api.get).toHaveBeenCalledWith('/api/v2/me/data-export/history');
  });

  it('preserves blocked-user and preference payloads after unwrapping', async () => {
    const blockedUser = {
      block_id: 4,
      user_id: 8,
      name: 'Blocked Member',
      first_name: 'Blocked',
      last_name: 'Member',
      avatar_url: null,
      reason: null,
      blocked_at: '2026-08-27T09:00:00Z',
    };
    const preferences = {
      feed: { prefers_chronological: true },
      translation: { auto_translate_ugc: false, auto_translate_target_locale: null },
    };
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: [blockedUser] })
      .mockResolvedValueOnce({ data: preferences });

    await expect(getBlockedUsers()).resolves.toEqual([blockedUser]);
    await expect(getUserPreferences()).resolves.toEqual(preferences);
  });

  it('blocks an abusive member through the tenant-scoped service endpoint', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { success: true } });

    await blockUser(8);

    expect(api.post).toHaveBeenCalledWith('/api/v2/users/8/block', {
      reason: 'safety_concern',
    });
  });

  it('unwraps the permission-gated sub-account activity summary', async () => {
    const activity = {
      hours_summary: { hours_given: 3, hours_received: 5, net_balance: 2 },
      connection_stats: { total_connections: 4, groups_joined: 1 },
      engagement: { posts_count: 6 },
      timeline: [{ id: 1, activity_type: 'gave_hours', description: 'Helped', created_at: '2026-08-27T09:00:00Z' }],
    };
    (api.get as jest.Mock).mockResolvedValue({ data: activity });

    await expect(getSubAccountActivity(7)).resolves.toEqual(activity);
    expect(api.get).toHaveBeenCalledWith('/api/v2/users/me/sub-accounts/7/activity');
  });

  it('requests a linked account by email', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: [] });

    await requestSubAccount('member@example.com');

    expect(api.post).toHaveBeenCalledWith('/api/v2/users/me/sub-accounts', { email: 'member@example.com' });
  });

  it('approves, updates permissions, and revokes relationships', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: [] });
    (api.delete as jest.Mock).mockResolvedValue({ data: { deleted: true } });

    await approveSubAccount(12);
    await updateSubAccountPermissions(12, { can_transact: true });
    await revokeSubAccount(12);

    expect(api.put).toHaveBeenCalledWith('/api/v2/users/me/sub-accounts/12/approve');
    expect(api.put).toHaveBeenCalledWith('/api/v2/users/me/sub-accounts/12/permissions', {
      permissions: { can_transact: true },
    });
    expect(api.delete).toHaveBeenCalledWith('/api/v2/users/me/sub-accounts/12');
  });
});
