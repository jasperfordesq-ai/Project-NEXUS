// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for HelpCenterPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// HelpCenterPage.tsx:32 imports `useTenant, useFeature, useModule` from the
// '@/contexts' BARREL, so this barrel factory is live for the page itself.
vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
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
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// 🔴 …but the barrel factory above does NOT reach <PageMeta>, which HelpCenterPage
// imports by its direct path ('@/components/seo/PageMeta', HelpCenterPage.tsx:31) —
// so setup.ts's global '@/components/seo' barrel mock misses it too. Real PageMeta
// imports `useTenant` from '@/contexts/TenantContext', and Vitest keys mocks per
// specifier, so the real hook loaded and threw "useTenant must be used within a
// TenantProvider" (TenantContext.tsx:722) — killing all 9 tests before render.
// TOTAL factory (no importOriginal spread) on purpose: TenantContext.tsx:30 imports
// '@/i18n', whose module scope calls i18n.init() with an HTTP backend and would
// clobber the synchronous English resources src/test/setup.ts loads.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(['variants', 'initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// No '@/components/ui' barrel mock: HelpCenterPage imports every primitive it uses
// by direct path (Accordion, Button, GlassCard, SearchField, Spinner, SafeHtml), so
// the barrel override never applied to the page — the real components were already
// rendering and the stub testids/roles it produced were unreachable. The real
// Accordion, SearchField and Chip render here.

import { HelpCenterPage } from './HelpCenterPage';
import { api } from '@/lib/api';

const mockApiGet = vi.mocked(api.get);

const mockFaqGroups = [
  {
    category: 'Getting Started',
    faqs: [
      { id: 1, question: 'What is timebanking?', answer: 'Timebanking is a way of exchanging time and skills.' },
      { id: 2, question: 'How do I sign up?', answer: 'Click the Register button on the home page.' },
    ],
  },
  {
    category: 'Wallet',
    faqs: [
      { id: 3, question: 'How do I earn time credits?', answer: 'By helping other members.' },
    ],
  },
];

describe('HelpCenterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching FAQs', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<HelpCenterPage />);
    // HelpCenterPage.tsx:169 — the loading GlassCard is role="status" labelled
    // with utility.json help.loading, and holds the Spinner + the same copy.
    const status = screen.getByRole('status', { name: 'Loading help articles...' });
    expect(status).toHaveTextContent('Loading help articles...');
  });

  it('renders FAQ categories after successful API response', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFaqGroups });
    render(<HelpCenterPage />);

    await waitFor(() => {
      expect(screen.getByText('Getting Started')).toBeInTheDocument();
    });
    expect(screen.getByText('Wallet')).toBeInTheDocument();
  });

  it('renders individual FAQ questions', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFaqGroups });
    render(<HelpCenterPage />);

    await waitFor(() => {
      expect(screen.getByText('What is timebanking?')).toBeInTheDocument();
    });
    expect(screen.getByText('How do I sign up?')).toBeInTheDocument();
  });

  it('renders search input', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFaqGroups });
    render(<HelpCenterPage />);

    // The real SearchField renders an <input type="search"> → role="searchbox"
    // (not "textbox", which only the dead uiMock stub produced), labelled with
    // utility.json help.search_placeholder. There is exactly one on the page.
    const searchbox = await screen.findByRole('searchbox', { name: 'Search for help...' });
    expect(searchbox).toHaveAttribute('placeholder', 'Search for help...');
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  });

  it('filters FAQs based on search query', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFaqGroups });
    render(<HelpCenterPage />);

    await waitFor(() => {
      expect(screen.getByText('What is timebanking?')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'time credits' } });

    await waitFor(() => {
      // 'Wallet' category FAQ with "How do I earn time credits?" should remain visible
      expect(screen.getByText('How do I earn time credits?')).toBeInTheDocument();
    });
    // …and only that category survives the filter.
    expect(screen.getByText('Wallet')).toBeInTheDocument();
    expect(screen.queryByText('Getting Started')).not.toBeInTheDocument();
    // 'Getting Started' FAQs should be filtered out (no match for "time credits")
    expect(screen.queryByText('How do I sign up?')).not.toBeInTheDocument();
    expect(screen.queryByText('What is timebanking?')).not.toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    mockApiGet.mockResolvedValue({ success: false });
    render(<HelpCenterPage />);

    // HelpCenterPage.tsx:177 — the error GlassCard is role="alert" and carries
    // utility.json help.load_error_title / help.load_error_description.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load FAQs');
    expect(alert).toHaveTextContent('Please try refreshing the page or contact support.');
  });

  it('shows empty state when search returns no results', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockFaqGroups });
    render(<HelpCenterPage />);

    await waitFor(() => {
      expect(screen.getByText('What is timebanking?')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'xyzzy_nonexistent' } });

    // Positive precondition: the real empty-state copy (utility.json
    // help.no_results_found) renders, so the absence assertions below cannot pass
    // just because the FAQ tree failed to render at all.
    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contact us' })).toHaveAttribute('href', '/test/contact');
    // All FAQ categories filtered out — no question or category heading remains.
    expect(screen.queryByText('What is timebanking?')).not.toBeInTheDocument();
    expect(screen.queryByText('Getting Started')).not.toBeInTheDocument();
    expect(screen.queryByText('Wallet')).not.toBeInTheDocument();
  });

  it('renders quick links to listings, wallet, events, and contact', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<HelpCenterPage />);

    // One QuickLink per enabled module/feature (useModule/useFeature are mocked
    // true) plus the always-present Contact Us tile — assert each by its real
    // English label AND its tenant-scoped destination.
    const expected: Array<[string, string]> = [
      ['Browse Listings', '/test/listings'],
      ['My Wallet', '/test/wallet'],
      ['Events', '/test/events'],
      ['Contact Us', '/test/contact'],
    ];
    for (const [label, href] of expected) {
      const link = await screen.findByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('renders the "Still Need Help" section with a contact link', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<HelpCenterPage />);

    // utility.json help.still_need_help / help.still_need_help_description
    expect(await screen.findByText('Still need help?')).toBeInTheDocument();
    expect(
      screen.getByText("Can't find what you're looking for? Our team is here to help.")
    ).toBeInTheDocument();

    const contactLinks = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/test/contact');
    // The hero CTA, the Contact Us quick link and the Still-need-help CTA.
    expect(contactLinks.length).toBeGreaterThanOrEqual(2);
    expect(
      contactLinks.some((l) => l.textContent?.includes('Contact Support'))
    ).toBe(true);
  });
});
