// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for System/cross-cutting admin modules:
 * - AdminDashboard, CommunityAnalytics, ImpactReport,
 *   CategoriesAdmin, ListingsAdmin, TenantFeatures,
 *   MatchingConfig, SmartMatchingOverview
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

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

// CommunityAnalytics imports LocationMap and MAPS_ENABLED
// CommunityAnalytics lazy-imports '@/components/location/LocationMap' by its direct path, so a
// stub registered only on the '@/components/location' barrel never applies — the real map would
// load, pulling in its own direct '@/contexts/TenantContext' and '@/contexts/ThemeContext'
// imports. Mock both specifiers so the stub actually takes effect.
vi.mock('@/components/location', () => ({
  LocationMap: () => <div data-testid="mock-location-map">Map</div>,
}));
vi.mock('@/components/location/LocationMap', () => ({
  LocationMap: () => <div data-testid="mock-location-map">Map</div>,
}));

vi.mock('@/lib/map-config', () => ({
  MAPS_ENABLED: false,
}));

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_target: unknown, tag: string | symbol) => {
      const Component = ({ children, variants, initial, animate, exit, layout, whileHover, whileTap, transition, ...rest }: Record<string, unknown>) => {
        void variants; void initial; void animate; void exit; void layout; void whileHover; void whileTap; void transition;
        const Tag = typeof tag === 'string' ? tag : 'div';
        return <Tag {...rest}>{children}</Tag>;
      };
      return Component;
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null, Cell: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
}));

// Mock admin API modules used by system/cross-cutting components
vi.mock('../../api/adminApi', () => ({
  adminDashboard: {
    getStats: vi.fn().mockResolvedValue({
      success: true,
      data: {
        total_users: 100, active_users: 50, pending_users: 5,
        total_listings: 200, active_listings: 150,
        total_transactions: 300, total_hours_exchanged: 500,
        new_users_this_month: 10, new_listings_this_month: 20,
      },
    }),
    getTrends: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getActivity: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminCommunityAnalytics: {
    getData: vi.fn().mockResolvedValue({
      success: true,
      data: {
        overview: {
          total_credits_circulation: 1000, transaction_volume_30d: 100,
          transaction_count_30d: 50, active_traders_30d: 20,
          new_users_30d: 10, avg_transaction_size: 2,
        },
        trends: [], category_distribution: [], top_traders: [],
        geographic: { locations: [] },
      },
    }),
    exportCsv: vi.fn().mockResolvedValue({ success: true }),
  },
  adminImpactReport: {
    getData: vi.fn().mockResolvedValue({
      success: true,
      data: {
        sroi: { value: 5.2, total_value: 50000, hourly_value: 15, social_multiplier: 1.5 },
        health: { overall_score: 85, dimensions: [] },
        timeline: [],
        community: { total_members: 100, active_members: 50 },
      },
    }),
    updateConfig: vi.fn().mockResolvedValue({ success: true }),
  },
  adminCategories: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminListings: {
    list: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    approve: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminConfig: {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { features: {}, modules: {} },
    }),
    updateFeature: vi.fn().mockResolvedValue({ success: true }),
    updateModule: vi.fn().mockResolvedValue({ success: true }),
    getCacheStats: vi.fn().mockResolvedValue({
      success: true,
      data: { keys: 0, hits: 0, misses: 0, memory: 0 },
    }),
    clearCache: vi.fn().mockResolvedValue({ success: true }),
    getJobs: vi.fn().mockResolvedValue({ success: true, data: [] }),
    runJob: vi.fn().mockResolvedValue({ success: true }),
  },
  adminMatching: {
    getConfig: vi.fn().mockResolvedValue({
      success: true,
      data: {
        category_weight: 0.3, skill_weight: 0.25, proximity_weight: 0.2,
        freshness_weight: 0.1, reciprocity_weight: 0.1, quality_weight: 0.05,
      },
    }),
    getMatchingStats: vi.fn().mockResolvedValue({
      success: true,
      data: {
        overview: {}, score_distribution: {}, distance_distribution: {},
        broker_approval_enabled: false, pending_approvals: 0,
        approved_count: 0, rejected_count: 0, approval_rate: 0,
      },
    }),
    getApprovals: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    getApprovalStats: vi.fn().mockResolvedValue({
      success: true,
      data: { pending_count: 0, approved_count: 0, rejected_count: 0, avg_approval_time: 0, approval_rate: 0 },
    }),
    updateConfig: vi.fn().mockResolvedValue({ success: true }),
    clearCache: vi.fn().mockResolvedValue({ success: true }),
  },
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

// ─── AdminDashboard ──────────────────────────────────────────────────────────

import { AdminDashboard } from '../dashboard/AdminDashboard';

describe('AdminDashboard', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AdminDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CommunityAnalytics ──────────────────────────────────────────────────────

import { CommunityAnalytics } from '../analytics/CommunityAnalytics';

describe('CommunityAnalytics', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CommunityAnalytics /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── ImpactReport ────────────────────────────────────────────────────────────

import { ImpactReport } from '../impact/ImpactReport';

describe('ImpactReport', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ImpactReport /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CategoriesAdmin ─────────────────────────────────────────────────────────

import { CategoriesAdmin } from '../categories/CategoriesAdmin';

describe('CategoriesAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CategoriesAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── ListingsAdmin ───────────────────────────────────────────────────────────

import { ListingsAdmin } from '../listings/ListingsAdmin';

describe('ListingsAdmin', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><ListingsAdmin /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── TenantFeatures retired — unified into ModuleConfiguration ─────────────
// The /admin/tenant-features page was removed and now redirects to
// /admin/module-configuration. See ModuleConfiguration tests below.

// ─── MatchingConfig ──────────────────────────────────────────────────────────

import { MatchingConfig } from '../matching/MatchingConfig';

describe('MatchingConfig', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><MatchingConfig /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SmartMatchingOverview ───────────────────────────────────────────────────

import { SmartMatchingOverview } from '../matching/SmartMatchingOverview';

describe('SmartMatchingOverview', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SmartMatchingOverview /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

