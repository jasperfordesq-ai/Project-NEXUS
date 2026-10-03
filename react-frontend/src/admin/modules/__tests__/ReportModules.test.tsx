// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Report and Resource admin modules:
 * - HoursReportsPage, InactiveMembersPage, MemberReportsPage,
 *   ModerationQueuePage, SocialValuePage, ResourcesAdmin
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() })),
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
    execute: vi.fn(),
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() })),
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
  StatusBadge: () => null,
  Column: {} as Record<string, unknown>,
}));

vi.mock('@/lib/tenant-routing', () => ({
  tenantPath: vi.fn((p: string) => `/test${p}`),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

// Mock recharts to avoid SVG rendering issues in JSDOM
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock admin components barrel (StatCard, EmptyState, etc.)
vi.mock('../../components', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StatCard: () => <div data-testid="stat-card" />,
  DataTable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConfirmModal: () => null,
  EmptyState: () => <div>Empty</div>,
}));

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── HoursReportsPage ─────────────────────────────────────────────────────────

import HoursReportsPage from '../reports/HoursReportsPage';

describe('HoursReportsPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><HoursReportsPage /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── InactiveMembersPage ──────────────────────────────────────────────────────

import InactiveMembersPage from '../reports/InactiveMembersPage';

describe('InactiveMembersPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><InactiveMembersPage /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── MemberReportsPage ────────────────────────────────────────────────────────

import MemberReportsPage from '../reports/MemberReportsPage';

describe('MemberReportsPage', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><MemberReportsPage /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── ModerationQueuePage ──────────────────────────────────────────────────────

import ModerationQueuePage from '../reports/ModerationQueuePage';

describe('ModerationQueuePage', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ModerationQueuePage /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── ResourcesAdmin ──────────────────────────────────────────────────────────

import ResourcesAdmin from '../resources/ResourcesAdmin';

describe('ResourcesAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ResourcesAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// The safeguarding dashboard became four broker pages in October 2026; its
// panels are covered by safeguarding/safeguardingPanels.test.tsx.
