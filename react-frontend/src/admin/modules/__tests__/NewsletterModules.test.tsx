// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Newsletter admin modules:
 * - NewsletterList, NewsletterForm, NewsletterAnalytics,
 *   NewsletterBounces, NewsletterDiagnostics, NewsletterResend,
 *   NewsletterSendTimeOptimizer, Segments, Subscribers, Templates
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

// Mock admin API modules used by newsletter components
vi.mock('../../api/adminApi', () => ({
  adminNewsletters: {
    list: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [], meta: { page: 1, total_pages: 1, per_page: 20, total: 0, has_more: false } },
    }),
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { id: 1, name: 'Test Newsletter', subject: 'Test', status: 'draft', content: '<p>Content</p>' },
    }),
    create: vi.fn().mockResolvedValue({ success: true }),
    update: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    getSubscribers: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSegments: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getTemplates: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAnalytics: vi.fn().mockResolvedValue({
      success: true,
      data: { total_sent: 0, total_opens: 0, total_clicks: 0, avg_open_rate: 0, avg_click_rate: 0, campaigns: [] },
    }),
    getBounces: vi.fn().mockResolvedValue({ success: true, data: { bounces: [], total: 0 } }),
    getSuppressionList: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getResendInfo: vi.fn().mockResolvedValue({
      success: true,
      data: { newsletter: { id: 1, name: 'Test' }, non_openers: 0, non_clickers: 0 },
    }),
    resend: vi.fn().mockResolvedValue({ success: true }),
    getSendTimeData: vi.fn().mockResolvedValue({
      success: true,
      data: { heatmap: [], best_time: null, sample_size: 0 },
    }),
    getDiagnostics: vi.fn().mockResolvedValue({
      success: true,
      data: { smtp_status: 'ok', domain_status: 'ok', checks: [] },
    }),
  },
}));

// NewsletterForm renders the real NewsletterContentEditor (it is imported by its
// own path, not through the '../../components' barrel stubbed below), and that
// editor calls useConfirm — which THROWS outside a <ConfirmDialogProvider>, so
// the whole create-mode render collapsed. test-utils' render() does not install
// that provider. Stub the hook rather than the editor, so the editor itself stays
// under test. Same shape as PartnerVenuesAdminPage.test.tsx.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
  ConfirmDialogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the admin shared components used by newsletter modules
vi.mock('../../components', () => ({
  DataTable: ({ children }: { children: React.ReactNode }) => <div data-testid="data-table">{children}</div>,
  PageHeader: ({ title }: Record<string, unknown>) => <div data-testid="page-header">{title}</div>,
  StatCard: ({ label, value }: Record<string, unknown>) => <div data-testid="stat-card"><span>{label}</span><span>{value}</span></div>,
  StatusBadge: ({ status }: Record<string, unknown>) => <span>{status}</span>,
  ConfirmModal: () => null,
  EmptyState: ({ title }: Record<string, unknown>) => <div>{title}</div>,
  RichTextEditor: ({ value, onChange }: Record<string, unknown>) => <textarea data-testid="rich-text-editor" value={value} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => (onChange as ((v: string) => void))?.(e.target.value)} />,
  type: null,
}));

// ─── Wrapper helpers ─────────────────────────────────────────────────────────

function W({ children, path = '/test/admin' }: { children: React.ReactNode; path?: string }) {
  return (
    <>
      <MemoryRouter initialEntries={[path]}>
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

// ─── NewsletterList ──────────────────────────────────────────────────────────

import { NewsletterList } from '../newsletters/NewsletterList';

describe('NewsletterList', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NewsletterList /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NewsletterForm ──────────────────────────────────────────────────────────

import { NewsletterForm } from '../newsletters/NewsletterForm';

describe('NewsletterForm', () => {
  it('renders without crashing (create mode)', () => {
    const { container } = render(<W><NewsletterForm /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders without crashing (edit mode with route param)', () => {
    const { container } = render(
      <WRoute path="/admin/newsletters/:id/edit" entry="/admin/newsletters/1/edit">
        <NewsletterForm />
      </WRoute>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NewsletterAnalytics ─────────────────────────────────────────────────────

import { NewsletterAnalytics } from '../newsletters/NewsletterAnalytics';

describe('NewsletterAnalytics', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NewsletterAnalytics /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NewsletterBounces ───────────────────────────────────────────────────────

import { NewsletterBounces } from '../newsletters/NewsletterBounces';

describe('NewsletterBounces', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NewsletterBounces /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NewsletterDiagnostics ───────────────────────────────────────────────────

import { NewsletterDiagnostics } from '../newsletters/NewsletterDiagnostics';

describe('NewsletterDiagnostics', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NewsletterDiagnostics /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── NewsletterResend ────────────────────────────────────────────────────────
// Note: This component requires props (isOpen, onClose, newsletterId).

import { NewsletterResend } from '../newsletters/NewsletterResend';

describe('NewsletterResend', () => {
  it('renders without crashing when closed', () => {
    const { container } = render(
      <W>
        <NewsletterResend isOpen={false} onClose={vi.fn()} newsletterId={1} />
      </W>
    );
    expect(container).toBeTruthy();
  });

  it('renders without crashing when open', () => {
    const { container } = render(
      <W>
        <NewsletterResend isOpen={true} onClose={vi.fn()} newsletterId={1} />
      </W>
    );
    expect(container).toBeTruthy();
  });
});

// ─── NewsletterSendTimeOptimizer ─────────────────────────────────────────────

import { NewsletterSendTimeOptimizer } from '../newsletters/NewsletterSendTimeOptimizer';

describe('NewsletterSendTimeOptimizer', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><NewsletterSendTimeOptimizer /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── Segments ────────────────────────────────────────────────────────────────

import { Segments } from '../newsletters/Segments';

describe('Segments', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><Segments /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── Subscribers ─────────────────────────────────────────────────────────────

import { Subscribers } from '../newsletters/Subscribers';

describe('Subscribers', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><Subscribers /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── Templates ───────────────────────────────────────────────────────────────

import { Templates } from '../newsletters/Templates';

describe('Templates', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><Templates /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
