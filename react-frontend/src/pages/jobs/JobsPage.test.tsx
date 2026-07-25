// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Partial mock — src/test/setup.ts imports `initReactI18next` to bootstrap i18n,
// so a total mock of this module breaks collection for the whole file.
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
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      <a href={String(to)} {...rest}>{children}</a>,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useLocation: () => ({ pathname: '/test/jobs', search: '', hash: '', state: null, key: 'test' }),
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
    tenantPath: (p: string) => `/test${p}`,
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

// JobsPage imports PageMeta by direct path. setup.ts only stubs the
// `@/components/seo` barrel, and the real PageMeta needs both a TenantProvider
// (direct-path useTenant) and a HelmetProvider. It renders no visible DOM.
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// NOTE: deliberately NOT mocking the `@/components/ui` barrel. JobsPage imports
// every primitive by direct path (`@/components/ui/Button`, `/Chip`, `/GlassCard`,
// `/SearchField`, `/Select`, `/Skeletons`, `/Switch`, `/Tabs`, `/ToggleButtonGroup`),
// so a barrel mock covers none of them — and it breaks the real primitives that
// consume the barrel internally (Skeletons imports `Skeleton` from it). Assertions
// below therefore target the real HeroUI DOM.

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
    div: ({ children, _variants, _initial, _animate, _layout, ...rest }: Record<string, unknown>) => (
      <div {...(rest as object)}>{children as ReactNode}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>({children as ReactNode})</>,
}));

import { JobsPage } from './JobsPage';
import { api } from '@/lib/api';

function makeVacancy(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, title: 'Community Garden Coordinator',
    description: 'Help coordinate the community garden.',
    location: 'Dublin', is_remote: false, type: 'paid',
    commitment: 'part_time', category: 'Environment',
    skills: ['Gardening', 'Communication'],
    skills_required: null, hours_per_week: 10, time_credits: null,
    deadline: null, status: 'open', views_count: 42, applications_count: 3,
    created_at: '2026-01-01T00:00:00Z',
    creator: { id: 1, name: 'Alice', avatar_url: null },
    organization: null, has_applied: false, application_status: null,
    application_stage: null, is_saved: false, is_featured: false,
    featured_until: null, salary_min: null, salary_max: null,
    salary_type: null, salary_currency: null, salary_negotiable: false,
    expired_at: null, renewed_at: null, renewal_count: 0, user_id: 1,
    contact_email: null, contact_phone: null,
    ...overrides,
  };
}

describe('JobsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { id: 1, first_name: 'Test', name: 'Test User' },
      isAuthenticated: true,
    });
    vi.mocked(api.get).mockResolvedValue({
      success: true, data: [], meta: { has_more: false, cursor: null },
    });
  });

  it('renders without crashing when feature is enabled', () => {
    render(<JobsPage />);
    expect(document.body).toBeTruthy();
  });

  it('renders feature-disabled message when job_vacancies feature is off', () => {
    mockHasFeature.mockReturnValue(false);
    render(<JobsPage />);
    expect(screen.getByText('feature_not_available')).toBeInTheDocument();
  });

  it('shows loading skeleton initially when API is pending', () => {
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => {
      window.setTimeout(() => resolve({
        success: true,
        data: [],
        meta: { has_more: false, cursor: null },
      }), 25);
    }));
    const { unmount } = render(<JobsPage />);
    expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);
    unmount();
  });

  it('shows empty state when no jobs returned', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true, data: [], meta: { has_more: false, cursor: null },
    });
    render(<JobsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('empty_title')).toBeInTheDocument();
  });

  it('renders job card title when jobs are returned', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeVacancy({ title: 'Community Garden Coordinator' })],
      meta: { has_more: false, cursor: null },
    });
    render(<JobsPage />);
    await waitFor(() => {
      expect(screen.getByText('Community Garden Coordinator')).toBeInTheDocument();
    });
  });

  it('shows search input', () => {
    render(<JobsPage />);
    // The real SearchField renders <input type="search"> → role `searchbox`.
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('shows type filter chips (all, paid, volunteer, timebank)', () => {
    render(<JobsPage />);
    ['type.all', 'type.paid', 'type.volunteer', 'type.timebank'].forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  it('shows commitment filter chips (all, full_time, part_time, flexible, one_off)', () => {
    render(<JobsPage />);
    ['commitment.all', 'commitment.full_time', 'commitment.part_time',
     'commitment.flexible', 'commitment.one_off'].forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  it('shows Create Vacancy button when authenticated', () => {
    render(<JobsPage />);
    expect(screen.getByText('create_vacancy')).toBeInTheDocument();
  });

  it('shows Job Alerts button when authenticated', () => {
    render(<JobsPage />);
    expect(screen.getByText('alerts.title')).toBeInTheDocument();
  });

  it('does NOT show Create Vacancy button when not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false });
    render(<JobsPage />);
    expect(screen.queryByText('create_vacancy')).not.toBeInTheDocument();
  });

  it('shows Saved Jobs tab when authenticated', () => {
    render(<JobsPage />);
    expect(screen.getByText('saved.title')).toBeInTheDocument();
  });

  it('shows featured badge chip on featured jobs (J10)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeVacancy({ id: 10, is_featured: true, title: 'Featured Posting' })],
      meta: { has_more: false, cursor: null },
    });
    render(<JobsPage />);
    await waitFor(() => { expect(screen.getByText('Featured Posting')).toBeInTheDocument(); });
    expect(screen.getByText('featured')).toBeInTheDocument();
  });

  it('shows salary display when salary_min and salary_max present (J9)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeVacancy({ id: 20, title: 'Salaried Role', salary_min: 30000, salary_max: 50000, salary_currency: 'EUR' })],
      meta: { has_more: false, cursor: null },
    });
    render(<JobsPage />);
    await waitFor(() => { expect(screen.getByText('Salaried Role')).toBeInTheDocument(); });
    expect(screen.getByText(/30,000/)).toBeInTheDocument();
  });

  it('shows remote indicator when is_remote is true', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [makeVacancy({ id: 30, is_remote: true, location: null, title: 'Remote Role' })],
      meta: { has_more: false, cursor: null },
    });
    render(<JobsPage />);
    await waitFor(() => { expect(screen.getByText('Remote Role')).toBeInTheDocument(); });
    expect(screen.getByText('remote')).toBeInTheDocument();
  });

  it('shows load more button when has_more is true', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true, data: [makeVacancy()], meta: { has_more: true, cursor: 'abc' },
    });
    render(<JobsPage />);
    await waitFor(() => { expect(screen.getByText('load_more')).toBeInTheDocument(); });
  });

  it('does NOT show load more button when has_more is false', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true, data: [makeVacancy()], meta: { has_more: false, cursor: null },
    });
    render(<JobsPage />);
    await waitFor(() => { expect(screen.queryByText('load_more')).not.toBeInTheDocument(); });
  });

  it('makes initial API call to /v2/jobs with status=open', async () => {
    render(<JobsPage />);
    await waitFor(() => { expect(vi.mocked(api.get)).toHaveBeenCalled(); });
    const callUrl = vi.mocked(api.get).mock.calls[0][0] as string;
    expect(callUrl).toContain('/v2/jobs');
    expect(callUrl).toContain('status=open');
  });

  it('passes type=paid filter to API when paid chip is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<JobsPage />);
    await userEvent.click(screen.getByText('type.paid'));
    await waitFor(() => {
      const calls = vi.mocked(api.get).mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes('type=paid'))).toBe(true);
    });
  });
});
