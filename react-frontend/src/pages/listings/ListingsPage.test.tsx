// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ListingsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// The page (and its children) import contexts via direct paths, not the barrel —
// mock those modules too or the real providers throw in jsdom.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  // test-utils wraps renders in the real ToastProvider import — keep the name.
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
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

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: vi.fn((...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));

let mapsEnabled = false;
vi.mock('@/lib/map-config', () => ({
  get MAPS_ENABLED() { return mapsEnabled; },
}));

// Toggle phone layout (useMediaQuery drives the sticky bar + filter sheet).
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => isPhoneViewport),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/location', () => ({
  EntityMapView: () => <div data-testid="map-view">Map</div>,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { ListingsPage } from './ListingsPage';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

describe('ListingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapsEnabled = false;
    isPhoneViewport = false;
  });

  it('renders without crashing', () => {
    render(<ListingsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Offers and requests' })).toBeInTheDocument();
  });

  /** Runs `check` while the visitor is signed out, then signs the member back in. */
  function asVisitor(check: () => void) {
    const signedIn = vi.mocked(useAuth).getMockImplementation();
    vi.mocked(useAuth).mockReturnValue({ user: null, isAuthenticated: false } as unknown as ReturnType<typeof useAuth>);
    try {
      check();
    } finally {
      // clearAllMocks keeps implementations, so put the signed-in member back.
      if (signedIn) vi.mocked(useAuth).mockImplementation(signedIn);
    }
  }

  it('gives a visitor the page banner in plain, warm words', () => {
    asVisitor(() => {
      render(<ListingsPage />);
      const banner = document.querySelector<HTMLElement>('[data-public-page-hero="true"]');
      expect(banner).not.toBeNull();
      expect(within(banner!).getByRole('heading', { level: 1, name: 'Offers and requests' })).toBeInTheDocument();
      expect(within(banner!).getByText('People helping people')).toBeInTheDocument();
      expect(within(banner!).getByText('See what people in this community can offer, and what they need help with.')).toBeInTheDocument();
    });
  });

  it('shows a signed-in member one header: the welcome panel replaces the banner (AWID feedback)', () => {
    render(<ListingsPage />);
    expect(document.querySelector('[data-public-page-hero="true"]')).toBeNull();

    const panel = screen.getByTestId('listings-welcome');
    expect(within(panel).getByRole('heading', { level: 1, name: 'Offers and requests' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(panel).getByText('Welcome back, Test')).toBeInTheDocument();
    expect(within(panel).getByText(/Every hour you give comes back to the community/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'My offers and requests' })).toHaveAttribute('href', '/test/listings/mine');
    // Exactly one of each on the page.
    expect(screen.getByRole('link', { name: 'Offer help' })).toHaveAttribute('href', '/test/listings/create?type=offer');
    expect(screen.getByRole('link', { name: 'Ask for help' })).toHaveAttribute('href', '/test/listings/create?type=request');
  });

  it('keeps the search box free of a second heading and a second count', async () => {
    render(<ListingsPage />);

    expect(screen.queryByText('Browse Listings')).toBeNull();
    // Still named for screen-reader users, who move between headings.
    expect(screen.getByRole('heading', { level: 2, name: 'Find an offer or request' })).toHaveClass('sr-only');
    await waitFor(() => {
      expect(screen.getAllByText(/^(\d+ offers and requests|Finding offers and requests)$/)).toHaveLength(1);
    });
  });

  describe('one word for the page: "offers and requests", never "listings"', () => {
    const offer = {
      id: 1, title: 'Dog walking', description: 'Mornings, near the park.', type: 'offer', status: 'active',
      created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
      image_url: '/uploads/listings/dog.jpg', estimated_hours: 1, user: { id: 9, name: 'Sofia Haddad' },
    };

    /** Everything a sighted or screen-reader user meets on the page. */
    function pageWords() {
      const labels = [...document.querySelectorAll('[aria-label], [title], [alt]')].flatMap((el) =>
        ['aria-label', 'title', 'alt'].map((name) => el.getAttribute(name) ?? ''));
      return [document.body.textContent ?? '', ...labels].join(' | ');
    }

    beforeEach(() => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? { success: true, meta: {}, data: [offer] }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );
    });

    it('on a computer', async () => {
      render(<ListingsPage />);
      await screen.findByTestId('listing-card');
      expect(pageWords()).not.toMatch(/listing/i);
      expect(screen.getByRole('button', { name: 'Save for later' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Details for Dog walking' })).toBeInTheDocument();
    });

    it('on a phone, with the filter sheet open', async () => {
      isPhoneViewport = true;
      render(<ListingsPage />);
      await screen.findByTestId('listing-card');
      fireEvent.click(screen.getByLabelText('More filters'));
      await screen.findByText('Show results');
      expect(pageWords()).not.toMatch(/listing/i);
    });

    it('when there is nothing to show yet', async () => {
      vi.mocked(api.get).mockImplementation(() =>
        Promise.resolve({ success: true, meta: {}, data: [] }) as ReturnType<typeof api.get>);
      render(<ListingsPage />);
      expect(await screen.findByText('No offers or requests to show')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Share an offer or request' }))
        .toHaveAttribute('href', '/test/listings/create');
      expect(pageWords()).not.toMatch(/listing/i);
    });

    it('when they cannot be loaded', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        (url.startsWith('/v2/listings')
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ success: true, meta: {}, data: [] })) as ReturnType<typeof api.get>);
      render(<ListingsPage />);
      expect(await screen.findByText("We couldn't load this right now")).toBeInTheDocument();
      expect(screen.getByText('Please check your connection and try again.')).toBeInTheDocument();
      expect(pageWords()).not.toMatch(/listing/i);
    });
  });

  it('shows the welcome panel on phones too, with the greeting as its heading', () => {
    isPhoneViewport = true;
    render(<ListingsPage />);
    const panel = screen.getByTestId('listings-welcome');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Welcome back, Test' })).toBeInTheDocument();
    // The phone's app bar carries the title; the page keeps one hidden h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Offer help' })).toBeInTheDocument();
  });

  it('shows no welcome panel to a visitor who is not signed in', () => {
    asVisitor(() => {
      render(<ListingsPage />);
      expect(screen.queryByTestId('listings-welcome')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Offer help' })).toBeNull();
    });
  });

  describe('browse by theme', () => {
    const categories = [
      { id: 1, name: 'Care & wellbeing', slug: 'care', color: 'pink' },
      { id: 2, name: 'Learning', slug: 'learning', color: 'blue' },
    ];

    beforeEach(() => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/categories')
            ? { success: true, data: categories }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );
    });

    it('shows every theme as a tile in the colour the admin chose', async () => {
      render(<ListingsPage />);

      const group = await screen.findByRole('grid', { name: 'Browse by theme' });
      expect(group).toHaveTextContent('All themes');
      expect(group).toHaveTextContent('Care & wellbeing');
      expect(group).toHaveTextContent('Learning');
      const care = screen.getByRole('row', { name: 'Care & wellbeing' });
      expect(care.className).toContain('bg-pink-100');
      expect(care.querySelector('.bg-pink-500')).not.toBeNull();
    });

    it('gives each theme its own colour while the community has left them all blue', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/categories')
            ? { success: true, data: categories.map((c) => ({ ...c, color: 'blue' })) }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );
      render(<ListingsPage />);

      const care = await screen.findByRole('row', { name: 'Care & wellbeing' });
      const learning = screen.getByRole('row', { name: 'Learning' });
      expect(care.className).toContain('bg-blue-100');
      expect(learning.className).toContain('bg-orange-100');
    });

    it('shows only that theme when a member picks it', async () => {
      render(<ListingsPage />);

      const learning = await screen.findByRole('row', { name: 'Learning' });
      fireEvent.click(learning);

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('category=learning'));
      });
    });
  });

  it('renders search input', () => {
    render(<ListingsPage />);
    expect(screen.getByPlaceholderText(/Search by title/i)).toBeInTheDocument();
  });

  it('shows view mode buttons (grid and list)', () => {
    render(<ListingsPage />);
    expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
    expect(screen.getByLabelText('List view')).toBeInTheDocument();
  });

  it('requests only coordinate-backed listings in map view', async () => {
    mapsEnabled = true;
    render(<ListingsPage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/listings\?/));
    });

    fireEvent.click(screen.getByLabelText('Map view'));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('with_coordinates=1'));
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('per_page=100'));
    });
  });

  describe('listing card author', () => {
    /**
     * Regression: the card keyed on `author_name` only. The list endpoint sent the
     * member's name under `user.name`, so every card showed the "User" fallback.
     */
    it('shows the member name when only user.name is present', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  {
                    id: 1,
                    title: 'Basic carpentry',
                    description: 'I would love some basic carpentry advice.',
                    type: 'request',
                    status: 'active',
                    created_at: '2026-08-01T00:00:00Z',
                    updated_at: '2026-08-01T00:00:00Z',
                    location: 'Dunmanway, County Cork, Ireland',
                    user: { id: 9, first_name: 'Aoife', last_name: 'Nolan', name: 'Aoife Nolan' },
                  },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      await waitFor(() => {
        expect(screen.getByText('Aoife Nolan')).toBeInTheDocument();
      });
      expect(screen.queryByText('User')).not.toBeInTheDocument();
    });
  });

  describe('listing card photo', () => {
    it("uses the member's photo description as the alt text (AWID regression)", async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  {
                    id: 1,
                    title: 'Basic carpentry',
                    description: 'I would love some basic carpentry advice.',
                    type: 'request',
                    status: 'active',
                    created_at: '2026-08-01T00:00:00Z',
                    updated_at: '2026-08-01T00:00:00Z',
                    image_url: '/uploads/listings/saw.jpg',
                    image_alt: 'A hand saw on a workbench',
                    user: { id: 9, name: 'Aoife Nolan' },
                  },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      expect((await screen.findAllByAltText('A hand saw on a workbench')).length).toBeGreaterThan(0);
    });

    it('shows the theme in its colour, not a grey box, when there is no photo', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  {
                    id: 1,
                    title: 'French conversation',
                    description: 'Relaxed practice over video.',
                    type: 'offer',
                    status: 'active',
                    created_at: '2026-08-01T00:00:00Z',
                    updated_at: '2026-08-01T00:00:00Z',
                    category_name: 'Learning',
                    category_color: 'blue',
                    user: { id: 9, name: 'Sofia Haddad' },
                  },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      const band = await screen.findByTestId('listing-theme-band');
      expect(band).toHaveTextContent('Learning');
      expect(band.className).toContain('bg-blue-100');
    });

    it('colours a card the same as its theme tile when themes were left blue', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/categories')
            ? {
                success: true,
                data: [
                  { id: 1, name: 'Care', slug: 'care', color: 'blue' },
                  { id: 2, name: 'Learning', slug: 'learning', color: 'blue' },
                ],
              }
            : url.startsWith('/v2/listings')
              ? {
                  success: true,
                  meta: {},
                  data: [
                    {
                      id: 1,
                      title: 'French conversation',
                      description: 'Relaxed practice over video.',
                      type: 'offer',
                      status: 'active',
                      created_at: '2026-08-01T00:00:00Z',
                      updated_at: '2026-08-01T00:00:00Z',
                      category_name: 'Learning',
                      category_slug: 'learning',
                      category_color: 'blue',
                      user: { id: 9, name: 'Sofia Haddad' },
                    },
                  ],
                }
              : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      await screen.findByRole('row', { name: 'Learning' });
      await waitFor(() => {
        expect(screen.getByTestId('listing-theme-band').className).toContain('bg-orange-100');
      });
    });

    it('labels Offer and Request in readable text, not 10px', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  {
                    id: 1,
                    title: 'French conversation',
                    description: 'Relaxed practice over video.',
                    type: 'offer',
                    status: 'active',
                    created_at: '2026-08-01T00:00:00Z',
                    updated_at: '2026-08-01T00:00:00Z',
                    user: { id: 9, name: 'Sofia Haddad' },
                  },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      // Said once: the coloured panel of a card with no theme no longer
      // repeats "Offering" above the label.
      const label = (await screen.findByText('Offering')).closest('[data-slot="chip"]');
      expect(label).toHaveClass('text-xs');
      expect(label?.className).not.toContain('text-[10px]');
      // No photo and no theme: the offer's own green, never a grey box.
      const band = screen.getByTestId('listing-theme-band');
      expect(band.className).toContain('bg-green-100');
      expect(band.textContent).toBe('');
    });

    it('names the theme once on a card with no photo, and puts "Remote" beside the hours', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  {
                    id: 1,
                    title: 'French conversation',
                    description: 'Relaxed practice over video.',
                    type: 'offer',
                    status: 'active',
                    created_at: '2026-08-01T00:00:00Z',
                    updated_at: '2026-08-01T00:00:00Z',
                    category_name: 'Learning',
                    category_color: 'blue',
                    service_type: 'remote_only',
                    estimated_hours: 2,
                    user: { id: 9, name: 'Sofia Haddad' },
                  },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      const card = await screen.findByTestId('listing-card');
      const mentions = within(card).getAllByText('Learning');
      // Seen once, in the coloured panel ...
      expect(mentions.filter((el) => !el.classList.contains('sr-only'))).toHaveLength(1);
      expect(within(card).getByTestId('listing-theme-band')).toHaveTextContent('Learning');
      // ... and still heard by screen readers, because the panel is decoration.
      expect(mentions.some((el) => el.classList.contains('sr-only'))).toBe(true);
      // "Remote" is part of the details line, not one more label.
      expect(within(card).getByText('Remote').closest('[data-slot="chip"]')).toBeNull();
      expect(within(card).getByText('2h')).toBeInTheDocument();
    });

    it('shows hours as a person would write them: "1.5h", not "1.50h"', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  // The API sends the database's decimal as a string.
                  { id: 1, title: 'Dog walking', description: 'Mornings.', type: 'offer', status: 'active',
                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                    estimated_hours: '1.50', user: { id: 9, name: 'Sofia Haddad' } },
                  { id: 2, title: 'Lift to town', description: 'Saturdays.', type: 'request', status: 'active',
                    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
                    estimated_hours: '0.00', user: { id: 10, name: 'Aoife Nolan' } },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      const [dogs, lift] = await screen.findAllByTestId('listing-card');
      expect(within(dogs!).getByText('1.5h')).toBeInTheDocument();
      expect(within(dogs!).queryByText('1.50h')).toBeNull();
      // Zero hours says nothing useful, so it is left out.
      expect(within(lift!).queryByText(/h$/)).toBeNull();
    });

    it('does not darken a card when the pointer is over it', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/listings')
            ? {
                success: true,
                meta: {},
                data: [
                  {
                    id: 1,
                    title: 'Basic carpentry',
                    description: 'I would love some basic carpentry advice.',
                    type: 'request',
                    status: 'active',
                    created_at: '2026-08-01T00:00:00Z',
                    updated_at: '2026-08-01T00:00:00Z',
                    image_url: '/uploads/listings/saw.jpg',
                    user: { id: 9, name: 'Aoife Nolan' },
                  },
                ],
              }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );

      render(<ListingsPage />);

      const card = await screen.findByTestId('listing-card');
      expect(card.querySelector('[class*="group-hover:bg-black"]')).toBeNull();
    });
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky bar with search pill, Filters button and view toggle', () => {
      render(<ListingsPage />);
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      // The bar's own short label: the longer one was cut off on a phone.
      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
      expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
      expect(screen.getByLabelText('List view')).toBeInTheDocument();
    });

    it('opens the filter sheet with every filter section', async () => {
      render(<ListingsPage />);
      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByText('Duration')).toBeInTheDocument();
      });
      expect(screen.getByText('Service mode')).toBeInTheDocument();
      expect(screen.getByText('Posted date')).toBeInTheDocument();
      expect(screen.getByText('Distance')).toBeInTheDocument();
      expect(screen.getByText('Sort')).toBeInTheDocument();
      expect(screen.getByText('Under 1h')).toBeInTheDocument();
      expect(screen.getByText('Show results')).toBeInTheDocument();
    });

    it('calls them themes in the filter sheet, as the page does', async () => {
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(
          url.startsWith('/v2/categories')
            ? { success: true, data: [{ id: 1, name: 'Learning', slug: 'learning', color: 'blue' }] }
            : { success: true, meta: {}, data: [] },
        ) as ReturnType<typeof api.get>,
      );
      render(<ListingsPage />);
      await screen.findByRole('row', { name: 'Learning' });
      fireEvent.click(screen.getByLabelText('More filters'));

      await screen.findByText('Show results');
      expect(screen.getByText('Theme')).toBeInTheDocument();
      expect(screen.queryByText(/categor/i)).toBeNull();
    });

    it('applies draft filters only when Show results is pressed', async () => {
      render(<ListingsPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/listings\?/));
      });
      vi.mocked(api.get).mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByText('Offers')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Offers'));
      // Draft change fetches a live count (per_page=1) but must not refetch the grid.
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('per_page=1'));
      });
      expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('per_page=20'));

      fireEvent.click(screen.getByText('Show results'));
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/type=offer.*per_page=20/));
      });
    });
  });
});
