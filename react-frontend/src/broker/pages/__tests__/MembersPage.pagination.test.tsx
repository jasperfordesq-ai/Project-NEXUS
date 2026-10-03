// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression test for the broker Members page pagination/KPI contract.
 *
 * The api client unwraps the backend's `{ data, meta }` envelope into
 * `res.data` (the row array) and `res.meta` (the pagination meta). The page
 * MUST read collection totals from `res.meta.total`:
 *
 *  - the KPI stat cards use limit=1 count queries — reading the row count
 *    instead of meta.total rendered "Total members: 1" for a 256-member
 *    community;
 *  - the table total drives DataTable's pagination — reading the page's row
 *    count made totalPages always 1, so pagination never rendered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/ui';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Hoisted: the static `@/components/ui` import above pulls in `@/lib/api`, so
// the mock factory below runs before an ordinary `const` would be initialised.
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn().mockResolvedValue({ success: true }),
  put: vi.fn().mockResolvedValue({ success: true }),
  delete: vi.fn().mockResolvedValue({ success: true }),
  upload: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Broker', last_name: 'User', name: 'Broker User', role: 'broker', is_super_admin: false, is_tenant_super_admin: false, tenant_id: 2 },
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

// The detail modal drags in the whole member-management surface — irrelevant
// to the pagination contract under test.
vi.mock('@/broker/components/MemberDetailModal', () => ({ default: () => null }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Response shape AFTER the api client unwraps { data, meta }. */
function paginatedResponse(items: unknown[], total: number, page = 1, perPage = 20) {
  return {
    success: true,
    data: items,
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

function fakeUser(id: number) {
  return {
    id,
    name: `Member ${id}`,
    first_name: 'Member',
    last_name: String(id),
    email: `member${id}@test.com`,
    role: 'member',
    status: 'active',
    balance: 0,
    listing_count: 0,
    has_2fa_enabled: false,
    is_super_admin: false,
    is_tenant_super_admin: false,
    onboarding_completed: true,
    tenant_id: 2,
    created_at: '2026-01-01 00:00:00',
    last_active_at: null,
    email_verified_at: '2026-01-01 00:00:00',
  };
}

// Community of 256: the page list returns 20 rows; the four KPI count queries
// (limit=1) each return ONE row but carry the real total in meta.
const TOTALS: Record<string, number> = {
  '': 256,
  pending: 4,
  active: 240,
  suspended: 12,
};

function mockUsersEndpoint() {
  mockApi.get.mockImplementation((url: string) => {
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const status = query.get('status') ?? '';
    const limit = Number(query.get('limit') ?? '20');
    const total = TOTALS[status] ?? 256;
    if (limit === 1) {
      return Promise.resolve(paginatedResponse([fakeUser(1)], total, 1, 1));
    }
    const rows = Array.from({ length: 20 }, (_, i) => fakeUser(i + 1));
    return Promise.resolve(paginatedResponse(rows, total, 1, 20));
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Broker MembersPage pagination & KPI totals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsersEndpoint();
  });

  // The page confirms bulk / reactivate / note-delete through the shared
  // confirm dialog, which needs its provider — exactly as the app shell has.
  const renderPage = (MembersPage: React.ComponentType) =>
    render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <MembersPage />
        </ConfirmDialogProvider>
      </MemoryRouter>
    );

  it('reads KPI totals from meta.total, not the limit=1 row count', async () => {
    const { default: MembersPage } = await import('../MembersPage');
    renderPage(MembersPage);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });

    // Total members card: 256, not 1 (the limit=1 row count).
    await waitFor(() => {
      expect(screen.getByText('256')).toBeInTheDocument();
    });
    // Active members card: 240.
    expect(screen.getByText('240')).toBeInTheDocument();
    // Pending (4) and suspended (12) appear on both the card and the tab chip.
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });

  it('drives pagination from meta.total so page controls render', async () => {
    const { default: MembersPage } = await import('../MembersPage');
    renderPage(MembersPage);

    // DataTable's footer only renders when totalPages > 1 — "256 total"
    // proves the table total came from meta.total, not the 20 visible rows.
    await waitFor(() => {
      expect(screen.getByText(/256 total/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/20 total/)).not.toBeInTheDocument();

    // And the rows themselves rendered.
    expect(screen.getByText('member1@test.com')).toBeInTheDocument();
  });
});
