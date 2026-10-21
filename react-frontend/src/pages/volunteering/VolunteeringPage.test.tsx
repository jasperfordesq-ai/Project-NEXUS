// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for VolunteeringPage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { useTenant, useAuth } from '@/contexts';

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
        "volunteering.tab_credentials": "Qualifications",
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
        "volunteering.no_loggable_organisations_find": "Find opportunities",
        "volunteering.no_loggable_organisations_applications": "Check my applications",
        "volunteering.manage_organisation": "Manage organisation",
        "volunteering.register_organisation": "Register organisation",
        "volunteering.org_pending_setup": "Set it up while you wait",
        "volunteering.org_pending_see_all": "See your organisations",
        "volunteering.hero_eyebrow": "Volunteer & earn time credits",
        "volunteering.aria.volunteering_sections": "Volunteering sections",
        // The volunteering home (hub) and its section pages.
        "volunteering.hub.title": "Make a difference, your way.",
        "volunteering.hub.navigation": "Explore volunteering",
        "volunteering.hub.back_home": "Volunteering home",
        "volunteering.hub.explore": "Explore opportunities",
        "volunteering.hub.search_results": "Search results",
        "volunteering.hub.more_opportunities": "More opportunities",
        "volunteering.hub.find_opportunities": "Find opportunities",
        "volunteering.hub.urgent_action": "See urgent requests",
        "volunteering.hub.links.opportunities": "All opportunities",
        "volunteering.hub.links.recommended": "Recommended for you",
        "volunteering.hub.links.alerts": "Urgent requests",
        "volunteering.hub.links.applications": "My applications",
        "volunteering.hub.links.hours": "My hours and shifts",
        "volunteering.hub.links.waitlist": "Waiting lists",
        "volunteering.hub.links.swaps": "Shift swaps",
        "volunteering.hub.links.group-signups": "Group sign-ups",
        "volunteering.hub.links.community-projects": "Community projects",
        "volunteering.hub.links.donations": "Donations",
        "volunteering.hub.links.expenses": "Expenses",
        "volunteering.hub.links.credentials": "Qualifications",
        "volunteering.hub.links.certificates": "Certificates",
        "volunteering.hub.links.wellbeing": "Wellbeing",
        "volunteering.hub.links.safeguarding": "Safeguarding",
        "volunteering.hub.links.accessibility": "Accessibility",
        "volunteering.hub.intro.applications": "The roles you've applied for, and whether each organisation has said yes.",
        "volunteering.welcome.title": "Welcome to volunteering",
        "volunteering.welcome.dismiss": "Got it",
        "volunteering.org_register_title": "Run an organisation?",
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

/** Open a section from the home page's hub; its name may be followed by a live number. */
function openSection(name: string) {
  fireEvent.click(within(screen.getByTestId('volunteering-hub')).getByRole('button', { name: new RegExp(`^${name}`) }));
}

describe('VolunteeringPage', () => {
  describe('volunteering home', () => {
    const originalTenant = vi.mocked(useTenant).getMockImplementation();
    const originalAuth = vi.mocked(useAuth).getMockImplementation();
    afterEach(() => {
      if (originalTenant) vi.mocked(useTenant).mockImplementation(originalTenant);
      if (originalAuth) vi.mocked(useAuth).mockImplementation(originalAuth);
      // Put the API back to "everything empty" so later tests start clean.
      vi.mocked(api.get).mockImplementation((async () => ({ success: true, data: [], meta: {} })) as unknown as typeof api.get);
      window.localStorage.removeItem('nexus_vol_welcome_dismissed_v1');
      window.history.replaceState({}, '', '/');
    });

    const list = (items: unknown[]) => ({ success: true, data: items, meta: { cursor: null, has_more: false } });
    const opportunity = (id: number) => ({
      id,
      title: `Opportunity ${id}`,
      description: 'Test',
      location: 'Town',
      skills_needed: '',
      start_date: null,
      end_date: null,
      is_active: true,
      is_remote: false,
      category: null,
      organization: { id: 1, name: 'Test Org', logo_url: null },
      created_at: '2026-02-01',
      has_applied: false,
    });
    /** Answer each endpoint by URL prefix; anything else is an empty list. */
    const mockHubApi = (routes: Record<string, unknown>) => {
      vi.mocked(api.get).mockImplementation((async (endpoint: string) => {
        const hit = Object.entries(routes).find(([prefix]) => endpoint.startsWith(prefix));
        return hit ? hit[1] : list([]);
      }) as unknown as typeof api.get);
    };

    it.each([false, true])('opens on the home: its title, the list and every allowed section, with no section picker (phone: %s)', (phone) => {
      isPhoneViewport = phone;
      render(<VolunteeringPage />);
      expect(screen.getByRole('heading', { level: 1, name: 'Make a difference, your way.' })).toBeInTheDocument();
      const hub = within(screen.getByTestId('volunteering-hub'));
      expect(hub.getAllByRole('button')).toHaveLength(16);
      expect(hub.getByRole('button', { name: 'Group sign-ups' })).toBeInTheDocument();
      expect(hub.getByRole('button', { name: 'Safeguarding' })).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Volunteering sections' })).not.toBeInTheDocument();
    });

    it('opens a section on a page of its own, and "Volunteering home" goes back the way Back would', async () => {
      render(<VolunteeringPage />);
      fireEvent.click(within(screen.getByTestId('volunteering-hub')).getByRole('button', { name: 'My applications' }));
      await waitFor(() => expect(window.location.search).toBe('?tab=applications'));
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'My applications' })).toHaveFocus());
      expect(screen.getByText("The roles you've applied for, and whether each organisation has said yes.")).toBeInTheDocument();
      // The section page is focused on its job: no hub cards, no home title.
      expect(screen.queryByTestId('volunteering-hub')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Make a difference, your way.' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Volunteering home' }));
      await waitFor(() => expect(window.location.search).toBe(''));
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Make a difference, your way.' })).toHaveFocus());
      expect(screen.getByTestId('volunteering-hub')).toBeInTheDocument();
    });

    it('takes a deep-linked section home with the same button, without leaving the page', async () => {
      window.history.replaceState({}, '', '/?tab=hours');
      render(<VolunteeringPage />);
      expect(await screen.findByRole('heading', { level: 1, name: 'My hours and shifts' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Volunteering home' }));
      await waitFor(() => expect(window.location.search).toBe(''));
      expect(screen.getByTestId('volunteering-hub')).toBeInTheDocument();
    });

    it('drops the sections a community has switched off, and sends a link to one home', async () => {
      vi.mocked(useTenant).mockImplementation(() => ({
        ...originalTenant!(),
        volunteeringConfig: { 'volunteering.tab_group_signups': false, 'volunteering.expenses_enabled': false, 'volunteering.enable_matching': false },
      }) as ReturnType<typeof useTenant>);
      window.history.replaceState({}, '', '/?tab=group-signups');
      render(<VolunteeringPage />);
      await waitFor(() => expect(window.location.search).toBe(''));
      const hub = within(screen.getByTestId('volunteering-hub'));
      expect(hub.queryByRole('button', { name: 'Group sign-ups' })).not.toBeInTheDocument();
      expect(hub.queryByRole('button', { name: 'Expenses' })).not.toBeInTheDocument();
      expect(hub.queryByRole('button', { name: 'Recommended for you' })).not.toBeInTheDocument();
    });

    it('shows signed-out visitors the list alone, with no hub and no member buttons', async () => {
      vi.mocked(useAuth).mockReturnValue({ ...originalAuth!(), isAuthenticated: false } as ReturnType<typeof useAuth>);
      mockHubApi({ '/v2/volunteering/opportunities': list([opportunity(1), opportunity(2), opportunity(3), opportunity(4)]) });
      render(<VolunteeringPage />);
      expect(await screen.findByText('Opportunity 4')).toBeInTheDocument();
      expect(screen.queryByTestId('volunteering-hub')).not.toBeInTheDocument();
      expect(screen.queryByText('More opportunities')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Log Hours' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Find opportunities' })).not.toBeInTheDocument();
      expect(screen.queryByText('Welcome to volunteering')).not.toBeInTheDocument();
      // How it works is still one tap away.
      expect(screen.getByText(/1 time credit for every hour/i)).toBeInTheDocument();
      // Nothing member-only is even asked for.
      expect(vi.mocked(api.get).mock.calls.map(([url]) => url).filter((url) => !String(url).startsWith('/v2/volunteering/opportunities'))).toEqual([]);
    });

    it('leads with the first three opportunities, then the hub, then the rest', async () => {
      mockHubApi({ '/v2/volunteering/opportunities': list([1, 2, 3, 4, 5].map(opportunity)) });
      render(<VolunteeringPage />);
      const third = await screen.findByText('Opportunity 3');
      const hub = screen.getByTestId('volunteering-hub');
      const fourth = screen.getByText('Opportunity 4');
      const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(third, hub)).toBe(true);
      expect(follows(hub, fourth)).toBe(true);
      expect(follows(screen.getByRole('heading', { name: 'More opportunities' }), fourth)).toBe(true);
    });

    it('shows search results alone, and brings the hub back when the search is cleared', async () => {
      mockHubApi({ '/v2/volunteering/opportunities': list([1, 2, 3, 4].map(opportunity)) });
      render(<VolunteeringPage />);
      const search = screen.getByPlaceholderText('Search opportunities...');
      fireEvent.change(search, { target: { value: 'garden' } });
      await waitFor(() => expect(screen.queryByTestId('volunteering-hub')).not.toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Search results' })).toBeInTheDocument();
      expect(await screen.findByText('Opportunity 4')).toBeInTheDocument();
      fireEvent.change(search, { target: { value: '' } });
      await waitFor(() => expect(screen.getByTestId('volunteering-hub')).toBeInTheDocument());
      expect(screen.getByRole('heading', { name: 'Explore opportunities' })).toBeInTheDocument();
    });

    it('offers Log Hours only to a member who can log hours', async () => {
      mockHubApi({ '/v2/volunteering/applications?status=approved': list([{ id: 9, status: 'approved' }]) });
      render(<VolunteeringPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Log Hours' }));
      await waitFor(() => expect(window.location.search).toBe('?tab=hours'));
    });

    it('offers Find opportunities instead to a member who cannot log hours yet, and it moves to the list', async () => {
      window.localStorage.setItem('nexus_vol_welcome_dismissed_v1', '1');
      mockHubApi({});
      render(<VolunteeringPage />);
      fireEvent.click(await screen.findByRole('button', { name: 'Find opportunities' }));
      expect(screen.queryByRole('button', { name: 'Log Hours' })).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Explore opportunities' })).toHaveFocus());
    });

    it('welcomes a first-time member with the three steps, then keeps a one-line explainer', async () => {
      render(<VolunteeringPage />);
      expect(screen.getByText('Welcome to volunteering')).toBeInTheDocument();
      expect(screen.queryByText(/1 time credit for every hour/i)).not.toBeInTheDocument();
      // Once it is known this member cannot log hours yet, the welcome's own
      // "Find opportunities" is the only one — the header does not repeat it.
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v2/volunteering/applications?status=approved&per_page=1'));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Find opportunities' })).not.toBeInTheDocument());
      fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]!);
      await waitFor(() => expect(screen.queryByText('Welcome to volunteering')).not.toBeInTheDocument());
      expect(await screen.findByRole('button', { name: 'Find opportunities' })).toBeInTheDocument();
      expect(screen.getByText('How volunteering works')).toBeInTheDocument();
      expect(screen.getByText(/1 time credit for every hour/i)).toBeInTheDocument();
      expect(window.localStorage.getItem('nexus_vol_welcome_dismissed_v1')).toBe('1');
    });

    it('gives an organisation manager a clear way in, and keeps "Run an organisation?" for everyone else', async () => {
      mockHubApi({ '/v2/volunteering/my-organisations': list([{ id: 31, name: 'Garden Club', status: 'active', member_role: 'owner' }]) });
      render(<VolunteeringPage />);
      const strip = within(await screen.findByTestId('volunteering-organisation-strip'));
      expect(strip.getByRole('link', { name: 'Manage organisation' })).toHaveAttribute('href', '/test/volunteering/org/31/dashboard');
      expect(screen.queryByTestId('volunteering-register-organisation')).not.toBeInTheDocument();
    });

    it('invites a member with no organisation to register one, at the foot of the page', async () => {
      render(<VolunteeringPage />);
      expect(await screen.findByTestId('volunteering-register-organisation')).toHaveTextContent('Run an organisation?');
      expect(screen.queryByTestId('volunteering-organisation-strip')).not.toBeInTheDocument();
    });

    it('raises a banner for an unanswered urgent request, and shows live numbers', async () => {
      mockHubApi({
        '/v2/volunteering/emergency-alerts': { success: true, data: { alerts: [{ id: 1, my_response: 'pending' }] } },
        '/v2/volunteering/applications?status=pending': list([{ id: 1, status: 'pending' }, { id: 2, status: 'pending' }]),
        '/v2/volunteering/shifts': { success: true, data: { items: [{ id: 3, start_time: '2099-01-01T10:00:00Z', opportunity_title: 'Garden day' }], cursor: null, has_more: false } },
        '/v2/volunteering/hours/summary': { success: true, data: { total_verified: 12 } },
      });
      render(<VolunteeringPage />);
      expect(await screen.findByTestId('volunteering-urgent-banner')).toBeInTheDocument();
      expect(await screen.findByText('hub.hint_waiting')).toBeInTheDocument();
      expect(screen.getByText('hub.hint_to_answer')).toBeInTheDocument();
      expect(await screen.findByText('hub.next_shift')).toBeInTheDocument();
      expect(await screen.findByText('hub.hours_approved')).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'See urgent requests' })[0]!);
      await waitFor(() => expect(window.location.search).toBe('?tab=alerts'));
      // No need to point at the page the member is already on.
      expect(screen.queryByTestId('volunteering-urgent-banner')).not.toBeInTheDocument();
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
  });

  it('renders the page heading and description', () => {
    render(<VolunteeringPage />);
    expect(screen.getByText('Volunteering')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Make a difference, your way.' })).toBeInTheDocument();
  });

  it('shows My applications and My hours and shifts when authenticated', () => {
    render(<VolunteeringPage />);
    const hub = within(screen.getByTestId('volunteering-hub'));
    expect(hub.getByRole('button', { name: /^My applications/ })).toBeInTheDocument();
    expect(hub.getByRole('button', { name: /^My hours and shifts/ })).toBeInTheDocument();
  });

  // Gap A7 (6 Oct 2026): the "awaiting approval" card was plain text; the dashboard
  // already works for a pending organisation, so the card now leads there.
  describe('organisation awaiting approval', () => {
    const mockOrgs = (orgs: unknown[]) => {
      vi.mocked(api.get).mockImplementation((async (endpoint: string) => (
        endpoint === '/v2/volunteering/my-organisations'
          ? { success: true, data: orgs, meta: { cursor: null, has_more: false } }
          : { success: true, data: [], meta: {} }
      )) as unknown as typeof api.get);
    };

    it('links the single pending organisation to its dashboard', async () => {
      mockOrgs([{ id: 21, name: 'Waiting Org', status: 'pending', member_role: 'owner' }]);
      render(<VolunteeringPage />);

      const link = await screen.findByTestId('org-pending-open');
      expect(link).toHaveAttribute('href', '/test/volunteering/org/21/dashboard');
      expect(link).toHaveTextContent('Set it up while you wait');
    });

    it('sends the owner of several pending organisations to the list', async () => {
      mockOrgs([
        { id: 21, name: 'Waiting Org', status: 'pending', member_role: 'owner' },
        { id: 22, name: 'Second Org', status: 'pending', member_role: 'admin' },
      ]);
      render(<VolunteeringPage />);

      const link = await screen.findByTestId('org-pending-open');
      expect(link).toHaveAttribute('href', '/test/volunteering/my-organisations');
      expect(link).toHaveTextContent('See your organisations');
    });
  });

  describe('ask to swap (My Applications)', () => {
    const futureShift = { id: 10, start_time: '2099-03-15T10:00:00Z', end_time: '2099-03-15T14:00:00Z' };
    const pastShift = { id: 11, start_time: '2020-03-15T10:00:00Z', end_time: '2020-03-15T14:00:00Z' };
    const application = (overrides: Record<string, unknown>) => ({
      id: 1,
      status: 'approved',
      message: '',
      opportunity: { id: 5, title: 'Food Bank', location: 'Town Hall' },
      organization: { id: 7, name: 'Food For All', logo_url: null },
      shift: futureShift,
      org_note: null,
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    });

    // Switching tab writes `?tab=applications` to the shared jsdom URL; put it
    // back so the tests after this block still open on Opportunities.
    afterEach(() => {
      window.history.replaceState({}, '', '/');
    });

    const mockApplications = (apps: unknown[]) => {
      const handler = async (endpoint: string) => {
        if (endpoint.startsWith('/v2/volunteering/applications')) {
          return { success: true, data: apps, meta: { cursor: null, has_more: false } };
        }
        if (endpoint === '/v2/volunteering/opportunities/5/shifts') {
          return {
            success: true,
            data: [
              { ...futureShift, signup_count: 1 },
              { id: 13, start_time: '2099-03-17T09:00:00Z', end_time: '2099-03-17T12:00:00Z', signup_count: 2 },
            ],
          };
        }
        return { success: true, data: [], meta: {} };
      };
      vi.mocked(api.get).mockImplementation(handler as unknown as typeof api.get);
    };

    it('offers "Ask to swap" only on a confirmed shift that has not started', async () => {
      mockApplications([
        application({ id: 1, shift: futureShift }),
        application({ id: 2, shift: pastShift }),
        application({ id: 3, status: 'pending', shift: { ...futureShift, id: 12 } }),
        application({ id: 4, shift: null }),
      ]);
      render(<VolunteeringPage />);
      openSection('My applications');

      expect(await screen.findByTestId('shift-swap-ask-10')).toBeInTheDocument();
      expect(screen.queryByTestId('shift-swap-ask-11')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shift-swap-ask-12')).not.toBeInTheDocument();
      expect(screen.getAllByTestId(/^shift-swap-ask-/)).toHaveLength(1);
    });

    it('opens the shift picker for that opportunity and asks for the chosen shift', async () => {
      mockApplications([application({ id: 1, shift: futureShift })]);
      vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 99 } });
      render(<VolunteeringPage />);
      openSection('My applications');
      fireEvent.click(await screen.findByTestId('shift-swap-ask-10'));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/v2/volunteering/opportunities/5/shifts');
      });
      // The member's own shift is never offered; only the other future shift with someone on it.
      const option = await screen.findByTestId('shift-swap-option-13');
      expect(screen.queryByTestId('shift-swap-option-10')).not.toBeInTheDocument();

      fireEvent.click(option);
      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith(
          '/v2/volunteering/swaps',
          expect.objectContaining({ from_shift_id: 10, to_shift_id: 13 }),
        );
      });
      const body = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('to_user_id');
    });
  });

  // Gap C3 (7 Oct 2026): a volunteer with no organisation to log hours for saw a
  // disabled "Log Hours" button and a sentence, with nowhere to go from there.
  describe('My Hours with no organisation to log hours for', () => {
    afterEach(() => {
      window.history.replaceState({}, '', '/');
    });

    it('offers a way to find opportunities and to check applications', async () => {
      // No approved application and no organisation membership.
      vi.mocked(api.get).mockImplementation((async () => (
        { success: true, data: [], meta: { cursor: null, has_more: false } }
      )) as unknown as typeof api.get);
      render(<VolunteeringPage />);
      openSection('My hours and shifts');

      const find = await screen.findByTestId('hours-no-org-find');
      const apps = screen.getByTestId('hours-no-org-applications');
      expect(find).toHaveTextContent('Find opportunities');
      expect(apps).toHaveTextContent('Check my applications');

      fireEvent.click(apps);
      await waitFor(() => {
        expect(window.location.search).toBe('?tab=applications');
      });

      fireEvent.click(screen.getByRole('button', { name: 'Volunteering home' }));
      await waitFor(() => expect(window.location.search).toBe(''));
      openSection('My hours and shifts');
      fireEvent.click(await screen.findByTestId('hours-no-org-find'));
      await waitFor(() => {
        expect(window.location.search).toBe('');
      });
    });
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

      // The home's own title stays on phones too, so there is always a heading to orient by.
      expect(screen.getByRole('heading', { level: 1, name: 'Make a difference, your way.' })).toBeInTheDocument();
      // The desktop inline SearchField is replaced by the pill (a Button).
      expect(screen.queryByPlaceholderText('Search opportunities...')).not.toBeInTheDocument();
    });

    it('keeps how volunteering works one tap away once the welcome is dismissed', () => {
      window.localStorage.setItem('nexus_vol_welcome_dismissed_v1', '1');
      render(<VolunteeringPage />);
      // An anonymous phone visitor must still be able to find out how hours
      // become time credits — the exchange-rate sentence is the part not to lose.
      expect(screen.getByText('How volunteering works')).toBeInTheDocument();
      expect(screen.getByText(/1 time credit for every hour/i)).toBeInTheDocument();
      window.localStorage.removeItem('nexus_vol_welcome_dismissed_v1');
    });

    it('keeps Browse Organisations and the register invitation on phones', async () => {
      render(<VolunteeringPage />);
      expect(screen.getByText('Browse Organisations')).toBeInTheDocument();
      // No approved org and nothing pending → the register invitation must survive.
      expect(await screen.findByText('Register organisation')).toBeInTheDocument();
    });

    it('shows the section links on the page itself, with no sections picker to open', () => {
      render(<VolunteeringPage />);
      expect(screen.queryByRole('button', { name: 'Volunteering sections' })).not.toBeInTheDocument();
      const hub = within(screen.getByTestId('volunteering-hub'));
      expect(hub.getByRole('button', { name: /^My applications/ })).toBeInTheDocument();
      expect(hub.getByRole('button', { name: /^My hours and shifts/ })).toBeInTheDocument();
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

  // Group sign-ups is alpha and switched off for every community by default
  // (owner decision 2026-10-06). The tab only appears when a community admin
  // has deliberately turned it on, and a saved link to it falls back to
  // Opportunities instead of opening a hidden screen.
  describe('group sign-ups tab (alpha, off by default)', () => {
    const baseTenant = vi.mocked(useTenant).getMockImplementation();

    const withVolunteeringConfig = (config: Record<string, unknown>) => {
      vi.mocked(useTenant).mockImplementation(() => ({
        ...(baseTenant ? baseTenant() : {}),
        volunteeringConfig: config,
      }) as unknown as ReturnType<typeof useTenant>);
    };

    afterEach(() => {
      if (baseTenant) vi.mocked(useTenant).mockImplementation(baseTenant);
      window.history.replaceState({}, '', '/');
    });

    it('does not offer the section, and a ?tab=group-signups link goes home, when the community has it off', async () => {
      withVolunteeringConfig({ 'volunteering.tab_group_signups': false });
      window.history.replaceState({}, '', '/?tab=group-signups');
      render(<VolunteeringPage />);

      await waitFor(() => expect(window.location.search).toBe(''));
      expect(within(screen.getByTestId('volunteering-hub')).queryByRole('button', { name: 'Group sign-ups' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Make a difference, your way.' })).toBeInTheDocument();
    });

    it('opens the section when a community admin has turned it on', async () => {
      withVolunteeringConfig({ 'volunteering.tab_group_signups': true });
      window.history.replaceState({}, '', '/?tab=group-signups');
      render(<VolunteeringPage />);

      expect(await screen.findByRole('heading', { level: 1, name: 'Group sign-ups' })).toBeInTheDocument();
    });
  });
});
