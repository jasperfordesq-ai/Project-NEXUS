// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// Mock the podcastsApi module (the page uses podcastsApi, not raw api directly)
vi.mock('@/lib/api/podcasts', () => ({
  podcastsApi: {
    show: vi.fn(),
    toggleSubscription: vi.fn(),
  },
}));

// The page also imports API_BASE from @/lib/api — provide a minimal stub
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  API_BASE: 'http://localhost:8090',
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 42, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => mockToast,
  })
);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ showSlug: 'my-cool-show' }),
    useNavigate: () => vi.fn(),
  };
});

import { podcastsApi } from '@/lib/api/podcasts';
import PodcastShowPage from './PodcastShowPage';

const makeShow = (overrides = {}): object => ({
  id: 1,
  owner_user_id: 99,
  title: 'My Cool Show',
  slug: 'my-cool-show',
  summary: 'A show about things',
  description: 'Extended description here.',
  artwork_url: null,
  language: 'en',
  category: 'Technology',
  visibility: 'public',
  status: 'published',
  moderation_status: 'approved',
  episode_count: 2,
  subscriber_count: 10,
  is_subscribed: false,
  rss_enabled: true,
  owner: { id: 99, name: 'Jane Doe', avatar_url: null },
  episodes: [
    {
      id: 101,
      show_id: 1,
      author_user_id: 99,
      title: 'Episode One',
      slug: 'episode-one',
      summary: 'First episode summary',
      audio_url: 'https://example.com/ep1.mp3',
      explicit: false,
      episode_type: 'full',
      visibility: 'public',
      status: 'published',
      moderation_status: 'approved',
      listen_count: 50,
    },
  ],
  ...overrides,
});

describe('PodcastShowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a spinner while loading', () => {
    vi.mocked(podcastsApi.show).mockReturnValue(new Promise(() => {}));

    render(<PodcastShowPage />);

    // The loading branch renders an aria-busy container and a Spinner (which
    // itself emits role="status"). There may be multiple role="status" nodes
    // (e.g. the toast region); use getAllByRole and confirm the busy one exists.
    const statusEls = screen.getAllByRole('status');
    const busyEl = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busyEl).toBeTruthy();
  });

  it('renders show title and summary after data loads', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow(),
    });

    render(<PodcastShowPage />);

    await waitFor(() => {
      expect(screen.getByText('My Cool Show')).toBeInTheDocument();
    });

    expect(screen.getByText('A show about things')).toBeInTheDocument();
  });

  // A show without artwork showed its initials; it now has a cover in its own
  // colour — the same colour as the player bar while one of its episodes plays.
  it('gives a show without artwork a cover in the same colour as the player bar', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({ success: true, data: makeShow() as never });
    render(<PodcastShowPage />);

    const cover = await screen.findByTestId('podcast-show-cover');
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(cover.getAttribute('data-colour')).toBe(colourForSeed(coverSeed.podcastShow('my-cool-show'), paletteFor(null)));
  });

  it('renders episode list', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow(),
    });

    render(<PodcastShowPage />);

    await waitFor(() => {
      expect(screen.getByText('Episode One')).toBeInTheDocument();
    });
  });

  it('shows not-found message when show data is null', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: false,
      data: undefined,
    });

    render(<PodcastShowPage />);

    // i18n resolves 'show.not_found' → "Podcast show not found"
    await waitFor(() => {
      expect(screen.getByText(/Podcast show not found/i)).toBeInTheDocument();
    });
  });

  it('shows not-found message when API returns success:true but no data', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: null,
    });

    render(<PodcastShowPage />);

    await waitFor(() => {
      expect(screen.getByText(/Podcast show not found/i)).toBeInTheDocument();
    });
  });

  it('shows category chip', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ category: 'Science' }),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    expect(screen.getByText('Science')).toBeInTheDocument();
  });

  it('shows subscribe button for authenticated non-owner users', async () => {
    // owner_user_id = 99; logged-in user = 42 → not the owner
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ is_subscribed: false }),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    // i18n resolves 'show.subscribe' → "Follow show"
    expect(screen.getByRole('button', { name: /Follow show/i })).toBeInTheDocument();
  });

  it('shows unsubscribe button when already subscribed', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ is_subscribed: true }),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    // i18n resolves 'show.unsubscribe' → "Unfollow show"
    expect(screen.getByRole('button', { name: /Unfollow show/i })).toBeInTheDocument();
  });

  it('calls toggleSubscription when subscribe button is clicked', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ is_subscribed: false }),
    });
    vi.mocked(podcastsApi.toggleSubscription).mockResolvedValueOnce({
      success: true,
      data: { subscribed: true },
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    // "Follow show" button
    const subscribeBtn = screen.getByRole('button', { name: /Follow show/i });
    fireEvent.click(subscribeBtn);

    await waitFor(() => {
      expect(podcastsApi.toggleSubscription).toHaveBeenCalledWith(1, true);
    });

    expect(mockToast.success).toHaveBeenCalled();
  });

  it('shows error toast when subscription toggle fails', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ is_subscribed: false }),
    });
    vi.mocked(podcastsApi.toggleSubscription).mockResolvedValueOnce({
      success: false,
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    const subscribeBtn = screen.getByRole('button', { name: /Follow show/i });
    fireEvent.click(subscribeBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows "Manage show" button for the owner', async () => {
    // Logged-in user id = 42; set owner_user_id = 42
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ owner_user_id: 42 }),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    // studio.manage_show translation key
    expect(screen.getByRole('link', { name: /studio\.manage_show|manage show/i })).toBeInTheDocument();
  });

  it('renders an RSS feed link when rss_enabled is true', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ rss_enabled: true }),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    const rssLink = screen.getByRole('link', { name: /rss_feed|rss/i });
    expect(rssLink).toHaveAttribute('href', expect.stringContaining('/v2/podcasts/'));
  });

  it('shows "no episodes" message when episode list is empty', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow({ episodes: [] }),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(screen.getByText('My Cool Show')).toBeInTheDocument());

    // i18n resolves 'show.no_episodes' → "No published episodes yet."
    expect(screen.getByText(/No published episodes yet/i)).toBeInTheDocument();
  });

  it('uses podcastsApi.show with the route slug from useParams', async () => {
    vi.mocked(podcastsApi.show).mockResolvedValueOnce({
      success: true,
      data: makeShow(),
    });

    render(<PodcastShowPage />);

    await waitFor(() => expect(podcastsApi.show).toHaveBeenCalledWith('my-cool-show'));
  });
});
