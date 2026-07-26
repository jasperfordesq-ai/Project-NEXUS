// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
}));

vi.mock('react-router-dom', () => {
  return {
    BrowserRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    MemoryRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
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

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', is_admin: true },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => mockTenant),
  useToast: vi.fn(() => mockToast),
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

// NOTE: no '@/components/ui' barrel mock. BiasAuditPage imports every UI symbol by
// its DIRECT path ('@/components/ui/GlassCard', '/Button', '/Table', …), so a barrel
// mock would never be consulted for them — it would only shadow the barrel for
// *internal* consumers (e.g. Skeletons.tsx imports Skeleton from the barrel) and
// break them. The real components render fine in jsdom; assertions target real DOM.

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: Record<string, unknown>) => (
      <div {...(rest as object)}>{children as ReactNode}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { BiasAuditPage } from './BiasAuditPage';
import { api } from '@/lib/api';

function makeReport() {
  return {
    period: { from: '2025-01-01', to: '2026-01-01' },
    total_applications: 50,
    funnel: [
      { stage: 'applied', count: 50, percentage: 100 },
      { stage: 'screening', count: 30, percentage: 60 },
      { stage: 'interview', count: 15, percentage: 30 },
      { stage: 'offer', count: 5, percentage: 10 },
      { stage: 'accepted', count: 3, percentage: 6 },
    ],
    rejection_rates: {
      screening: { rejections: 20, total_at_stage: 50, rate: 40 },
      interview: { rejections: 15, total_at_stage: 30, rate: 50 },
    },
    avg_time_in_stage: {
      applied: 2,
      screening: 5,
      interview: 7,
    },
    skills_match_correlation: {
      accepted_count: 3,
      rejected_count: 47,
      acceptance_rate: 6,
      note: 'test note',
    },
    source_effectiveness: {
      direct: { total_applications: 30, accepted: 2, acceptance_rate: 7 },
      referral: { total_applications: 20, accepted: 1, acceptance_rate: 5 },
    },
    hiring_velocity_days: 14,
  };
}

describe('BiasAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: API returns report data
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/admin/jobs/bias-audit')) {
        return Promise.resolve({ success: true, data: makeReport(), meta: {} });
      }
      // Jobs dropdown
      return Promise.resolve({ success: true, data: [], meta: {} });
    });
  });

  it('renders without crashing', () => {
    render(<BiasAuditPage />);
    expect(document.body).toBeTruthy();
  });

  it('renders the page heading', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.title')).toBeInTheDocument();
    });
  });

  it('renders the privacy notice card', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.note_privacy')).toBeInTheDocument();
    });
  });

  it('renders the generate report button', () => {
    render(<BiasAuditPage />);
    expect(screen.getByText('bias_audit.generate')).toBeInTheDocument();
  });

  it('shows loading state when API is pending', () => {
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => {
      window.setTimeout(() => resolve({ success: true, data: makeReport(), meta: {} }), 25);
    }));
    const { unmount } = render(<BiasAuditPage />);
    expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);
    unmount();
  });

  it('renders funnel section when report data is loaded', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      const elements = screen.getAllByText('bias_audit.funnel_title');
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders rejection rates section when report data is loaded', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.rejection_rates_title')).toBeInTheDocument();
    });
  });

  it('renders time-in-stage section when report data is loaded', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.time_in_stage_title')).toBeInTheDocument();
    });
  });

  it('renders skills match section when report data is loaded', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.skills_match_title')).toBeInTheDocument();
    });
  });

  it('renders source effectiveness section when report data is loaded', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.source_title')).toBeInTheDocument();
    });
  });

  it('renders key metric cards when report data is loaded', async () => {
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByText('bias_audit.total_applications')).toBeInTheDocument();
      expect(screen.getByText('bias_audit.hiring_velocity')).toBeInTheDocument();
      // acceptance_rate appears in both metric card and skills match section
      const acceptanceEls = screen.getAllByText('bias_audit.acceptance_rate');
      expect(acceptanceEls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/admin/jobs/bias-audit')) {
        return Promise.resolve({ success: false, data: null, error: 'Failed', meta: {} });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    });
    render(<BiasAuditPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders back navigation link', () => {
    render(<BiasAuditPage />);
    expect(screen.getByText('title')).toBeInTheDocument();
  });
});
