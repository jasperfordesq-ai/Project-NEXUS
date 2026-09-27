// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for admin modules batch 1:
 * - AdminDashboard
 * - AdminNotFound
 * - UserList, UserCreate, UserEdit
 * - ListingsAdmin
 * - BlogAdmin, BlogPostForm
 * - CategoriesAdmin
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  resolveAssetUrl: vi.fn((url) => url || ''),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/lib/motion');

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
}));

// Mock admin API modules
vi.mock('../../api/adminApi', () => ({
  adminDashboard: {
    getStats: vi.fn().mockResolvedValue({ success: true, data: { total_users: 100, active_users: 50, pending_users: 5, total_listings: 200, active_listings: 150, total_transactions: 300, total_hours_exchanged: 500, new_users_this_month: 10, new_listings_this_month: 20 } }),
    getTrends: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getActivity: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminUsers: {
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // paginated endpoints: `data` is the bare row array and pagination lives on the
    // sibling `meta`. Earlier fixtures nested `meta` inside `data`, a shape the
    // client never produces for these endpoints.
    list: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@test.com', role: 'member', status: 'active', balance: 10, has_2fa_enabled: false, is_super_admin: false, created_at: '2026-01-01', badges: [] } }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    approve: vi.fn().mockResolvedValue({ success: true }),
    recheckAllBadges: vi.fn().mockResolvedValue({ success: true }),
    recheckUserBadges: vi.fn().mockResolvedValue({ success: true }),
    getConsents: vi.fn().mockResolvedValue({ success: true, data: [] }),
    importUsers: vi.fn().mockResolvedValue({ success: true }),
  },
  adminListings: {
    list: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    approve: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminBlog: {
    list: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, title: 'Test', slug: 'test', status: 'draft', author_id: 1, created_at: '2026-01-01' } }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    toggleStatus: vi.fn().mockResolvedValue({ success: true }),
  },
  adminCategories: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminAttributes: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminDashboard
// ─────────────────────────────────────────────────────────────────────────────

import { AdminDashboard } from '../modules/dashboard/AdminDashboard';

describe('AdminDashboard', () => {
  it('renders without crashing', () => {
    render(<Wrapper><AdminDashboard /></Wrapper>);
    expect(screen.getByText('Mission Control')).toBeInTheDocument();
  });

  it('shows stat card labels', () => {
    render(<Wrapper><AdminDashboard /></Wrapper>);
    expect(screen.getByText('Total Members')).toBeInTheDocument();
    expect(screen.getByText('Active Listings')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText('Hours Exchanged')).toBeInTheDocument();
  });

  it('shows Quick Actions section', () => {
    render(<Wrapper><AdminDashboard /></Wrapper>);
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });

  it('shows Monthly Trends section', () => {
    render(<Wrapper><AdminDashboard /></Wrapper>);
    expect(screen.getByText('Transaction Trends')).toBeInTheDocument();
  });

  it('shows Recent Activity section', () => {
    render(<Wrapper><AdminDashboard /></Wrapper>);
    expect(screen.getByText('Real-time Activity')).toBeInTheDocument();
  });

  it('shows Refresh button', () => {
    render(<Wrapper><AdminDashboard /></Wrapper>);
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AdminNotFound
// ─────────────────────────────────────────────────────────────────────────────

import { AdminNotFound } from '../modules/AdminNotFound';

describe('AdminNotFound', () => {
  it('renders 404 message', () => {
    render(<Wrapper><AdminNotFound /></Wrapper>);
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  });

  it('shows back to dashboard button', () => {
    render(<Wrapper><AdminNotFound /></Wrapper>);
    expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ListingsAdmin
// ─────────────────────────────────────────────────────────────────────────────

import { ListingsAdmin } from '../modules/listings/ListingsAdmin';

describe('ListingsAdmin', () => {
  it('renders without crashing', () => {
    render(<Wrapper><ListingsAdmin /></Wrapper>);
    expect(screen.getByText('Listings Admin')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BlogAdmin
// ─────────────────────────────────────────────────────────────────────────────

import { BlogAdmin } from '../modules/blog/BlogAdmin';

describe('BlogAdmin', () => {
  it('renders without crashing', () => {
    render(<Wrapper><BlogAdmin /></Wrapper>);
    expect(screen.getByText('Blog Admin')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CategoriesAdmin
// ─────────────────────────────────────────────────────────────────────────────

import { CategoriesAdmin } from '../modules/categories/CategoriesAdmin';

describe('CategoriesAdmin', () => {
  it('renders without crashing', () => {
    render(<Wrapper><CategoriesAdmin /></Wrapper>);
    expect(screen.getByText('Categories Admin')).toBeInTheDocument();
  });
});
