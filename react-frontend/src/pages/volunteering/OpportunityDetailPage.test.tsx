// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.fallbackValue) return opts.fallbackValue as string;
      if (key === 'opportunity.application_status') return `Status: ${String(opts?.status ?? '')}`;
      return key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: '42' }),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 5, first_name: 'Jane', name: 'Jane Owner', role: 'member' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
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
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url ?? '',
}));
// PageMeta, Breadcrumbs, and SocialInteractionPanel pull contexts straight from
// their direct module paths (bypassing the '@/contexts' barrel mock), so stub
// them out — otherwise every full-content render throws "useTenant must be used
// within a TenantProvider".
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/navigation', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/social/SocialInteractionPanel', () => ({ SocialInteractionPanel: () => null }));

import OpportunityDetailPage from './OpportunityDetailPage';

// Use future-relative shift times so the page's "upcoming shifts" filter
// (start_time >= now) always keeps them. A fixed past date silently breaks the
// "shows shift information" test once real time advances past it.
const FUTURE_SHIFT_START = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const FUTURE_SHIFT_END = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString();

const mockOpportunity = {
  id: 42,
  title: 'Park Cleanup Drive',
  description: 'Help clean the local park.',
  location: 'Dublin City Park',
  skills_needed: 'Enthusiasm',
  start_date: '2026-06-01T09:00:00Z',
  end_date: '2026-06-01T17:00:00Z',
  is_active: true,
  is_remote: false,
  category: 'Environment',
  organization: { id: 7, name: 'Green Dublin', logo_url: null },
  created_at: '2026-01-10T12:00:00Z',
  shifts: [
    {
      id: 1,
      start_time: FUTURE_SHIFT_START,
      end_time: FUTURE_SHIFT_END,
      capacity: 10,
      signup_count: 3,
      spots_available: 7,
    },
  ],
  has_applied: false,
  application: null,
  is_owner: false,
};

const mockOpportunityOwner = {
  ...mockOpportunity,
  is_owner: true,
};

const mockApplicationsResponse = {
  success: true,
  data: {
    items: [
      {
        id: 101,
        status: 'pending',
        message: 'I love the environment!',
        created_at: '2026-02-01T10:00:00Z',
        user: { id: 20, name: 'Alice Volunteer', email: 'alice@example.com', avatar_url: null },
        shift: { id: 1, start_time: FUTURE_SHIFT_START, end_time: FUTURE_SHIFT_END },
      },
    ],
    cursor: null,
    has_more: false,
  },
};

describe('OpportunityDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading screen initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<OpportunityDetailPage />);
    // LoadingScreen renders during data fetch — at least one status region
    // should be in the loading (aria-busy) state.
    const statusRegions = screen.getAllByRole('status');
    expect(statusRegions.some((el) => el.getAttribute('aria-busy') === 'true')).toBe(true);
  });

  it('renders opportunity title and organisation on success', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockOpportunity });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    expect(screen.getByText('Green Dublin')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network failure'));
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('opportunity.load_error')).toBeInTheDocument();
    });
    expect(screen.getByText('opportunity.try_again')).toBeInTheDocument();
  });

  it('shows Apply button for non-owner who has not applied', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockOpportunity });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    expect(screen.getByText('opportunity.apply_now')).toBeInTheDocument();
  });

  it('shows already-applied state when user has applied', async () => {
    const applied = {
      ...mockOpportunity,
      has_applied: true,
      application: { id: 99, status: 'pending', message: null, created_at: '2026-02-01T00:00:00Z' },
    };
    vi.mocked(api.get).mockResolvedValue({ success: true, data: applied });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    expect(screen.getByText('opportunity.you_have_applied')).toBeInTheDocument();
  });

  it('renders translated already-applied status instead of the raw backend value', async () => {
    const applied = {
      ...mockOpportunity,
      has_applied: true,
      application: { id: 99, status: 'pending', message: null, created_at: '2026-02-01T00:00:00Z' },
    };
    vi.mocked(api.get).mockResolvedValue({ success: true, data: applied });

    render(<OpportunityDetailPage />);

    await waitFor(() => {
      expect(screen.getByText((text) => text.includes('Status: status_pending'))).toBeInTheDocument();
    });

    expect(screen.queryByText((text) => text.includes('Status: pending'))).not.toBeInTheDocument();
  });

  it('shows shift information when shifts are present', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockOpportunity });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    // Shifts section heading
    expect(screen.getByText('opportunity.upcoming_shifts')).toBeInTheDocument();
  });

  it('shows Applications panel for opportunity owner', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/applications')) {
        return Promise.resolve(mockApplicationsResponse);
      }
      return Promise.resolve({ success: true, data: mockOpportunityOwner });
    });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('applications.heading')).toBeInTheDocument();
    });
  });

  it('shows the shift manager instead of the read-only shift list when the server says can_manage', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/applications')) return Promise.resolve(mockApplicationsResponse);
      if (url.endsWith('/shifts')) return Promise.resolve({ success: true, data: mockOpportunity.shifts });
      if (url.endsWith('/recurring-patterns')) return Promise.resolve({ success: true, data: { patterns: [] } });
      // A community admin: not the creator, but allowed to manage.
      return Promise.resolve({ success: true, data: { ...mockOpportunity, is_owner: false, can_manage: true } });
    });
    render(<OpportunityDetailPage />);
    expect(await screen.findByTestId('shift-manager')).toBeInTheDocument();
    expect(screen.queryByText('opportunity.upcoming_shifts')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/volunteering/opportunities/42/shifts');
    });
  });

  it('keeps the read-only shift list for a volunteer who cannot manage', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { ...mockOpportunity, can_manage: false } });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('opportunity.upcoming_shifts')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('shift-manager')).not.toBeInTheDocument();
  });

  it('does not show Applications panel for non-owner', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockOpportunity });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    expect(screen.queryByText('applications.heading')).not.toBeInTheDocument();
  });

  it('calls the correct API endpoint on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockOpportunity });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/volunteering/opportunities/42'),
      );
    });
  });

  it('shows remote badge for remote opportunities', async () => {
    const remote = { ...mockOpportunity, is_remote: true, location: '' };
    vi.mocked(api.get).mockResolvedValue({ success: true, data: remote });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    expect(screen.getByText('opportunity.remote')).toBeInTheDocument();
  });

  it('shows a cancelled badge for a cancelled (inactive) opportunity', async () => {
    const inactive = { ...mockOpportunity, is_active: false };
    vi.mocked(api.get).mockResolvedValue({ success: true, data: inactive });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
    expect(screen.getByTestId('opportunity-status-chip')).toHaveTextContent('opportunity.status_cancelled');
  });

  describe('managing the opportunity', () => {
    const managed = { ...mockOpportunity, status: 'open', is_owner: false, can_manage: true };
    /** Answers the opportunity, the applicants panel and the shift panel each with their own shape. */
    const serve = (data: unknown) => vi.mocked(api.get).mockImplementation((async (url: string) => (
      url === '/v2/volunteering/opportunities/42' ? { success: true, data }
        : url.includes('/applications') ? { success: true, data: { items: [], cursor: null, has_more: false } }
          : { success: true, data: [] }
    )) as unknown as typeof api.get);

    it('a manager can close it to new volunteers', async () => {
      serve(managed);
      vi.mocked(api.put).mockResolvedValue({ success: true, data: {} });
      render(<OpportunityDetailPage />);

      fireEvent.click(await screen.findByTestId('opportunity-manage-toggle-status'));
      await waitFor(() => expect(api.put).toHaveBeenCalledWith('/v2/volunteering/opportunities/42', { status: 'closed' }));
      expect(await screen.findByText('opportunity.status_closed_to_new')).toBeInTheDocument();
      expect(screen.getByTestId('opportunity-manage-toggle-status')).toHaveTextContent('opportunity.manage_reopen');
    });

    it('links to the edit page', async () => {
      serve(managed);
      render(<OpportunityDetailPage />);

      expect(await screen.findByTestId('opportunity-manage-edit')).toHaveAttribute('href', '/test/volunteering/opportunities/42/edit');
    });

    it('asks before cancelling, then cancels', async () => {
      serve(managed);
      vi.mocked(api.delete).mockResolvedValue({ success: true, data: null });
      render(<OpportunityDetailPage />);

      fireEvent.click(await screen.findByTestId('opportunity-manage-cancel'));
      expect(api.delete).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByTestId('opportunity-manage-cancel-confirm'));
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/volunteering/opportunities/42'));
    });

    it('shows the creator the controls even when can_manage is false', async () => {
      const asCreator = { ...managed, can_manage: false, is_owner: true };
      // The creator also gets the applicants panel and the shift panel, which load their own lists.
      vi.mocked(api.get).mockImplementation((async (url: string) => (
        url === '/v2/volunteering/opportunities/42' ? { success: true, data: asCreator }
          : url.includes('/applications') ? { success: true, data: { items: [], cursor: null, has_more: false } }
            : { success: true, data: [] }
      )) as unknown as typeof api.get);
      render(<OpportunityDetailPage />);

      expect(await screen.findByTestId('opportunity-manage-bar')).toBeInTheDocument();
    });

    it('shows an organisation admin who did not create it the applicants', async () => {
      vi.mocked(api.get).mockImplementation((async (url: string) => (
        url === '/v2/volunteering/opportunities/42' ? { success: true, data: managed }
          : url.includes('/applications') ? { success: true, data: { items: [], cursor: null, has_more: false } }
            : { success: true, data: [] }
      )) as unknown as typeof api.get);
      render(<OpportunityDetailPage />);

      await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/v2/volunteering/opportunities/42/applications')));
    });

    it('shows a volunteer no controls, and no Apply button once it is closed', async () => {
      vi.mocked(api.get).mockResolvedValue({
        success: true,
        data: { ...mockOpportunity, status: 'closed', is_owner: false, can_manage: false, has_applied: false },
      });
      render(<OpportunityDetailPage />);

      expect(await screen.findByText('opportunity.status_closed_to_new')).toBeInTheDocument();
      expect(screen.queryByTestId('opportunity-manage-bar')).not.toBeInTheDocument();
      expect(screen.queryByText('opportunity.apply_now')).not.toBeInTheDocument();
    });
  });

  it('retry button refetches data after error', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({ success: true, data: mockOpportunity });
    render(<OpportunityDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('opportunity.try_again')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('opportunity.try_again'));
    await waitFor(() => {
      expect(screen.getAllByText('Park Cleanup Drive')[0]).toBeInTheDocument();
    });
  });
});

// Gap C2 (6 Oct 2026): the panel asked for a check-in code for EVERY shift of the
// opportunity, got a refusal for each shift the volunteer is not on, then said
// "QR codes are not yet available for some shifts". It also sat below the whole
// shift list, where a volunteer with many shifts never saw it.
describe('OpportunityDetailPage — shift check-in', () => {
  const later = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const shift = (id: number, days: number) => ({
    id, start_time: later(days), end_time: later(days + 0.1), capacity: 3, signup_count: 0, spots_available: 3,
  });
  const approvedOn = (shiftId: number | null) => ({
    ...mockOpportunity,
    shifts: [shift(1, 2), shift(2, 3), shift(3, 4)],
    has_applied: true,
    application: { id: 99, status: 'approved', message: null, shift_id: shiftId, created_at: '2026-02-01T00:00:00Z' },
  });
  const mockGets = (opp: unknown) => {
    vi.mocked(api.get).mockImplementation(((endpoint: string) => {
      if (endpoint.endsWith('/checkin')) {
        return Promise.resolve({
          success: true,
          data: { qr_token: 'tok', qr_url: 'https://example.test/volunteering/checkin/tok', status: 'pending', checked_in_at: null, checked_out_at: null },
        });
      }
      return Promise.resolve({ success: true, data: opp });
    }) as unknown as typeof api.get);
  };

  beforeEach(() => { vi.clearAllMocks(); });

  it("asks only for the volunteer's own shift and shows it above the shift list", async () => {
    mockGets(approvedOn(2));
    render(<OpportunityDetailPage />);

    const title = await screen.findByText('check_in.title');
    const checkinCalls = vi.mocked(api.get).mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/checkin'));
    expect(checkinCalls).toEqual(['/v2/volunteering/shifts/2/checkin']);
    expect(screen.queryByText('check_in.some_unavailable')).not.toBeInTheDocument();

    const shiftsHeading = screen.getByText('opportunity.upcoming_shifts');
    expect(title.compareDocumentPosition(shiftsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no check-in panel and asks for nothing when the volunteer holds no shift', async () => {
    mockGets(approvedOn(null));
    render(<OpportunityDetailPage />);

    await screen.findByText('opportunity.upcoming_shifts');
    expect(vi.mocked(api.get).mock.calls.some((c) => String(c[0]).endsWith('/checkin'))).toBe(false);
    expect(screen.queryByText('check_in.title')).not.toBeInTheDocument();
  });
});
