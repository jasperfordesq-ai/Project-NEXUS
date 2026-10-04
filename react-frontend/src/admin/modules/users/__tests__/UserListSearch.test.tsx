// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockAdminUsers = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn().mockResolvedValue({ success: true }),
  suspend: vi.fn().mockResolvedValue({ success: true }),
  ban: vi.fn().mockResolvedValue({ success: true }),
  reactivate: vi.fn().mockResolvedValue({ success: true }),
  delete: vi.fn().mockResolvedValue({ success: true }),
  reset2fa: vi.fn().mockResolvedValue({ success: true }),
  impersonate: vi.fn().mockResolvedValue({ success: true, data: { token: 'test' } }),
  importUsers: vi.fn().mockResolvedValue({ success: true, data: { imported: 0, skipped: 0, errors: [], total_rows: 0 } }),
  downloadImportTemplate: vi.fn(),
  exportAllMembers: vi.fn(),
  bulkApprove: vi.fn().mockResolvedValue({ success: true, data: { success: 1, failed: 0 } }),
  bulkSuspend: vi.fn().mockResolvedValue({ success: true, data: { success: 1, failed: 0 } }),
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, name: 'Admin User', role: 'admin', is_super_admin: true },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (path: string) => `/test${path}`,
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    showToast: vi.fn(),
  })),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('../../api/adminApi', () => ({
  adminUsers: mockAdminUsers,
}));

vi.mock('../../../api/adminApi', () => ({
  adminUsers: mockAdminUsers,
}));

import UserList from '../UserList';

function renderUserList() {
  return render(
    <MemoryRouter initialEntries={['/test/admin/users']}>
      <UserList />
    </MemoryRouter>,
  );
}

describe('UserList smart search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminUsers.list.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, current_page: 1, per_page: 20, total_pages: 1 },
    });
  });

  it('parses role and status hints while sending the remaining text as the user query', async () => {
    const user = userEvent.setup();
    renderUserList();

    await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());

    const search = screen.getByRole('searchbox', {
      name: /smart user search/i,
    });
    await user.type(search, 'pending admin jasper@example.com');

    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenLastCalledWith(expect.objectContaining({
        role: 'admin',
        search: 'jasper@example.com',
        status: 'pending',
        tenant_id: 2,
      }));
    });

    expect(screen.getByText('Status: Pending')).toBeInTheDocument();
    expect(screen.getByText('Role: Admin')).toBeInTheDocument();
  });
});
