// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Timebanking and Users admin modules:
 * - FraudAlerts, OrgWallets, StartingBalances, TimebankingDashboard, UserReport
 * - UserCreate, UserEdit, UserList
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ─── Hoisted mock fns (required because vi.mock is hoisted above imports) ────

const mockExecute = vi.hoisted(() => vi.fn());

// ─── Common mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
  useNotifications: vi.fn(() => ({ counts: { messages: 0, notifications: 0 } })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useApi', () => ({
  useApi: vi.fn(() => ({
    data: [],
    meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 },
    isLoading: false,
    error: null,
    execute: mockExecute,
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string) => url || '/default.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  resolveAssetUrl: vi.fn((url: string) => url || ''),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/admin/components/PageHeader', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/admin/components/ConfirmModal', () => ({
  default: () => null,
  ConfirmModal: () => null,
}));

vi.mock('@/admin/components/DataTable', () => ({
  DataTable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StatusBadge: ({ status }: Record<string, unknown>) => <span>{status}</span>,
  Column: {},
}));

vi.mock('@/lib/tenant-routing', () => ({
  tenantPath: (p: string) => `/test${p}`,
}));

// Mock admin API modules used by timebanking and user components
vi.mock('@/admin/api/adminApi', () => ({
  adminTimebanking: {
    getStats: vi.fn().mockResolvedValue({ success: true, data: null }),
    getAlerts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    updateAlertStatus: vi.fn().mockResolvedValue({ success: true }),
    getOrgWallets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    // GET /v2/admin/wallet/grants sends { grants, total, page, per_page }.
    getGrants: vi.fn().mockResolvedValue({
      success: true,
      data: { grants: [], total: 0, page: 1, per_page: 20 },
    }),
    grantCredits: vi.fn().mockResolvedValue({ success: true }),
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // paginated endpoints: `data` is the bare row array and pagination lives on the
    // sibling `meta`. Earlier fixtures nested `meta` inside `data`, a shape the
    // client never produces for these endpoints.
    getUserReport: vi.fn().mockResolvedValue({
      success: true,
      data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false },
    }),
    downloadStatementCsv: vi.fn().mockResolvedValue(undefined),
    adjustBalance: vi.fn().mockResolvedValue({ success: true }),
  },
  adminUsers: {
    list: vi.fn().mockResolvedValue({
      success: true,
      data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false },
    }),
    get: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 1,
        first_name: 'Test',
        last_name: 'User',
        name: 'Test User',
        email: 'test@example.com',
        role: 'member',
        status: 'active',
        bio: '',
        tagline: '',
        location: '',
        organization_name: '',
        avatar_url: '',
        avatar: '',
        balance: 10,
        is_super_admin: false,
        badges: [],
        created_at: '2025-01-01',
      },
    }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    approve: vi.fn().mockResolvedValue({ success: true }),
    suspend: vi.fn().mockResolvedValue({ success: true }),
    ban: vi.fn().mockResolvedValue({ success: true }),
    reactivate: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    reset2fa: vi.fn().mockResolvedValue({ success: true }),
    impersonate: vi.fn().mockResolvedValue({ success: true, data: { token: 'test' } }),
    importUsers: vi.fn().mockResolvedValue({ success: true, data: { imported: 0, skipped: 0, errors: [], total_rows: 0 } }),
    downloadImportTemplate: vi.fn(),
    setSuperAdmin: vi.fn().mockResolvedValue({ success: true }),
    setGlobalSuperAdmin: vi.fn().mockResolvedValue({ success: true }),
    removeBadge: vi.fn().mockResolvedValue({ success: true }),
    recheckUserBadges: vi.fn().mockResolvedValue({ success: true, data: { badges: [] } }),
    setPassword: vi.fn().mockResolvedValue({ success: true }),
    sendPasswordReset: vi.fn().mockResolvedValue({ success: true }),
    sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
    getConsents: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminVetting: {
    getUserRecords: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminInsurance: {
    getUserCertificates: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// Mock admin API types
vi.mock('@/admin/api/types', () => ({}));

// Mock admin StatCard component used by TimebankingDashboard
vi.mock('@/admin/components/StatCard', () => ({
  default: () => <div />,
  StatCard: () => <div />,
}));

// ─── Wrappers ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

function WRoute({
  children,
  path,
  entry,
}: {
  children: React.ReactNode;
  path: string;
  entry: string;
}) {
  return (
    <>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={path} element={children} />
        </Routes>
      </MemoryRouter>
    </>
  );
}

// ─── FraudAlerts ──────────────────────────────────────────────────────────────

import FraudAlerts from '../timebanking/FraudAlerts';

describe('FraudAlerts', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><FraudAlerts /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── OrgWallets ───────────────────────────────────────────────────────────────

import OrgWallets from '../timebanking/OrgWallets';

describe('OrgWallets', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><OrgWallets /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── StartingBalances ─────────────────────────────────────────────────────────

import StartingBalances from '../timebanking/StartingBalances';

describe('StartingBalances', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><StartingBalances /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TimebankingDashboard ─────────────────────────────────────────────────────

import TimebankingDashboard from '../timebanking/TimebankingDashboard';

describe('TimebankingDashboard', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><TimebankingDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── UserReport ───────────────────────────────────────────────────────────────

import UserReport from '../timebanking/UserReport';

describe('UserReport', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><UserReport /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── UserCreate ───────────────────────────────────────────────────────────────

import UserCreate from '../users/UserCreate';

describe('UserCreate', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><UserCreate /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── UserEdit ─────────────────────────────────────────────────────────────────

import UserEdit from '../users/UserEdit';

describe('UserEdit', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <WRoute path="/test/admin/users/:id/edit" entry="/test/admin/users/1/edit">
        <UserEdit />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── UserList ─────────────────────────────────────────────────────────────────

import UserList from '../users/UserList';

describe('UserList', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><UserList /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
