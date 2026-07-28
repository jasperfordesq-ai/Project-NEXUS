// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for remaining untested admin modules:
 * - BlogPostForm, SmartMatchMonitoring, SmartMatchUsers,
 *   MatchingDiagnostic, NexusScoreAnalytics,
 *   LegalDocVersionList, CampaignForm, CreateBadge, GamificationHub,
 *   VolunteerApprovals, VolunteeringOverview, VolunteerOrganizations
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

// Some modules import hooks/contexts from specific paths
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useApi', () => ({
  useApi: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    execute: vi.fn(),
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

// Mock admin API modules used by remaining components
vi.mock('../../api/adminApi', () => ({
  adminBlog: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { id: 1, title: 'Test Post', slug: 'test', content: '', excerpt: '', status: 'draft', category_id: null, featured_image: null, meta_description: '' },
    }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminCategories: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminMatching: {
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
    getApproval: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 1, user_listing_id: 1, matched_listing_id: 2,
        score: 85, status: 'pending', created_at: '2026-01-01',
        user_listing: { id: 1, title: 'Offer A', type: 'offer' },
        matched_listing: { id: 2, title: 'Request B', type: 'request' },
        user: { id: 1, name: 'User A' },
        matched_user: { id: 2, name: 'User B' },
      },
    }),
    approveMatch: vi.fn().mockResolvedValue({ success: true }),
    rejectMatch: vi.fn().mockResolvedValue({ success: true }),
  },
  adminDiagnostics: {
    getMatchingStats: vi.fn().mockResolvedValue({ success: true, data: { checks: [], overall_status: 'ok' } }),
    diagnoseUser: vi.fn().mockResolvedValue({ success: true, data: {} }),
    diagnoseListing: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getNexusScoreStats: vi.fn().mockResolvedValue({
      success: true,
      data: { distribution: [], average: 0, median: 0, trends: [] },
    }),
  },
  adminGamification: {
    getStats: vi.fn().mockResolvedValue({
      success: true,
      data: { total_badges: 0, total_challenges: 0, active_campaigns: 0, xp_shop_items: 0, stats: {} },
    }),
    recheckAll: vi.fn().mockResolvedValue({ success: true }),
    listBadges: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createBadge: vi.fn().mockResolvedValue({ success: true }),
    listCampaigns: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createCampaign: vi.fn().mockResolvedValue({ success: true }),
    updateCampaign: vi.fn().mockResolvedValue({ success: true }),
  },
  adminVolunteering: {
    getOverview: vi.fn().mockResolvedValue({
      success: true,
      data: {
        total_opportunities: 0, total_applications: 0, total_hours: 0,
        pending_approvals: 0, organizations: 0, active_volunteers: 0,
      },
    }),
    getApprovals: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    approveApplication: vi.fn().mockResolvedValue({ success: true }),
    declineApplication: vi.fn().mockResolvedValue({ success: true }),
    getOrganizations: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// Mock the @/admin/api/adminApi path for LegalDoc and moderation modules
// (some modules import from @/admin/api/adminApi instead of relative ../../api/adminApi)
vi.mock('@/admin/api/adminApi', () => ({
  adminLegalDocs: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({ success: true, data: { id: 1, document_type: 'terms', title: 'Terms', content: '' } }),
    getVersions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getVersion: vi.fn().mockResolvedValue({ success: true, data: {} }),
    createVersion: vi.fn().mockResolvedValue({ success: true }),
    publishVersion: vi.fn().mockResolvedValue({ success: true }),
    notifyUsers: vi.fn().mockResolvedValue({ success: true }),
    compareVersions: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getUsersPendingCount: vi.fn().mockResolvedValue({ success: true, data: 0 }),
  },
  adminMatching: {
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
    getApproval: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 1, user_listing_id: 1, matched_listing_id: 2,
        score: 85, status: 'pending', created_at: '2026-01-01',
        user_listing: { id: 1, title: 'Offer A', type: 'offer' },
        matched_listing: { id: 2, title: 'Request B', type: 'request' },
        user: { id: 1, name: 'User A' },
        matched_user: { id: 2, name: 'User B' },
      },
    }),
    approveMatch: vi.fn().mockResolvedValue({ success: true }),
    rejectMatch: vi.fn().mockResolvedValue({ success: true }),
  },
  adminGamification: {
    getStats: vi.fn().mockResolvedValue({
      success: true,
      data: { total_badges: 0, total_challenges: 0, active_campaigns: 0, xp_shop_items: 0, stats: {} },
    }),
    recheckAll: vi.fn().mockResolvedValue({ success: true }),
    listBadges: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createBadge: vi.fn().mockResolvedValue({ success: true }),
    listCampaigns: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createCampaign: vi.fn().mockResolvedValue({ success: true }),
    updateCampaign: vi.fn().mockResolvedValue({ success: true }),
  },
  adminDiagnostics: {
    getMatchingStats: vi.fn().mockResolvedValue({ success: true, data: { checks: [], overall_status: 'ok' } }),
    diagnoseUser: vi.fn().mockResolvedValue({ success: true, data: {} }),
    diagnoseListing: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getNexusScoreStats: vi.fn().mockResolvedValue({
      success: true,
      data: { distribution: [], average: 0, median: 0, trends: [] },
    }),
  },
  adminVolunteering: {
    getOverview: vi.fn().mockResolvedValue({
      success: true,
      data: {
        total_opportunities: 0, total_applications: 0, total_hours: 0,
        pending_approvals: 0, organizations: 0, active_volunteers: 0,
      },
    }),
    getApprovals: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    approveApplication: vi.fn().mockResolvedValue({ success: true }),
    declineApplication: vi.fn().mockResolvedValue({ success: true }),
    getOrganizations: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
  adminBlog: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { id: 1, title: 'Test Post', slug: 'test', content: '', excerpt: '', status: 'draft', category_id: null, featured_image: null, meta_description: '' },
    }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  adminCategories: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

// Mock the LegalDocVersionComparison component used by LegalDocVersionList
vi.mock('../enterprise/LegalDocVersionComparison', () => ({
  default: () => null,
}));

// Mock admin API types
vi.mock('@/admin/api/types', () => ({}));

// ─── Wrapper helpers ─────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

function WRoute({ children, path, entry }: { children: React.ReactNode; path: string; entry: string }) {
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

// ─── BlogPostForm ───────────────────────────────────────────────────────────

import { BlogPostForm } from '../blog/BlogPostForm';

describe('BlogPostForm', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/admin/blog/:id" entry="/admin/blog/1">
        <BlogPostForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SmartMatchMonitoring ───────────────────────────────────────────────────

import { SmartMatchMonitoring } from '../community/SmartMatchMonitoring';

describe('SmartMatchMonitoring', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SmartMatchMonitoring /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SmartMatchUsers ────────────────────────────────────────────────────────

import { SmartMatchUsers } from '../community/SmartMatchUsers';

describe('SmartMatchUsers', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SmartMatchUsers /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── MatchingDiagnostic ─────────────────────────────────────────────────────

import { MatchingDiagnostic } from '../diagnostics/MatchingDiagnostic';

describe('MatchingDiagnostic', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><MatchingDiagnostic /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NexusScoreAnalytics ────────────────────────────────────────────────────

import { NexusScoreAnalytics } from '../diagnostics/NexusScoreAnalytics';

describe('NexusScoreAnalytics', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NexusScoreAnalytics /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// LegalDocVersionForm's block was removed here: the component was deleted in
// 3a7cc6463, which replaced the modal form with the full-page LegalDocEditor
// (covered by src/admin/components/LegalDocEditor.test.tsx). The import was left
// behind and could not resolve, which failed this ENTIRE file at transform time
// — so every other suite in it was silently absent rather than reported failing.
// No coverage is lost by deleting it; there is nothing left to cover.

// ─── LegalDocVersionList ────────────────────────────────────────────────────

import LegalDocVersionList from '../enterprise/LegalDocVersionList';

describe('LegalDocVersionList', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/admin/legal-docs/:id/versions" entry="/admin/legal-docs/1/versions">
        <LegalDocVersionList />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CampaignForm ───────────────────────────────────────────────────────────

import { CampaignForm } from '../gamification/CampaignForm';

describe('CampaignForm', () => {
  it('renders without crashing with route param', () => {
    const { container } = render(
      <WRoute path="/admin/gamification/campaigns/:id" entry="/admin/gamification/campaigns/1">
        <CampaignForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── CreateBadge ────────────────────────────────────────────────────────────

import { CreateBadge } from '../gamification/CreateBadge';

describe('CreateBadge', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><CreateBadge /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── GamificationHub ────────────────────────────────────────────────────────

import { GamificationHub } from '../gamification/GamificationHub';

describe('GamificationHub', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><GamificationHub /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── VolunteerApprovals ─────────────────────────────────────────────────────

import { VolunteerApprovals } from '../volunteering/VolunteerApprovals';

describe('VolunteerApprovals', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><VolunteerApprovals /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── VolunteeringOverview ───────────────────────────────────────────────────

import { VolunteeringOverview } from '../volunteering/VolunteeringOverview';

describe('VolunteeringOverview', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><VolunteeringOverview /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── VolunteerOrganizations ─────────────────────────────────────────────────

import { VolunteerOrganizations } from '../volunteering/VolunteerOrganizations';
import { Modal, ModalContent } from '@/components/ui';

describe('VolunteerOrganizations', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><VolunteerOrganizations /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
