// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VolunteeringPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
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

// The phone filter sheet (and the lazy ProximityFilter) import these contexts by
// DIRECT path, which the '@/contexts' barrel mock above does not cover. The real
// useAuth throws outside an AuthProvider, and test-utils wraps renders in the
// real ToastProvider — so keep the provider export names.
vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// Phone layout switch. jsdom's matchMedia stub (src/test/setup.ts) reports
// matches:false for EVERY query, so without this the phone branch would never
// render and would get zero coverage. Query-aware so a future min-width probe
// cannot produce an impossible viewport.
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) => {
    if (query.includes('max-width')) return isPhoneViewport;
    if (query.includes('min-width')) return !isPhoneViewport;
    return false;
  }),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});


vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: string | Record<string, unknown>, _opts?: Record<string, unknown>) => {
      // Lookup table for keys used by VolunteeringPage
      const translations: Record<string, string> = {
        "volunteering.heading": "Volunteering",
        "volunteering.subtitle": "Find opportunities and track your impact",
        "volunteering.volunteer_view_subtitle": "Find opportunities, sign up, and log the hours you give.",
        "volunteering.tab_opportunities": "Opportunities",
        "volunteering.tab_applications": "My Applications",
        "volunteering.tab_hours": "My Hours",
        "volunteering.tab_for_you": "For You",
        "volunteering.tab_certificates": "Certificates",
        "volunteering.tab_alerts": "Alerts",
        "volunteering.tab_wellbeing": "Wellbeing",
        "volunteering.tab_credentials": "Credentials",
        "volunteering.tab_waitlist": "Waitlist",
        "volunteering.tab_swap_requests": "Swap Requests",
        "volunteering.tab_group_signups": "Group Sign-ups",
        "volunteering.browse_organisations": "Browse Organisations",
        "volunteering.post_opportunity": "Post Opportunity",
        "volunteering.search_placeholder": "Search opportunities...",
        "volunteering.no_opportunities_found": "No opportunities found",
        "volunteering.apply": "Apply",
        "volunteering.applied": "Applied",
        "volunteering.unable_to_load_opportunities": "Unable to load opportunities",
        "volunteering.try_again": "Try Again",
        "volunteering.page_title": "Volunteering",
        "volunteering.feature_not_available": "Volunteering Not Available",
        "volunteering.feature_not_available_desc": "The volunteering feature is not enabled for this community.",
        "volunteering.error_load_opportunities": "Failed to load opportunities",
        "volunteering.error_load_opportunities_retry": "Failed to load more opportunities",
        "volunteering.applied_success": "Successfully applied!",
        "volunteering.apply_error": "Failed to apply",
        "volunteering.apply_to_volunteer": "Apply to Volunteer",
        "volunteering.applied_on": "Applied",
        // Phone layout: re-homed hero / org-door actions.
        "volunteering.log_hours": "Log Hours",
        "volunteering.manage_organisation": "Manage organisation",
        "volunteering.register_organisation": "Register organisation",
        "volunteering.hero_eyebrow": "Volunteer & earn time credits",
        "volunteering.aria.volunteering_sections": "Volunteering sections",
        // Phone filter sheet sections.
        "volunteering.filter_distance": "Distance",
        "volunteering.filter_format": "Format",
        "volunteering.filter_all": "All",
        "volunteering.remote": "Remote",
        "volunteering.how_it_works_title": "How volunteering works",
        "volunteering.how_it_works":
          "Find an opportunity and apply. Once you're accepted, log the hours you give. When the organisation approves your hours, you receive 1 time credit for every hour — added straight to your wallet.",
        // Shared sticky-bar / sheet vocabulary (common:filter_bar.*).
        "filter_bar.filters": "Filters",
        "filter_bar.more_filters": "More filters",
        "filter_bar.clear_all": "Clear all",
        "filter_bar.active_filters": "Active filters",
        "filter_bar.remove_filter": "Remove filter",
        "filter_bar.show_results_unknown": "Show results",
        "filter_bar.filter_form": "Filters",
        "filter_bar.search": "Search",
        "accessibility.close": "Close",
        "radius_5": "5 km",
        "radius_10": "10 km",
        "radius_25": "25 km",
        "radius_50": "50 km",
        "radius_100": "100 km",
      };
      // Strip an explicit namespace prefix ("common:filter_bar.filters") so
      // cross-namespace lookups hit the same table.
      const bare = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
      const hit = translations[key] ?? translations[bare] ?? translations[`volunteering.${bare}`];
      if (hit != null) return hit;
      if (typeof fallbackOrOpts === "string") return fallbackOrOpts;
      if (fallbackOrOpts && typeof fallbackOrOpts.defaultValue === "string") return fallbackOrOpts.defaultValue;
      return key;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

import { VolunteeringPage } from './VolunteeringPage';
import { api } from '@/lib/api';

describe('VolunteeringPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
  });

  it('renders the page heading and description', () => {
    render(<VolunteeringPage />);
    expect(screen.getByText('Volunteering')).toBeInTheDocument();
    expect(screen.getByText('Find opportunities, sign up, and log the hours you give.')).toBeInTheDocument();
  });

  it('shows Opportunities tab button', () => {
    render(<VolunteeringPage />);
    expect(screen.getByText('Opportunities')).toBeInTheDocument();
  });

  it('shows My Applications and My Hours tabs when authenticated', () => {
    render(<VolunteeringPage />);
    expect(screen.getByText('My Applications')).toBeInTheDocument();
    expect(screen.getByText('My Hours')).toBeInTheDocument();
  });

  it('shows Browse Organisations button', () => {
    render(<VolunteeringPage />);
    expect(screen.getByText('Browse Organisations')).toBeInTheDocument();
  });

  it('shows search input for opportunities', () => {
    render(<VolunteeringPage />);
    expect(screen.getByPlaceholderText('Search opportunities...')).toBeInTheDocument();
  });

  it('shows empty state when no opportunities exist', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [],
      meta: { cursor: null, has_more: false },
    });
    render(<VolunteeringPage />);
    await waitFor(() => {
      expect(screen.getByText('No opportunities found')).toBeInTheDocument();
    });
  });

  it('renders opportunity cards with Apply button', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          title: 'Community Garden Helper',
          description: 'Help maintain the community garden',
          location: 'Dublin',
          skills_needed: 'Gardening',
          start_date: '2026-03-01',
          end_date: '2026-06-30',
          is_active: true,
          is_remote: false,
          category: 'Environment',
          organization: { id: 1, name: 'Green Org', logo_url: null },
          created_at: '2026-02-01',
          has_applied: false,
        },
      ],
      meta: { cursor: null, has_more: false },
    });
    render(<VolunteeringPage />);
    await waitFor(() => {
      expect(screen.getByText('Community Garden Helper')).toBeInTheDocument();
    });
    expect(screen.getByText('Green Org')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('shows Applied chip and hides Apply button when already applied', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          title: 'Already Applied Opportunity',
          description: 'Test',
          location: 'Cork',
          skills_needed: '',
          start_date: null,
          end_date: null,
          is_active: true,
          is_remote: false,
          category: null,
          organization: { id: 1, name: 'Test Org', logo_url: null },
          created_at: '2026-02-01',
          has_applied: true,
        },
      ],
      meta: { cursor: null, has_more: false },
    });
    render(<VolunteeringPage />);
    await waitFor(() => {
      expect(screen.getByText('Applied')).toBeInTheDocument();
    });
    expect(screen.queryByText('Apply')).not.toBeInTheDocument();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    // The page's own `my-organisations` effect re-fires on every render (the
    // useTenant mock hands back a fresh `hasFeature` each call), so draft-vs-apply
    // assertions must look at the OPPORTUNITIES requests specifically.
    const opportunityCalls = () =>
      vi.mocked(api.get).mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes('/v2/volunteering/opportunities'));

    it('renders the sticky bar and drops the desktop hero and filter row', () => {
      render(<VolunteeringPage />);

      // Sticky bar: search pill + Filters button.
      expect(screen.getByTestId('volunteering-filter-bar')).toBeInTheDocument();
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search opportunities...')).toBeInTheDocument();

      // The hero (title + description + eyebrow) is gone; the title now lives in
      // the app bar instead.
      expect(screen.queryByText('Find opportunities, sign up, and log the hours you give.')).not.toBeInTheDocument();
      // The desktop inline SearchField is replaced by the pill (a Button).
      expect(screen.queryByPlaceholderText('Search opportunities...')).not.toBeInTheDocument();
    });

    it('keeps the how-it-works explainer reachable as a collapsed disclosure', async () => {
      render(<VolunteeringPage />);

      // The heading survives as the disclosure trigger — an anonymous phone
      // visitor must still be able to find out how hours become time credits.
      const trigger = screen.getByRole('button', { name: /How volunteering works/i });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(trigger);

      await waitFor(() => {
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
      });
      // The body copy is the same string the desktop card shows — the exchange-rate
      // sentence is the part a phone visitor must not lose.
      expect(screen.getByText(/1 time credit for every hour/i)).toBeInTheDocument();
    });

    it('re-homes the hero and org-door actions into the compact action row', () => {
      render(<VolunteeringPage />);
      expect(screen.getByText('Log Hours')).toBeInTheDocument();
      expect(screen.getByText('Browse Organisations')).toBeInTheDocument();
      // No approved org and nothing pending → the register CTA must survive.
      expect(screen.getByText('Register organisation')).toBeInTheDocument();
    });

    it('replaces the wrapping section pills with one control that opens a sections sheet', async () => {
      render(<VolunteeringPage />);

      const sectionsTrigger = screen.getByRole('button', { name: 'Volunteering sections' });
      expect(sectionsTrigger).toBeInTheDocument();
      // The secondary-section disclosure is not rendered on phones.
      expect(screen.queryByText('Show fewer')).not.toBeInTheDocument();

      fireEvent.click(sectionsTrigger);
      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'Volunteering sections' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: 'My Applications' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'My Hours' })).toBeInTheDocument();
    });

    it('opens the filter sheet with its chip groups and an unknown-count apply button', async () => {
      render(<VolunteeringPage />);
      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByText('Distance')).toBeInTheDocument();
      });
      expect(screen.getByText('Format')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '25 km' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Remote' })).toBeInTheDocument();
      // No total in this endpoint's meta → never a fabricated "Show N".
      expect(screen.getByText('Show results')).toBeInTheDocument();
      expect(screen.getByText('Clear all')).toBeInTheDocument();
    });

    it('applies draft filters only when the apply button is pressed', async () => {
      render(<VolunteeringPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/v2/volunteering/opportunities?'));
      });
      vi.mocked(api.get).mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Remote' })).toBeInTheDocument();
      });

      // Tapping a chip mutates the draft only: no probe (this endpoint has no
      // total) and no list refetch.
      fireEvent.click(screen.getByRole('radio', { name: 'Remote' }));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Remote' })).toHaveAttribute('aria-checked', 'true');
      });
      expect(opportunityCalls()).toHaveLength(0);

      fireEvent.click(screen.getByText('Show results'));
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('is_remote=1'));
      });
    });

    it('shows an applied filter as a removable chip that clears the filter', async () => {
      render(<VolunteeringPage />);
      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Remote' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('radio', { name: 'Remote' }));
      fireEvent.click(screen.getByText('Show results'));

      const chip = await screen.findByLabelText('Remove filter');
      expect(chip).toBeInTheDocument();
      vi.mocked(api.get).mockClear();

      fireEvent.click(chip);
      await waitFor(() => {
        expect(screen.queryByLabelText('Remove filter')).not.toBeInTheDocument();
      });
      const refetched = opportunityCalls();
      expect(refetched.length).toBeGreaterThan(0);
      expect(refetched.every((url) => !url.includes('is_remote'))).toBe(true);
    });
  });
});
