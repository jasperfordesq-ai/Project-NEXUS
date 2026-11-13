// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests that admin paginated list pages correctly extract `total` from
 * `response.meta.total` rather than using `data.length` (which is only
 * the current page count, not the full collection size).
 *
 * This test validates the fix for API-001: pagination total mismatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Common mocks ────────────────────────────────────────────────────────────

const mockApi = {
  get: vi.fn(),
  post: vi.fn().mockResolvedValue({ success: true }),
  put: vi.fn().mockResolvedValue({ success: true }),
  delete: vi.fn().mockResolvedValue({ success: true }),
  upload: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock('@/lib/api', () => ({
  api: mockApi,
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, is_tenant_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    showToast: vi.fn(),
  })),
  useNotifications: vi.fn(() => ({ counts: { messages: 0, notifications: 0 } })),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useApi: vi.fn(() => ({ data: null, loading: false, error: null })),
  useApiErrorHandler: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      key === 'shared.total_count' ? `${options?.count} total` : key
    ),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Simulates the paginated API response that the api client produces after
 * unwrapping { data: [...], meta: {...} } into { success: true, data: [...], meta: {...} }.
 */
function paginatedResponse(items: unknown[], total: number, page = 1, perPage = 20) {
  return {
    success: true,
    data: items,  // After api client unwrap, data IS the array
    meta: {
      current_page: page,
      per_page: perPage,
      total,
      total_pages: Math.ceil(total / perPage),
      has_more: page < Math.ceil(total / perPage),
      base_url: 'http://localhost',
    },
  };
}

function renderInRouter(component: React.ReactElement) {
  return render(
    <MemoryRouter>
      <>{component}</>
    </MemoryRouter>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Admin pagination total extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('UserList reads total from meta, not data.length', async () => {
    // Return 2 items but total=42 (i.e. page 1 of many)
    const fakeUsers = [
      { id: 1, name: 'Alice', first_name: 'Alice', last_name: 'A', email: 'a@test.com', role: 'member', status: 'active', balance: 0, has_2fa_enabled: false, is_super_admin: false, created_at: '2024-01-01' },
      { id: 2, name: 'Bob', first_name: 'Bob', last_name: 'B', email: 'b@test.com', role: 'member', status: 'active', balance: 0, has_2fa_enabled: false, is_super_admin: false, created_at: '2024-01-02' },
    ];
    mockApi.get.mockResolvedValue(paginatedResponse(fakeUsers, 42, 1, 20));

    const { UserList } = await import('../modules/users/UserList');
    renderInRouter(<UserList />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // After the data loads, the "42 total" text should appear in the pagination
    await waitFor(() => {
      expect(screen.getByText(/42 total/)).toBeInTheDocument();
    });
  });

  it('ListingsAdmin reads total from meta, not data.length', async () => {
    const fakeListings = [
      { id: 1, title: 'Listing 1', type: 'listing', status: 'active', user_id: 1, user_name: 'Alice', created_at: '2024-01-01' },
      { id: 2, title: 'Listing 2', type: 'listing', status: 'active', user_id: 2, user_name: 'Bob', created_at: '2024-01-02' },
    ];
    mockApi.get.mockResolvedValue(paginatedResponse(fakeListings, 55, 1, 20));

    const { ListingsAdmin } = await import('../modules/listings/ListingsAdmin');
    renderInRouter(<ListingsAdmin />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // The "55 total" text should appear in the pagination footer
    await waitFor(() => {
      expect(screen.getByText(/55 total/)).toBeInTheDocument();
    });
  });

  // Until 13 Nov 2026 the super-admin Users page asked for 100 rows while its
  // page buttons counted 20, and took its total from the rows it had.
  it('SuperUserList reads total from meta and requests the page size it shows', async () => {
    const fakeUsers = [
      { id: 1, name: 'Alice', email: 'a@test.com', role: 'member', status: 'active', tenant_id: 2, tenant_name: 'Test', is_super_admin: false, is_tenant_super_admin: false, last_login_at: null },
    ];
    mockApi.get.mockResolvedValue(paginatedResponse(fakeUsers, 45, 1, 20));

    const { SuperUserList } = await import('../modules/super/SuperUserList');
    renderInRouter(<SuperUserList />);

    await waitFor(() => {
      expect(screen.getByText(/45 total/)).toBeInTheDocument();
    });

    const userCall = mockApi.get.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.startsWith('/v2/admin/super/users'));
    expect(userCall).toBeDefined();
    expect(userCall).toMatch(/[?&]limit=20(&|$)/);
    expect(userCall).toMatch(/[?&]page=1(&|$)/);
  });
});
