// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('react-router-dom', () => {
  return {
    BrowserRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    MemoryRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useParams: () => ({ id: '1' }),
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      <a href={String(to)} {...rest}>{children}</a>,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: null, meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

const mockHasFeature = vi.fn(() => true);
const mockUseAuth = vi.fn(() => ({
  user: { id: 1, first_name: 'Test', name: 'Test User' },
  isAuthenticated: true,
}));

vi.mock('@/contexts', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test$${p}`,
    hasFeature: mockHasFeature,
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/components/ui', () => {
  const Box = ({ children, label, title, description }: Record<string, unknown>) => (
    <div>
      {label as ReactNode}
      {title as ReactNode}
      {description as ReactNode}
      {children as ReactNode}
    </div>
  );
  const Chip = Object.assign(Box, {
    Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  });
  return {
    Chip,
    GlassCard: Box,
    Progress: ({ value, 'aria-label': ariaLabel }: Record<string, unknown>) => (
      <progress aria-label={ariaLabel as string | undefined} value={value as number | undefined} max={100} />
    ),
    Button: ({ children, onPress, onClick }: Record<string, unknown>) => (
      <button type="button" onClick={(onPress ?? onClick) as (() => void) | undefined}>{children as ReactNode}</button>
    ),
    Spinner: () => <div role="status" />,
    Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
    CardRowsSkeleton: () => <div role="status" aria-busy="true" />,
    Skeleton: () => <div role="status" aria-busy="true" />,
  };
});

// JobAnalyticsPage imports Tooltip from '@/components/ui/Tooltip' directly, so the override in
// the barrel factory above never applies — vitest resolves mocks per specifier.
vi.mock('@/components/ui/Tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid='empty-state'>
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, variants: _v, initial: _i, animate: _a, layout: _l, ...rest }: Record<string, unknown>) => (
      <div {...(rest as object)}>{children as ReactNode}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>({children as ReactNode})</>,
}));

import { JobAnalyticsPage } from './JobAnalyticsPage';
import { api } from '@/lib/api';

function makeAnalytics(overrides: Record<string, unknown> = {}) {
  return {
    job_id: 1,
    total_views: 150,
    unique_viewers: 80,
    total_applications: 12,
    conversion_rate: 8,
    avg_time_to_apply_hours: 24,
    time_to_fill_days: 14,
    views_by_day: [
      { date: '2026-01-01', count: 10 },
      { date: '2026-01-02', count: 15 },
    ],
    applications_by_stage: [
      { stage: 'applied', count: 5 },
      { stage: 'interview', count: 3 },
    ],
    created_at: '2026-01-01T00:00:00Z',
    status: 'open',
    ...overrides,
  };
}

describe('JobAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: makeAnalytics(), meta: {} });
  });

  it('renders loading state initially when API is pending', () => {
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => {
      window.setTimeout(() => resolve({ success: true, data: makeAnalytics(), meta: {} }), 25);
    }));
    const { unmount } = render(<JobAnalyticsPage />);
    expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);
    unmount();
  });

  it('renders error empty state when API fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Server error', data: null, meta: {} });
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('renders analytics stats cards (views, applications, conversion rate)', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('analytics.total_views')).toBeInTheDocument();
    });
    expect(screen.getByText('analytics.total_applications')).toBeInTheDocument();
    expect(screen.getByText('analytics.conversion_rate')).toBeInTheDocument();
    expect(screen.getByText('analytics.unique_viewers')).toBeInTheDocument();
  });

  it('renders total_views value', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
    });
  });

  it('renders applications_by_stage breakdown', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('analytics.applications_by_stage')).toBeInTheDocument();
    });
    expect(screen.getByText('application_status.applied')).toBeInTheDocument();
    expect(screen.getByText('application_status.interview')).toBeInTheDocument();
  });

  it('shows avg_time_to_apply metric when available', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('analytics.avg_time_to_apply')).toBeInTheDocument();
    });
  });

  it('shows time_to_fill metric when available', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('analytics.time_to_fill')).toBeInTheDocument();
    });
  });

  it('does NOT show time_to_fill when null', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true, data: makeAnalytics({ time_to_fill_days: null }), meta: {},
    });
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('analytics.total_views')).toBeInTheDocument();
    });
    expect(screen.queryByText('analytics.time_to_fill')).not.toBeInTheDocument();
  });

  it('renders views_by_day section', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      expect(screen.getByText('analytics.views_over_time')).toBeInTheDocument();
    });
  });

  it('back link navigation is present', async () => {
    render(<JobAnalyticsPage />);
    await waitFor(() => {
      const backLink = screen.getByRole('link', { name: /browse/i });
      expect(backLink).toBeInTheDocument();
    });
  });
});
