// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockNavigate = vi.fn();
vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
  }),
}));

vi.mock('react-router-dom', () => {
  return {
    BrowserRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    MemoryRouter: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '1' }),
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      <a href={String(to)} {...rest}>{children}</a>,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useLocation: () => ({ pathname: '/test/jobs/1', search: '', hash: '', state: null, key: 'test' }),
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
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
// NOTE: no `@/components/social` mock either — JobDetailPage imports
// `SocialInteractionPanel` from its direct path, so a barrel mock never applied.
// The real panel renders fine here (api + contexts are already stubbed).

// NOTE: deliberately NOT mocking the `@/components/ui` barrel. JobDetailPage
// imports every primitive by direct path (`@/components/ui/Button`, `/GlassCard`,
// `/Skeletons`, `/useDisclosure`), so a barrel mock overrides none of them — and it
// breaks the real primitives that consume the barrel internally (Skeletons imports
// `Skeleton` from it). Assertions below target the real HeroUI DOM.

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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  formatDateValue: vi.fn((value) => String(value ?? '')),
}));

vi.mock('@/components/jobs/JobDetailHeader', () => ({
  JobDetailHeader: ({ vacancy, isOwner, isSaved, isPastDeadline, formatSalary }: Record<string, unknown>) => {
    const job = vacancy as { title?: string; is_featured?: boolean; salary_min?: number };
    return (
      <header>
        <h1>{job.title}</h1>
        {job.is_featured && <span>featured</span>}
        {job.salary_min ? <span>{(formatSalary as (v: unknown) => string)(job)}</span> : null}
        {!isOwner && <button aria-label={isSaved ? 'saved.unsave' : 'saved.save'}>{isSaved ? 'saved.unsave' : 'saved.save'}</button>}
        {isOwner && <a>detail.edit</a>}
        {isOwner && <button>detail.delete</button>}
        {isOwner && isPastDeadline && <button>detail.renew</button>}
        {isOwner && <a>detail.analytics</a>}
      </header>
    );
  },
}));

vi.mock('@/components/jobs/JobOwnerBanner', () => ({
  JobOwnerBanner: () => (
    <section>
      <a>detail.edit</a>
      <button>detail.delete</button>
      <a>detail.analytics</a>
    </section>
  ),
}));

vi.mock('@/components/jobs/InlineInterviewCard', () => ({ InlineInterviewCard: () => <div>inline_response.interview</div> }));
vi.mock('@/components/jobs/InlineOfferCard', () => ({ InlineOfferCard: () => <div>inline_response.offer</div> }));
vi.mock('@/components/jobs/JobDescriptionCard', () => ({
  JobDescriptionCard: ({ vacancy, isAuthenticated, isOwner, onCheckQualification }: Record<string, unknown>) => {
    const job = vacancy as { description?: string; skills?: string[] };
    return (
      <section>
        <div>{job.description}</div>
        {job.skills?.map((skill) => <span key={skill}>{skill}</span>)}
        {isAuthenticated && !isOwner && <button onClick={onCheckQualification as () => void}>detail.check_qualification</button>}
      </section>
    );
  },
}));
vi.mock('@/components/jobs/JobApplicationsList', () => ({ JobApplicationsList: () => <section>applications.title</section> }));
vi.mock('@/components/jobs/JobPipelineRules', () => ({ JobPipelineRules: () => <section>pipeline_rules.title</section> }));
vi.mock('@/components/jobs/JobMetadataSidebar', () => ({
  JobMetadataSidebar: ({ vacancy, formatSalary }: Record<string, unknown>) => {
    const job = vacancy as { salary_min?: number };
    return <aside>{job.salary_min ? <span>{(formatSalary as (v: unknown) => string)(job)}</span> : null}</aside>;
  },
}));
vi.mock('@/components/jobs/ApplySection', () => ({
  ApplySection: ({ vacancy, isOwner, savedProfile }: Record<string, unknown>) => {
    const job = vacancy as { has_applied?: boolean };
    if (isOwner || job.has_applied) return null;
    return <button>{savedProfile ? 'apply.quick_apply' : 'apply.button'}</button>;
  },
}));
vi.mock('@/components/jobs/JobModals', () => ({
  ApplyModal: () => null,
  QualificationModal: () => null,
  RenewModal: () => null,
  DeleteModal: () => null,
  DeclineModal: () => null,
}));
vi.mock('@/components/jobs/SimilarJobs', () => ({ SimilarJobs: () => null }));
vi.mock('@/components/jobs/AiChatDrawer', () => ({ AiChatDrawer: () => null }));

import { JobDetailPage } from './JobDetailPage';
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

const baseVacancy = makeVacancy();

describe('JobDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { id: 99, first_name: 'Viewer', name: 'Viewer User' },
      isAuthenticated: true,
    });
    // Different endpoints return different data shapes
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('salary-benchmark')) return Promise.resolve({ success: false, data: null, meta: {} });
      return Promise.resolve({ success: true, data: baseVacancy, meta: {} });
    });
  });

  it('renders loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise((resolve) => {
      window.setTimeout(() => resolve({ success: true, data: baseVacancy, meta: {} }), 25);
    }));
    const { unmount } = render(<JobDetailPage />);
    expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);
    unmount();
  });

  it('renders not-found empty state when API returns no data', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      return Promise.resolve({ success: false, data: null, meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders job title and description when loaded', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ title: 'Test Vacancy Title', description: 'Test description text' }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Vacancy Title')).toBeInTheDocument();
    }, { timeout: 3000 });
    // Description rendered as text inside a div
    const descEl = screen.queryByText((t) => t.includes('Test description text'));
    expect(descEl).not.toBeNull();
  });

  it('shows Apply button when not owner and not applied', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ has_applied: false, user_id: 999 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      const applyBtns = screen.getAllByText('apply.button');
      expect(applyBtns.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('shows quick apply when saved profile is returned inside the API profile envelope', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/jobs/saved-profile')) {
        return Promise.resolve({
          success: true,
          data: { profile: { cover_text: 'Saved cover message', cv_filename: 'cv.pdf' } },
          meta: {},
        });
      }
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('salary-benchmark')) return Promise.resolve({ success: false, data: null, meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ has_applied: false, user_id: 999 }), meta: {} });
    });

    render(<JobDetailPage />);

    await waitFor(() => {
      expect(screen.getAllByText('apply.quick_apply').length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('does NOT show Apply button when already applied', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ has_applied: true, application_status: 'applied', user_id: 999 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.queryByText('apply.button')).not.toBeInTheDocument();
    });
  });

  it('shows Save button when authenticated and not owner (J1)', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ user_id: 999, is_saved: false }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('saved.save')).toBeInTheDocument();
    });
  });

  it('shows Edit and Delete buttons when current user is owner', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, first_name: 'Alice', name: 'Alice' },
      isAuthenticated: true,
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('salary-benchmark')) return Promise.resolve({ success: false, data: null, meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ user_id: 1 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      // Owner actions appear in both the header actions bar and the management banner
      expect(screen.getAllByText('detail.edit').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('detail.delete').length).toBeGreaterThan(0);
  });

  it('shows featured badge when job is featured (J10)', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ is_featured: true, user_id: 999 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('featured')).toBeInTheDocument();
    });
  });

  it('shows salary info when salary_min and salary_max are present (J9)', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ salary_min: 40000, salary_max: 60000, salary_currency: 'USD', user_id: 999 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      // Salary rendered as text containing 40000 or 40,000 (may appear in multiple elements due to responsive layout)
      const els = screen.queryAllByText(/40[,.]?000/);
      expect(els.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('shows skills chips (J2)', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ skills: ['JavaScript', 'React'], user_id: 999 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      // Skills chips may be inside a chip/badge component
      const jsEl = screen.queryByText((t) => t.trim() === 'JavaScript');
      expect(jsEl).not.toBeNull();
    }, { timeout: 3000 });
    const reactEl = screen.queryByText((t) => t.trim() === 'React');
    expect(reactEl).not.toBeNull();
  });

  it('shows Renew button when deadline has passed and user is owner (J7)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, first_name: 'Alice', name: 'Alice' },
      isAuthenticated: true,
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('salary-benchmark')) return Promise.resolve({ success: false, data: null, meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ user_id: 1, deadline: '2020-01-01' }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('detail.renew')).toBeInTheDocument();
    });
  });

  it('shows Analytics link when user is owner (J8)', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, first_name: 'Alice', name: 'Alice' },
      isAuthenticated: true,
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('salary-benchmark')) return Promise.resolve({ success: false, data: null, meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ user_id: 1 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      // Analytics link appears in both the header actions bar and the management banner
      expect(screen.getAllByText('detail.analytics').length).toBeGreaterThan(0);
    });
  });

  it('shows Am I Qualified button when authenticated and not owner (J5)', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null, meta: {} });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [], meta: {} });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [], meta: {} });
      return Promise.resolve({ success: true, data: makeVacancy({ skills: ['Python'], user_id: 999 }), meta: {} });
    });
    render(<JobDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('detail.check_qualification')).toBeInTheDocument();
    });
  });
});
