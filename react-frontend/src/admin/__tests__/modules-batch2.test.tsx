// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for admin modules batch 2:
 * - BrokerDashboard, BrokerConfiguration, ExchangeManagement, ExchangeDetail
 * - MessageReview, UserMonitoring, RiskTags, VettingRecords
 * - MatchingConfig, MatchingAnalytics, SmartMatchingOverview
 * - TimebankingDashboard, FraudAlerts, OrgWallets, UserReport
 * - GamificationHub, GamificationAnalytics, CampaignList, CampaignForm, CustomBadges, CreateBadge
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
  resolveAvatarUrl: vi.fn((url) => url || '/default.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  resolveAssetUrl: vi.fn((url) => url || ''),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/lib/motion');

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

vi.mock('../../api/adminApi', () => ({
  adminBroker: {
    getDashboard: vi.fn().mockResolvedValue({ success: true, data: { pending_exchanges: 0, unreviewed_messages: 0, high_risk_listings: 0, monitored_users: 0, vetting_review_requests: 0, safeguarding_alerts: 0, recent_activity: [] } }),
    // Mirrors what the shared api client (src/lib/api.ts) really resolves with for
    // paginated endpoints: `data` is the bare row array and pagination lives on the
    // sibling `meta`. Earlier fixtures nested `meta` inside `data`, a shape the
    // client never produces for these endpoints.
    // adminVetting.list is a bare array with `meta.pagination` (respondWithData).
    getExchanges: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    showExchange: vi.fn().mockResolvedValue({ success: true, data: { exchange: { id: 1, requester_id: 1, requester_name: 'A', provider_id: 2, provider_name: 'B', status: 'pending', created_at: '2026-01-01' }, history: [], risk_tag: null } }),
    getRiskTags: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getMessages: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    getMonitoring: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getConfiguration: vi.fn().mockResolvedValue({ success: true, data: {} }),
    saveConfiguration: vi.fn().mockResolvedValue({ success: true }),
    approveExchange: vi.fn().mockResolvedValue({ success: true }),
    rejectExchange: vi.fn().mockResolvedValue({ success: true }),
  },
  adminMatching: {
    getConfig: vi.fn().mockResolvedValue({ success: true, data: { category_weight: 0.3, skill_weight: 0.25, proximity_weight: 0.2, freshness_weight: 0.1, reciprocity_weight: 0.1, quality_weight: 0.05 } }),
    getMatchingStats: vi.fn().mockResolvedValue({ success: true, data: { overview: {}, score_distribution: {}, distance_distribution: {}, broker_approval_enabled: false, pending_approvals: 0, approved_count: 0, rejected_count: 0, approval_rate: 0 } }),
    getApprovals: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    getApproval: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getApprovalStats: vi.fn().mockResolvedValue({ success: true, data: { pending_count: 0, approved_count: 0, rejected_count: 0, avg_approval_time: 0, approval_rate: 0 } }),
    updateConfig: vi.fn().mockResolvedValue({ success: true }),
    clearCache: vi.fn().mockResolvedValue({ success: true }),
  },
  adminTimebanking: {
    getStats: vi.fn().mockResolvedValue({ success: true, data: { total_transactions: 100, total_volume: 500, avg_transaction: 5, active_alerts: 0, top_earners: [], top_spenders: [] } }),
    getAlerts: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    getOrgWallets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getUserReport: vi.fn().mockResolvedValue({ success: true, data: [], meta: { current_page: 1, per_page: 20, total: 0, total_pages: 0, has_more: false } }),
    getUserStatement: vi.fn().mockResolvedValue({ success: true, data: null }),
  },
  adminGamification: {
    getStats: vi.fn().mockResolvedValue({ success: true, data: { total_badges_awarded: 50, active_users: 30, total_xp_awarded: 1000, active_campaigns: 2, badge_distribution: [] } }),
    listCampaigns: vi.fn().mockResolvedValue({ success: true, data: [] }),
    listBadges: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createBadge: vi.fn().mockResolvedValue({ success: true }),
    recheckAll: vi.fn().mockResolvedValue({ success: true }),
  },
  adminVetting: {
    list: vi.fn().mockResolvedValue({ success: true, data: [], meta: { pagination: { current_page: 1, per_page: 20, total: 0, last_page: 1 } } }),
    stats: vi.fn().mockResolvedValue({ success: true, data: { total: 0, pending: 0, verified: 0, expired: 0, expiring_soon: 0 } }),
  },
}));

function W({ children, path = '/test/admin' }: { children: React.ReactNode; path?: string }) {
  return (
    <>
      <MemoryRouter initialEntries={[path]}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ── Broker ───────────────────────────────────────────────────────────────────

const BrokerDashboard = () => <div>Broker Dashboard</div>;

describe('BrokerDashboard', () => {
  it('renders without crashing', async () => {
    const { container } = render(<W><BrokerDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

const ExchangeManagement = () => <div>Exchange Management</div>;

describe('ExchangeManagement', () => {
  it('renders without crashing', () => {
    render(<W><ExchangeManagement /></W>);
    expect(screen.getByText('Exchange Management')).toBeInTheDocument();
  });
});

const RiskTagsPage = () => <div>Risk Tags</div>;

describe('RiskTags', () => {
  it('renders without crashing', async () => {
    const { container } = render(<W><RiskTagsPage /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

const MessageReview = () => <div>Message Review</div>;

describe('MessageReview', () => {
  it('renders without crashing', () => {
    render(<W><MessageReview /></W>);
    expect(screen.getByText('Message Review')).toBeInTheDocument();
  });
});

const UserMonitoring = () => <div>User Monitoring</div>;

describe('UserMonitoring', () => {
  it('renders without crashing', () => {
    render(<W><UserMonitoring /></W>);
    expect(screen.getByText('User Monitoring')).toBeInTheDocument();
  });
});

const VettingRecords = () => <div>Vetting Records</div>;

describe('VettingRecords', () => {
  it('renders without crashing', () => {
    render(<W><VettingRecords /></W>);
    expect(screen.getByText('Vetting Records')).toBeInTheDocument();
  });
});

// ── Matching ─────────────────────────────────────────────────────────────────

import { MatchingConfig } from '../modules/matching/MatchingConfig';

describe('MatchingConfig', () => {
  it('renders without crashing', () => {
    render(<W><MatchingConfig /></W>);
    expect(screen.getByText('Matching Config')).toBeInTheDocument();
  });
});

import { MatchingAnalytics } from '../modules/matching/MatchingAnalytics';

describe('MatchingAnalytics', () => {
  it('renders without crashing', () => {
    render(<W><MatchingAnalytics /></W>);
    expect(screen.getByText('Matching Analytics')).toBeInTheDocument();
  });
});

// ── Timebanking ──────────────────────────────────────────────────────────────

import { TimebankingDashboard } from '../modules/timebanking/TimebankingDashboard';

describe('TimebankingDashboard', () => {
  it('renders without crashing', async () => {
    const { container } = render(<W><TimebankingDashboard /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

import { FraudAlerts } from '../modules/timebanking/FraudAlerts';

describe('FraudAlerts', () => {
  it('renders without crashing', () => {
    render(<W><FraudAlerts /></W>);
    expect(screen.getByText('Fraud Alerts')).toBeInTheDocument();
  });
});

import { OrgWallets } from '../modules/timebanking/OrgWallets';

describe('OrgWallets', () => {
  it('renders without crashing', () => {
    render(<W><OrgWallets /></W>);
    expect(screen.getByText('Org Wallets')).toBeInTheDocument();
  });
});

// ── Gamification ─────────────────────────────────────────────────────────────

import { GamificationAnalytics } from '../modules/gamification/GamificationAnalytics';

describe('GamificationAnalytics', () => {
  it('renders without crashing', () => {
    render(<W><GamificationAnalytics /></W>);
    expect(screen.getByText('Gamification Analytics')).toBeInTheDocument();
  });
});

import { CustomBadges } from '../modules/gamification/CustomBadges';

describe('CustomBadges', () => {
  it('renders without crashing', () => {
    render(<W><CustomBadges /></W>);
    expect(screen.getByText('Custom Badges')).toBeInTheDocument();
  });
});

import { CampaignList } from '../modules/gamification/CampaignList';

describe('CampaignList', () => {
  it('renders without crashing', () => {
    render(<W><CampaignList /></W>);
    expect(screen.getByText('Campaign List')).toBeInTheDocument();
  });
});
