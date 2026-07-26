// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Mock @/contexts ─────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── NO barrel mock of '@/components/ui' ──────────────────────────────────────
// TrendingHashtags imports GlassCard and Spinner from their DIRECT module paths
// ('@/components/ui/GlassCard', '@/components/ui/Spinner'), so overrides on the
// '@/components/ui' barrel never apply — the real components load either way. The
// real GlassCard renders
//   <div class="card card--default glass-card p-4 …" data-slot="card">
// and the loading state's role="status"/aria-busy comes from the widget's own
// wrapper div, not from Spinner.
const CARD = '.glass-card';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeHashtag = (overrides = {}) => ({
  tag: 'timebanking',
  post_count: 42,
  trend_direction: 'up' as const,
  ...overrides,
});

const makeResponse = (data: object[]) => ({
  success: true,
  data,
});

// ─── Test suite ─────────────────────────────────────────────────────────────
describe('TrendingHashtags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeResponse([]));
  });

  it('shows a loading spinner while fetching', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    // Loading state: role=status with aria-busy — filter out ToastProvider's persistent status element
    const statusEls = screen.getAllByRole('status');
    const busyEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeDefined();
  });

  it('renders nothing when API returns empty list', async () => {
    mockApi.get.mockResolvedValue(makeResponse([]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    const { container } = render(<TrendingHashtags />);

    // Positive precondition: the loading state DOES render a card, so the null
    // assertion below only holds once the empty response has actually landed.
    expect(container.querySelector(CARD)).not.toBeNull();

    // When hashtags are empty the component returns null — no glass-card should exist
    await waitFor(() => {
      expect(container.querySelector(CARD)).toBeNull();
    });
    expect(mockApi.get).toHaveBeenCalledWith('/v2/feed/hashtags/trending?limit=10');
  });

  it('renders hashtag links after data loads', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeHashtag({ tag: 'timebanking' })]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      expect(screen.getByText('#timebanking')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoint with the limit param', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeHashtag()]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags limit={5} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/feed/hashtags/trending?limit=5');
    });
  });

  it('uses default limit of 10 when not specified', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeHashtag()]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/feed/hashtags/trending?limit=10');
    });
  });

  it('renders the correct tenant-scoped link for each hashtag', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeHashtag({ tag: 'skills' })]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      const link = screen.getByText('#skills').closest('a');
      expect(link).toHaveAttribute('href', '/test/feed/hashtag/skills');
    });
  });

  it('renders post count for each hashtag', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeHashtag({ tag: 'exchange', post_count: 7 })]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      expect(screen.getByText('#exchange')).toBeInTheDocument();
    });
    // Real English pluralised copy from feed:trending.post_count_other, inside the
    // hashtag's own row rather than merely somewhere on the card.
    const row = screen.getByText('#exchange').closest('a')!;
    expect(within(row).getByText('7 posts')).toBeInTheDocument();
  });

  it('renders multiple hashtags in order', async () => {
    const hashtags = [
      makeHashtag({ tag: 'alpha', post_count: 100 }),
      makeHashtag({ tag: 'beta', post_count: 50 }),
      makeHashtag({ tag: 'gamma', post_count: 10 }),
    ];
    mockApi.get.mockResolvedValue(makeResponse(hashtags));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      const links = screen.getAllByRole('link');
      // Each hashtag link contains its tag text (e.g. "#alpha"); filter to those links
      const tagLinks = links.filter((l) => {
        const text = l.textContent ?? '';
        return text.includes('#alpha') || text.includes('#beta') || text.includes('#gamma');
      });
      expect(tagLinks[0].textContent).toContain('#alpha');
      expect(tagLinks[1].textContent).toContain('#beta');
      expect(tagLinks[2].textContent).toContain('#gamma');
    });
  });

  it('renders a "view all" link to the hashtags page', async () => {
    mockApi.get.mockResolvedValue(makeResponse([makeHashtag()]));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      const viewAllLink = screen.getAllByRole('link').find((l) =>
        l.getAttribute('href') === '/test/feed/hashtags'
      );
      expect(viewAllLink).toBeInTheDocument();
    });
  });

  it('renders rank numbers for each hashtag', async () => {
    const hashtags = [makeHashtag({ tag: 'first' }), makeHashtag({ tag: 'second' })];
    mockApi.get.mockResolvedValue(makeResponse(hashtags));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    render(<TrendingHashtags />);

    await waitFor(() => {
      expect(screen.getByText('#second')).toBeInTheDocument();
    });
    // The rank belongs to its own hashtag row: scope the lookup to each row so a
    // stray digit elsewhere on the card cannot satisfy it.
    const firstRow = screen.getByText('#first').closest('a')!;
    const secondRow = screen.getByText('#second').closest('a')!;
    expect(within(firstRow).getByText('1')).toBeInTheDocument();
    expect(within(secondRow).getByText('2')).toBeInTheDocument();
  });

  it('silently handles API errors and renders nothing', async () => {
    mockApi.get.mockRejectedValue(new Error('network error'));
    const { TrendingHashtags } = await import('./TrendingHashtags');
    const { container } = render(<TrendingHashtags />);

    // Positive precondition: the loading card mounted, so the null assertion
    // below proves the rejection actually unwound the widget.
    expect(container.querySelector(CARD)).not.toBeNull();

    await waitFor(() => {
      // After error, hashtags stay empty → component returns null (no glass-card)
      expect(container.querySelector(CARD)).toBeNull();
    });
    expect(mockApi.get).toHaveBeenCalledTimes(1);
  });
});
