// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockNavigate = vi.fn();
const mockUseParams = vi.fn(() => ({ id: undefined as string | undefined }));

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
    useNavigate: () => mockNavigate,
    useParams: () => mockUseParams(),
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
const mockTenantContext = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: mockHasFeature,
  hasModule: vi.fn(() => true),
};
const mockUseAuth = vi.fn(() => ({
  user: { id: 1, first_name: 'Test', name: 'Test User' },
  isAuthenticated: true,
}));

vi.mock('@/contexts', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
  useTenant: vi.fn(() => mockTenantContext),
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

// NOTE: deliberately NOT mocking the `@/components/ui` barrel. CreateJobPage
// imports every primitive by direct path (`@/components/ui/Button`, `/Chip`,
// `/Input`, `/NumberField`, `/Select`, `/Switch`, `/Textarea`, …), so a barrel
// mock overrides none of them — and it breaks the real primitives that consume
// the barrel internally (Skeletons imports `Skeleton` from it). Assertions below
// target the real HeroUI DOM.
//
// The one real primitive the test has no business owning is `useConfirm`: it needs
// a <ConfirmDialogProvider> the render tree does not have. Mock it on its DIRECT
// path (same as src/admin/modules/events/EventSettings.test.tsx:51) so every
// sibling primitive stays real. Resolving `true` keeps the previous stub's
// behaviour: the unsaved-changes guard never blocks navigation in these tests.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => () => Promise.resolve(true),
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

import { CreateJobPage } from './CreateJobPage';
import { api } from '@/lib/api';

describe('CreateJobPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { id: 1, first_name: 'Test', name: 'Test User' },
      isAuthenticated: true,
    });
  });

  describe('Create mode (no id param)', () => {
    beforeEach(() => {
      mockUseParams.mockReturnValue({ id: undefined });
    });

    it('renders create form heading', () => {
      render(<CreateJobPage />);
      expect(screen.getByText('form.create_title')).toBeInTheDocument();
    });

    it('shows validation error when title is empty on submit', async () => {
      vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 5 } });
      const { userEvent } = await import('@testing-library/user-event');
      render(<CreateJobPage />);
      const submitBtn = screen.getByText('form.submit_create');
      await userEvent.click(submitBtn);
      await waitFor(() => {
        // HeroUI renders errorMessage via aria-describedby; check api.post was NOT called (validation blocked)
        expect(vi.mocked(api.post)).not.toHaveBeenCalled();
      });
    });

    it('shows validation error when description is empty on submit', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      render(<CreateJobPage />);
      const titleInput = screen.getByPlaceholderText('form.title_placeholder');
      await userEvent.type(titleInput, 'Some Title');
      const submitBtn = screen.getByText('form.submit_create');
      await userEvent.click(submitBtn);
      await waitFor(() => {
        // HeroUI renders errorMessage via aria-describedby; check api.post was NOT called (validation blocked)
        expect(vi.mocked(api.post)).not.toHaveBeenCalled();
      });
    });

    it('all job type options present in type select', () => {
      render(<CreateJobPage />);
      expect(screen.getAllByText('type.paid').length).toBeGreaterThan(0);
      expect(screen.getAllByText('type.volunteer').length).toBeGreaterThan(0);
      expect(screen.getAllByText('type.timebank').length).toBeGreaterThan(0);
    });

    it('all commitment type options present in commitment select', () => {
      render(<CreateJobPage />);
      expect(screen.getAllByText('commitment.full_time').length).toBeGreaterThan(0);
      expect(screen.getAllByText('commitment.part_time').length).toBeGreaterThan(0);
      expect(screen.getAllByText('commitment.flexible').length).toBeGreaterThan(0);
      expect(screen.getAllByText('commitment.one_off').length).toBeGreaterThan(0);
    });

    it('salary fields are present in the form (J9)', () => {
      render(<CreateJobPage />);
      expect(screen.getByText(/form\.salary_min_label/)).toBeInTheDocument();
      expect(screen.getByText(/form\.salary_max_label/)).toBeInTheDocument();
    });

    it('submit button calls POST /v2/jobs for create mode', async () => {
      vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 7 } });
      render(<CreateJobPage />);
      const titleInput = screen.getByLabelText(/form.title_label/i);
      // Description uses a custom span label, not a <label> element — find by placeholder
      const descInput = screen.getByPlaceholderText('form.description_placeholder');
      // The default job type is 'paid' which requires salary range unless negotiable.
      // Fill salary fields to pass validation (labels include required asterisk '*').
      // The real NumberField also points its increment/decrement buttons'
      // aria-labelledby at the field <Label>, so the label text alone matches three
      // elements. Scoping to role `textbox` resolves to exactly the one number input.
      const salaryMinInput = screen.getByRole('textbox', { name: /form\.salary_min_label/ });
      const salaryMaxInput = screen.getByRole('textbox', { name: /form\.salary_max_label/ });

      // Use fireEvent.change to update form state without triggering pointer events
      // that would interfere with the subsequent fireEvent.click on the HeroUI button
      fireEvent.change(titleInput, { target: { value: 'New Vacancy' } });
      fireEvent.change(descInput, { target: { value: 'Full job description here' } });
      // The real NumberField keeps typed text in local state and only publishes the
      // numeric value on commit (blur / Enter) — exactly what happens when a user
      // leaves the field to click Submit. Without the blur, salary_min/max stay empty
      // and the EU pay-transparency rule blocks the submit.
      fireEvent.change(salaryMinInput, { target: { value: '30000' } });
      fireEvent.blur(salaryMinInput);
      fireEvent.change(salaryMaxInput, { target: { value: '50000' } });
      fireEvent.blur(salaryMaxInput);

      // Find the submit button element (the button that contains the submit text)
      // and click it directly to trigger HeroUI onPress via the virtual click path
      // fireEvent.click dispatches with detail:0 which triggers the isVirtualClick path
      const submitBtn = screen.getByText('form.submit_create').closest('button')!;
      fireEvent.click(submitBtn);
      await waitFor(() => {
        expect(vi.mocked(api.post)).toHaveBeenCalledWith('/v2/jobs', expect.objectContaining({
          title: 'New Vacancy',
        }));
      });
    });
  });

  describe('Edit mode (with id param)', () => {
    const mockVacancy = {
      title: 'Existing Vacancy', description: 'Existing description',
      type: 'paid', commitment: 'flexible', category: '',
      location: '', is_remote: false, skills_required: '',
      hours_per_week: null, time_credits: null, contact_email: '',
      contact_phone: '', deadline: null, salary_min: null,
      salary_max: null, salary_type: '', salary_currency: '',
      salary_negotiable: false,
    };

    beforeEach(() => {
      mockUseParams.mockReturnValue({ id: '5' });
      // Handle multiple API calls: templates load + vacancy load
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes('/v2/jobs/salary-benchmark')) {
          return Promise.resolve({ success: false, data: null, meta: {} });
        }
        if (url.includes('/v2/jobs/5')) {
          return Promise.resolve({ success: true, data: mockVacancy, meta: {} });
        }
        // Templates endpoint
        return Promise.resolve({ success: true, data: [], meta: {} });
      });
    });

    it('renders edit form heading and loads existing vacancy', async () => {
      render(<CreateJobPage />);
      await waitFor(() => {
        // After loading, the form title appears (real i18n translation or key fallback)
        expect(screen.getAllByText(/edit/i).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows form pre-filled with existing job data', async () => {
      render(<CreateJobPage />);
      await waitFor(() => {
        expect(screen.getByDisplayValue('Existing Vacancy')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('Existing description')).toBeInTheDocument();
    });

    it('handles salary benchmark data returned inside the API benchmark envelope', async () => {
      // shouldAdvanceTime lets real time progress so Testing Library's waitFor
      // (which polls on timers) isn't frozen by the fake clock, while
      // advanceTimersByTimeAsync still drives the salary-benchmark debounce.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        vi.mocked(api.get).mockImplementation((url: string) => {
          if (url.includes('/v2/jobs/salary-benchmark')) {
            return Promise.resolve({
              success: true,
              data: {
                benchmark: {
                  role_keyword: 'Existing Vacancy',
                  salary_min: 30000,
                  salary_max: 50000,
                  salary_median: 40000,
                  salary_type: 'annual',
                  currency: 'EUR',
                },
              },
              meta: {},
            });
          }
          if (url.includes('/v2/jobs/5')) {
            return Promise.resolve({ success: true, data: mockVacancy, meta: {} });
          }
          return Promise.resolve({ success: true, data: [], meta: {} });
        });

        render(<CreateJobPage />);
        await waitFor(() => {
          expect(screen.getByDisplayValue('Existing Vacancy')).toBeInTheDocument();
        });

        await vi.advanceTimersByTimeAsync(650);

        await waitFor(() => {
          expect(vi.mocked(api.get)).toHaveBeenCalledWith(
            expect.stringContaining('/v2/jobs/salary-benchmark?title=Existing%20Vacancy'),
          );
        });
        expect(screen.getByDisplayValue('Existing Vacancy')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
