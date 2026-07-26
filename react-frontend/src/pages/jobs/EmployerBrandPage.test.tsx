// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Partial mock — the real ui components pull in `@/lib/helpers`, which imports
// `src/i18n.ts` and needs `initReactI18next`, so a total mock of this module
// breaks collection for the whole file.
vi.mock('react-i18next', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-i18next')>();
  return {
    ...orig,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) =>
        (opts?.fallbackValue as string | undefined) ?? key,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('react-router-dom', () => {
  return {
    BrowserRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    MemoryRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useParams: () => ({ userId: '42' }),
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
    user: { id: 1, first_name: 'Test', name: 'Test User' },
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

// NOTE: no '@/components/ui' barrel mock. EmployerBrandPage imports Avatar,
// Button, Chip, GlassCard, Progress, Slider and Textarea from their DIRECT
// paths ('@/components/ui/Chip', ...), so a barrel mock never intercepts them —
// the real components render. Assertions below target the real DOM.

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>,
}));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: Array<{ label: string; href?: string }> }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: Record<string, unknown>) => (
      <div {...(rest as object)}>{children as ReactNode}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { EmployerBrandPage } from './EmployerBrandPage';
import { api } from '@/lib/api';

function makeEmployer(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: 'Test Employer',
    avatar_url: null,
    tagline: 'Community work that matters',
    company_size: '1-10',
    open_jobs_count: 1,
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Community Coordinator',
    type: 'paid',
    commitment: 'part_time',
    location: 'Dublin',
    is_remote: false,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_negotiable: false,
    deadline: null,
    benefits: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('EmployerBrandPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { employer: makeEmployer(), jobs: [] },
      meta: {},
    });
    render(<EmployerBrandPage />);
    expect(document.body).toBeTruthy();
  });

  it('shows loading screen while data is loading', async () => {
    let resolveRequest: (value: { success: boolean; data: unknown; meta: Record<string, unknown> }) => void = () => {};
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { unmount } = render(<EmployerBrandPage />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    resolveRequest({
      success: true,
      data: { employer: makeEmployer(), jobs: [] },
      meta: {},
    });
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    unmount();
  });

  it.skip('shows error message when API fails', async () => {
    vi.mocked(api.get).mockImplementation(() => Promise.reject(new Error('Network error')));
    // Suppress AbortController.abort to prevent race condition
    vi.spyOn(AbortController.prototype, 'abort').mockImplementation(() => {});
    render(<EmployerBrandPage />);
    await waitFor(() => {
      expect(screen.getByText(/unable to load|employer/i)).toBeInTheDocument();
    });
  });

  it('renders employer header and job list when data is loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeJob({ id: 1, title: 'Garden Coordinator' })],
      meta: {},
    });
    render(<EmployerBrandPage />);
    await waitFor(() => {
      expect(screen.getByText('Garden Coordinator')).toBeInTheDocument();
    });
    // The real GlassCard puts `glass-card` on its root (GlassCard.tsx:47). Asserting
    // it proves the real ui components mounted — a stub could never produce it, so a
    // future dead barrel mock cannot pass this test silently.
    expect(document.querySelectorAll('.glass-card').length).toBeGreaterThan(0);
  });

  it('renders Open Roles heading when jobs exist', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeJob()],
      meta: {},
    });
    render(<EmployerBrandPage />);
    await waitFor(() => {
      expect(screen.getByText('employer.open_roles_heading')).toBeInTheDocument();
    });
  });

  it('shows no roles message when no jobs are returned', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [],
      meta: {},
    });
    render(<EmployerBrandPage />);
    await waitFor(() => {
      expect(screen.getByText('employer.no_roles')).toBeInTheDocument();
    });
  });

  it('renders breadcrumbs', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeJob()],
      meta: {},
    });
    render(<EmployerBrandPage />);
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    });
  });

  it('renders View button for each job', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeJob({ id: 1, title: 'Role A' }), makeJob({ id: 2, title: 'Role B' })],
      meta: {},
    });
    render(<EmployerBrandPage />);
    await waitFor(() => {
      const viewButtons = screen.getAllByText('apply.view');
      expect(viewButtons.length).toBe(2);
    });
  });
});
