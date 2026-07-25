// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SearchPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      success: true,
      data: { listings: [], users: [], events: [], groups: [] },
    }),
    post: vi.fn().mockResolvedValue({ success: true }),
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

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// Toggle phone layout. src/test/setup.ts stubs matchMedia with a hardcoded
// matches:false for EVERY query, so without this mock `isPhone` can never be
// true and the phone branch would get zero coverage. Query-aware so a
// max-width phone viewport never also answers "yes" to a min-width desktop
// query (which would be an impossible viewport).
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  getFormattingLocale: vi.fn(() => 'en'),
  responsiveThumbnailProps: vi.fn((url) => ({ src: url })),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/components/search/SavedSearches', () => ({
  SavedSearches: () => null,
}));

vi.mock('@/components/search/AdvancedSearchFilters', () => ({
  defaultFilters: {
    type: 'all', category_id: '', date_from: '', date_to: '', sort: 'relevance', skills: '', location: '',
  },
  AdvancedSearchFilters: () => null,
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

import { SearchPage } from './SearchPage';
import { api } from '@/lib/api';

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
    // The phone tests seed ?q=… to drive a search through the URL-sync effect
    // (the inline form is not rendered on phones); reset so nothing leaks.
    window.history.pushState({}, '', '/');
  });

  it('renders the page heading and description', () => {
    render(<SearchPage />);
    // "Search" appears in both the h1 heading and the document title/input — use heading role
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Find listings, members, events, and groups')).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<SearchPage />);
    expect(screen.getByPlaceholderText('Search for anything...')).toBeInTheDocument();
  });

  it('shows initial state prompt before searching', () => {
    render(<SearchPage />);
    expect(screen.getByText('Start searching')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a search term to find listings, members, events, and groups')
    ).toBeInTheDocument();
  });

  it('does not show result tabs before a search is performed', () => {
    render(<SearchPage />);
    expect(screen.queryByText(/All \(\d+\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Listings \(\d+\)/)).not.toBeInTheDocument();
  });

  it('shows no results state when search returns empty', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [],
    });

    render(<SearchPage />);

    // Simulate search by finding and submitting the form
    const input = screen.getByPlaceholderText('Search for anything...');
    const form = input.closest('form')!;

    // Update input value
    await import('@testing-library/react').then(({ fireEvent }) => {
      fireEvent.change(input, { target: { value: 'nonexistent' } });
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument();
    });
  });

  it('shows result tabs with counts after search', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/search?')) {
        return Promise.resolve({
          success: true,
          data: [
            { type: 'listing', id: 1, title: 'Test Listing', description: 'A listing', listing_type: 'offer', hours_estimate: 2 },
            { type: 'user', id: 1, name: 'Alice Smith', avatar_url: null, bio: 'Hello', location: 'Dublin' },
          ],
        });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    });

    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search for anything...');
    const form = input.closest('form')!;

    await import('@testing-library/react').then(({ fireEvent }) => {
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(screen.getByText('All (2)')).toBeInTheDocument();
    });
    // "Listings (1)" appears in both the tab and the section heading, use getAllByText
    expect(screen.getAllByText('Listings (1)').length).toBeGreaterThanOrEqual(1);
    // "Members (1)" also appears in both tab and section heading
    expect(screen.getAllByText('Members (1)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Events (0)')).toBeInTheDocument();
    expect(screen.getByText('Groups (0)')).toBeInTheDocument();
  });

  it('renders search results with listing and user details', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/search?')) {
        return Promise.resolve({
          success: true,
          data: [
            { type: 'listing', id: 1, title: 'Garden Help', description: 'Need help in garden', listing_type: 'request', hours_estimate: 3 },
            { type: 'user', id: 2, name: 'Bob Jones', avatar_url: null, bio: 'Gardener', location: 'Cork' },
          ],
        });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    });

    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search for anything...');
    const form = input.closest('form')!;

    await import('@testing-library/react').then(({ fireEvent }) => {
      fireEvent.change(input, { target: { value: 'garden' } });
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(screen.getByText('Garden Help')).toBeInTheDocument();
    });
    expect(screen.getByText('Need help in garden')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Gardener')).toBeInTheDocument();
  });

  it('groups podcast shows and episodes into the podcasts results section', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/search?')) {
        return Promise.resolve({
          success: true,
          data: [
            {
              type: 'podcast_show',
              id: 31,
              podcast_kind: 'show',
              show_slug: 'community-voices',
              title: 'Community Voices',
              summary: 'Stories from local members',
            },
            {
              type: 'podcast_episode',
              id: 32,
              podcast_kind: 'episode',
              show_slug: 'community-voices',
              episode_slug: 'garden-stories',
              show_title: 'Community Voices',
              title: 'Garden Stories',
              summary: 'Growing together',
            },
          ],
        });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    });

    render(<SearchPage />);
    const input = screen.getByPlaceholderText('Search for anything...');
    const form = input.closest('form')!;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'community' } });
    fireEvent.submit(form);

    await waitFor(() => expect(screen.getByText('Community Voices')).toBeInTheDocument());
    expect(screen.getByText('Garden Stories')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Garden Stories/ })).toHaveAttribute(
      'href',
      '/test/podcasts/community-voices/garden-stories'
    );
  });

  it('shows error state when search API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    render(<SearchPage />);

    const input = screen.getByPlaceholderText('Search for anything...');
    const form = input.closest('form')!;

    await import('@testing-library/react').then(({ fireEvent }) => {
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.submit(form);
    });

    await waitFor(() => {
      expect(screen.getByText('Search Error')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('does not show the "no results" empty state on the All tab when a search returns matches', async () => {
    // Regression guard for the per-category empty-state fix: a 0-result category tab
    // now shows an empty state, but that must NOT leak onto the default "all" tab when
    // results exist (activeCategoryCount is null for "all", so the new guard skips it).
    // The per-category empty behaviour itself is verified live — the HeroUI Tabs are an
    // inert stub under the ui mock so tab-switching can't be driven reliably in jsdom.
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/search?')) {
        return Promise.resolve({
          success: true,
          data: [
            { type: 'listing', id: 1, title: 'Test Listing', description: 'A listing', listing_type: 'offer', hours_estimate: 2 },
          ],
        });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    });

    render(<SearchPage />);
    const input = screen.getByPlaceholderText('Search for anything...');
    const form = input.closest('form')!;
    await import('@testing-library/react').then(({ fireEvent }) => {
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.submit(form);
    });

    await waitFor(() => expect(screen.getByText('All (1)')).toBeInTheDocument());
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky bar instead of the hero and the inline search form', () => {
      render(<SearchPage />);

      // Sticky bar: search pill (placeholder text, not an input) + Filters button.
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search for anything...')).toBeInTheDocument();

      // Hero and inline form are gone — the title moved to the app bar.
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
      expect(
        screen.queryByText('Find listings, members, events, and groups')
      ).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Search for anything...')).not.toBeInTheDocument();
      expect(screen.queryByText('Advanced Filters')).not.toBeInTheDocument();
    });

    it('opens the filter sheet with every filter section', async () => {
      render(<SearchPage />);
      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'Content Type' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radiogroup', { name: 'Sort By' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'All Types' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Relevance' })).toBeInTheDocument();
      // Free-text dimensions the desktop panel owns survive as real fields.
      expect(screen.getByText('Skill Tags')).toBeInTheDocument();
      expect(screen.getByLabelText('Add a skill tag...')).toBeInTheDocument();
      expect(screen.getByLabelText('From Date')).toBeInTheDocument();
      expect(screen.getByLabelText('To Date')).toBeInTheDocument();
      expect(screen.getByLabelText('Location')).toBeInTheDocument();
      // No query yet, so the endpoint cannot report a draft count.
      expect(screen.getByRole('button', { name: 'Show results' })).toBeInTheDocument();
    });

    it('loads categories and popular tags when the sheet opens', async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes('/v2/categories')) {
          return Promise.resolve({
            success: true,
            data: [{ id: 4, name: 'Gardening', slug: 'gardening' }],
          });
        }
        if (url.includes('/v2/listings/tags/popular')) {
          return Promise.resolve({ success: true, data: [{ tag: 'weeding', count: 3 }] });
        }
        return Promise.resolve({ success: true, data: [], meta: {} });
      });

      render(<SearchPage />);
      expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/v2/categories'));

      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Gardening' })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: 'weeding' })).toBeInTheDocument();
    });

    it('applies draft filters only when the apply button is pressed', async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes('/v2/search?')) {
          if (url.includes('type=events')) {
            return Promise.resolve({
              success: true,
              data: [{ type: 'event', id: 9, title: 'Drafted Event', description: 'Applied only' }],
            });
          }
          return Promise.resolve({
            success: true,
            data: [
              { type: 'listing', id: 1, title: 'Baseline Listing', description: 'Visible now', listing_type: 'offer', hours_estimate: 2 },
            ],
          });
        }
        return Promise.resolve({ success: true, data: [], meta: {} });
      });

      window.history.pushState({}, '', '/?q=test');
      render(<SearchPage />);
      await waitFor(() => expect(screen.getByText('Baseline Listing')).toBeInTheDocument());

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Events' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('radio', { name: 'Events' }));

      // The debounced count probe firing proves the draft change was processed…
      await waitFor(
        () => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('type=events')),
        { timeout: 3000 },
      );
      // …yet the results behind the sheet are untouched.
      expect(screen.getByText('Baseline Listing')).toBeInTheDocument();
      expect(screen.queryByText('Drafted Event')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^Show \d+ result/ }));

      await waitFor(() => expect(screen.getByText('Drafted Event')).toBeInTheDocument());
      expect(screen.queryByText('Baseline Listing')).not.toBeInTheDocument();
      // The applied filter is now a removable chip in the sticky bar.
      expect(screen.getByLabelText('Remove filter: Events')).toBeInTheDocument();
    });

    it('never lets abandoned overlay text become the applied query', async () => {
      // Regression guard: the search pill advertises the APPLIED query, and the
      // filter refetches must use it too. Closing the overlay with the back arrow
      // does not commit, so text typed and abandoned there must not reach either.
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.includes('/v2/search?')) {
          if (url.includes('type=events')) {
            return Promise.resolve({
              success: true,
              data: [{ type: 'event', id: 9, title: 'Committed Event', description: 'Applied' }],
            });
          }
          return Promise.resolve({
            success: true,
            data: [
              { type: 'listing', id: 1, title: 'Baseline Listing', description: 'Visible now', listing_type: 'offer', hours_estimate: 2 },
            ],
          });
        }
        return Promise.resolve({ success: true, data: [], meta: {} });
      });

      window.history.pushState({}, '', '/?q=test');
      render(<SearchPage />);
      await waitFor(() => expect(screen.getByText('Baseline Listing')).toBeInTheDocument());

      // Apply a filter so the sticky bar carries a removable chip.
      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => expect(screen.getByRole('radio', { name: 'Events' })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('radio', { name: 'Events' }));
      fireEvent.click(screen.getByRole('button', { name: /^Show/ }));
      await waitFor(() => expect(screen.getByLabelText('Remove filter: Events')).toBeInTheDocument());

      // Open the overlay from the pill, type, then abandon with the back arrow.
      fireEvent.click(screen.getByRole('button', { name: 'test' }));
      // The overlay's <input type="search"> — queried by role because its
      // aria-label is shared with the dialog wrapper.
      const overlayInput = await screen.findByRole('searchbox');
      fireEvent.change(overlayInput, { target: { value: 'abandoned' } });
      fireEvent.click(screen.getByLabelText('Close search'));

      // The pill still shows the committed query, never the abandoned text.
      await waitFor(() =>
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: 'test' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'abandoned' })).not.toBeInTheDocument();

      // …and removing a chip re-searches the committed query, so the URL and the
      // visible results cannot diverge.
      vi.mocked(api.get).mockClear();
      fireEvent.click(screen.getByLabelText('Remove filter: Events'));
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('q=test')),
      );
      expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('q=abandoned'));
    });
  });
});
