// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: a job vacancy's own title and description must be
 * translatable. One Translate press translates both. Mocks copied from
 * JobDetailPage.test.tsx, except that the real header and description card
 * render here, because they show the translation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  useAuth: () => mockUseAuth(),
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

const vacancy = {
  id: 1, title: 'Coordinador del huerto',
  description: 'Coordina el huerto comunitario.',
  location: 'Dublin', is_remote: false, type: 'paid',
  commitment: 'part_time', category: 'Environment',
  skills: [], skills_required: null, hours_per_week: 10, time_credits: null,
  deadline: null, status: 'open', views_count: 42, applications_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  creator: { id: 1, name: 'Alice', avatar_url: null },
  organization: null, has_applied: false, application_status: null,
  application_stage: null, is_saved: false, is_featured: false,
  featured_until: null, salary_min: null, salary_max: null,
  salary_type: null, salary_currency: null, salary_negotiable: false,
  expired_at: null, renewed_at: null, renewal_count: 0, user_id: 1,
  contact_email: null, contact_phone: null,
};

const translations: Record<string, string> = {
  job: 'Coordinate the community garden.',
  job_title: 'Garden coordinator',
};

describe('JobDetailPage — Translate the title and description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 99, first_name: 'Viewer', name: 'Viewer User' },
      isAuthenticated: true,
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/match')) return Promise.resolve({ success: false, data: null });
      if (url.includes('/applications')) return Promise.resolve({ success: true, data: [] });
      if (url.includes('/history')) return Promise.resolve({ success: true, data: [] });
      if (url.includes('salary-benchmark')) return Promise.resolve({ success: false, data: null });
      if (url.includes('saved-profile')) return Promise.resolve({ success: false, data: null });
      return Promise.resolve({ success: true, data: vacancy });
    });
    vi.mocked(api.post).mockImplementation((url: string, body?: unknown) => {
      if (url !== '/v2/ugc-translate') return Promise.resolve({ success: true });
      return Promise.resolve({
        success: true,
        data: {
          translated_text: translations[(body as { content_type: string }).content_type],
          source_locale: 'es', target_locale: 'en', cached: false,
        },
      });
    });
  });

  it('translates title and description together and restores the originals', async () => {
    render(<JobDetailPage />);
    expect(await screen.findByText('Coordina el huerto comunitario.', {}, { timeout: 3000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'translate.translate' }));

    expect(await screen.findByText('Coordinate the community garden.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Garden coordinator');
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'job', content_id: 1, source_text: 'Coordina el huerto comunitario.',
    }));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'job_title', content_id: 1, source_text: 'Coordinador del huerto',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'translate.show_original' }));
    expect(await screen.findByText('Coordina el huerto comunitario.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Coordinador del huerto');
  });
});
