// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ListingDetailPage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// vi.hoisted so the react-router-dom factory (which runs as soon as
// @/test/test-utils imports react-router-dom) can reference it without a
// temporal-dead-zone crash.
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
import { api } from '@/lib/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 99, first_name: 'Alice', name: 'Alice Test' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

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

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 99, first_name: 'Alice', name: 'Alice Test' },
    isAuthenticated: true,
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/hooks/useSocialInteractions', () => ({
  useSocialInteractions: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url) => url || null),
  resolveThumbnailUrl: vi.fn((url) => url || null),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '1' }),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// The delete confirmation flow needs the modal to actually mount its children
// when opened. Stub the Modal wrapper (HeroUI portal/overlay plumbing is
// irrelevant here) so isOpen deterministically controls rendering in jsdom.
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen?: boolean; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
  ModalContent: ({ children }: { children?: React.ReactNode | ((onClose: () => void) => React.ReactNode) }) => (
    <div>{typeof children === 'function' ? children(() => {}) : children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  ),
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/location', () => ({
  LocationMapCard: () => <div data-testid="location-map" />,
}));

vi.mock('@/components/location/LocationMapCard', () => ({
  LocationMapCard: () => <div data-testid="location-map" />,
}));

vi.mock('@/components/social/CommentsSection', () => ({
  CommentsSection: () => <div data-testid="comments-section" />,
}));

vi.mock('@/components/social/LikersModal', () => ({
  LikersModal: () => <div data-testid="likers-modal" />,
}));

vi.mock('@/components/social/ShareButton', () => ({
  ShareButton: () => <button>Share</button>,
}));

vi.mock('@/components/listings/ListingAnalyticsPanel', () => ({
  ListingAnalyticsPanel: () => <div data-testid="analytics-panel" />,
}));

vi.mock('@/components/listings/FeaturedBadge', () => ({
  FeaturedBadge: () => <span data-testid="featured-badge">Featured</span>,
}));

vi.mock('@/components/verification/VerificationBadge', () => ({
  VerificationBadgeRow: () => <span data-testid="verification-badge" />,
}));

vi.mock('@/components/i18n/TranslateButton', () => ({
  TranslateButton: () => <button type="button">Translate</button>,
}));

import { ListingDetailPage } from './ListingDetailPage';
import { useSocialInteractions } from '@/hooks/useSocialInteractions';

const mockUseSocialInteractions = vi.mocked(useSocialInteractions);

const createSocialMock = (overrides: Partial<ReturnType<typeof useSocialInteractions>> = {}) => ({
  isLiked: false,
  likesCount: 0,
  commentsCount: 0,
  isLiking: false,
  comments: [],
  commentsLoading: false,
  commentsLoaded: false,
  toggleLike: vi.fn(),
  loadComments: vi.fn(),
  submitComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  availableReactions: ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate'] as const,
  toggleReaction: vi.fn(),
  searchMentions: vi.fn(),
  shareToFeed: vi.fn(),
  loadLikers: vi.fn(),
  ...overrides,
});

const mockListing = {
  id: 1,
  title: 'Web Design Help',
  description: 'I can help you design your website',
  type: 'offer',
  status: 'active',
  user_id: 5,
  category_id: 1,
  category_name: 'Technology',
  hours_estimate: 2,
  location: 'Dublin, Ireland',
  latitude: 53.3498,
  longitude: -6.2603,
  created_at: '2026-01-01T10:00:00Z',
  is_favorited: false,
  image_url: null,
  user: { id: 5, name: 'Bob Smith', avatar: null, tagline: 'Web developer' },
};

describe('ListingDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/test/listings/1');
    mockUseSocialInteractions.mockReturnValue(createSocialMock());
    api.get.mockImplementation((url: string) => {
      if (url.includes('/config')) return Promise.resolve({ success: true, data: { exchange_workflow_enabled: true } });
      if (url.includes('/check')) return Promise.resolve({ success: true, data: null });
      return Promise.resolve({ success: true, data: mockListing });
    });
  });

  it('shows loading screen initially', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    render(<ListingDetailPage />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('renders listing title after load', async () => {
    render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Web Design Help').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders listing description', async () => {
    render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('I can help you design your website')).toBeInTheDocument();
    });
  });


  // F-568 (E-093): the description box is a plain text box, so markup in it is shown as words.
  it('shows markup in the description as words, never as a link or heading', async () => {
    const injected = { ...mockListing, description: '<h1>Your session has expired</h1><a href="https://google.com">Click here to re-authenticate</a>' };
    api.get.mockImplementation((url: string) => {
      if (url.includes('/config')) return Promise.resolve({ success: true, data: { exchange_workflow_enabled: true } });
      if (url.includes('/check')) return Promise.resolve({ success: true, data: null });
      return Promise.resolve({ success: true, data: injected });
    });
    const { container } = render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/Click here to re-authenticate/)).toBeInTheDocument();
    });
    expect(container.querySelector('a[href="https://google.com"]')).toBeNull();
    expect(container.querySelector('h1')?.textContent).not.toContain('Your session has expired');
  });

  it('renders owner info card when user data is present', async () => {
    render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    });
  });

  it('shows empty state on API error', async () => {
    api.get.mockRejectedValue(new Error('Network error'));
    render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('shows image placeholder when no image_url', async () => {
    render(<ListingDetailPage />);
    // Wait for the listing to load.
    await waitFor(() => {
      expect(screen.getAllByText('Web Design Help').length).toBeGreaterThanOrEqual(1);
    });
    // With image_url null, the page renders the ImagePlaceholder branch instead
    // of the listing <img> (alt "Image for <title>"). The generic ImagePlaceholder
    // stub has no test id, so assert the listing image is absent — proving the
    // placeholder branch was taken rather than the real image.
    expect(screen.queryByAltText(/Image for Web Design Help/i)).not.toBeInTheDocument();
  });

  it('renders location text when provided', async () => {
    render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Dublin, Ireland')).toBeInTheDocument();
    });
  });

  it('renders offer badge for offer type listing', async () => {
    render(<ListingDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Offering')).toBeInTheDocument();
    });
  });

  it('opens and loads the shared comments panel for comment notification links', async () => {
    const loadComments = vi.fn().mockResolvedValue(undefined);
    mockUseSocialInteractions.mockReturnValue(createSocialMock({
      commentsCount: 1,
      loadComments,
    }));
    window.history.replaceState(null, '', '/test/listings/1#comment-123');

    render(<ListingDetailPage />);

    await waitFor(() => {
      expect(screen.getByTestId('comments-section')).toBeInTheDocument();
    });
    expect(loadComments).toHaveBeenCalledTimes(1);
  });

  it('rolls back the optimistic save and shows an error — not a false success — when the save request fails', async () => {
    // Regression: api.post resolves to { success:false } on a 4xx WITHOUT throwing
    // (and 4xx never fires the global 5xx-only error toast), so the old handler —
    // which only checked for a thrown error in catch and toasted success
    // unconditionally — left the heart optimistically "Saved" AND showed a false
    // "Listing saved" toast despite the failed request. Live-verified with a forced
    // 400: heart now reverts to "Save" and an error toast appears.
    const successToast = vi.fn();
    const errorToast = vi.fn();
    vi.mocked(useToast).mockReturnValue({ success: successToast, error: errorToast, info: vi.fn() });
    api.post.mockResolvedValue({ success: false, error: 'Could not save listing' });

    render(<ListingDetailPage />);
    const saveButton = await screen.findByRole('button', { name: /save listing/i });

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith('Failed to update saved listing', 'Could not save listing');
    });
    // No false success toast, and the optimistic toggle is rolled back (still "Save").
    expect(successToast).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /save listing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove saved/i })).not.toBeInTheDocument();
  });

  it('offers a Try Again retry on a transient load failure instead of a permanent not-found', async () => {
    // Regression: api.get returns { success:false } (it does NOT throw) for
    // network/timeout/5xx, so the old loadListing set the SAME not_found_error for a
    // transient blip as for a real 404 and showed only a Browse link — telling the
    // user the listing was removed with no way to retry.
    api.get.mockImplementation((url: string) => {
      if (url.includes('/config')) return Promise.resolve({ success: true, data: { exchange_workflow_enabled: true } });
      if (url.includes('/check')) return Promise.resolve({ success: true, data: null });
      return Promise.resolve({ success: false, error: 'Unable to connect', code: 'NETWORK_ERROR' });
    });

    render(<ListingDetailPage />);

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(retry).toBeInTheDocument();

    // Clicking Try Again re-attempts the listing load.
    const detailCalls = () => api.get.mock.calls.filter((c) => /\/v2\/listings\/\d+$/.test(String(c[0]))).length;
    const before = detailCalls();
    fireEvent.click(retry);
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(before));
  });

  it('shows the not-found state with no retry for a genuinely missing listing (404)', async () => {
    api.get.mockImplementation((url: string) => {
      if (url.includes('/config')) return Promise.resolve({ success: true, data: { exchange_workflow_enabled: true } });
      if (url.includes('/check')) return Promise.resolve({ success: true, data: null });
      return Promise.resolve({ success: false, error: 'Not found', code: 'HTTP_404' });
    });

    render(<ListingDetailPage />);

    await screen.findByTestId('empty-state');
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  describe('owner delete/renew failure handling (regression)', () => {
    // Regression: api.delete/api.post resolve { success: false } on a 4xx
    // (403/404/429/…) WITHOUT throwing, and the global error toast only fires
    // on 5xx, so the catch blocks never ran for a rejected request. Before the
    // fix, handleDelete discarded the api.delete result — showing the success
    // toast and navigating away while the listing still existed — and
    // handleRenew simply did nothing on failure (spinner stopped, no feedback).
    let successToast: Mock<(title: string, message?: string) => void>;
    let errorToast: Mock<(title: string, message?: string) => void>;

    // Owner view (user 5 owns mockListing) with an expiring listing so the
    // owner action bar renders the Delete and Extend buttons.
    const ownedListing = { ...mockListing, expires_at: '2027-01-01T00:00:00Z' };

    beforeEach(() => {
      vi.mocked(useAuth).mockReturnValue({
        user: { id: 5, first_name: 'Bob', name: 'Bob Smith' },
        isAuthenticated: true,
      });
      successToast = vi.fn<(title: string, message?: string) => void>();
      errorToast = vi.fn<(title: string, message?: string) => void>();
      vi.mocked(useToast).mockReturnValue({ success: successToast, error: errorToast, info: vi.fn() });
      api.get.mockImplementation((url: string) => {
        if (url.includes('/config')) return Promise.resolve({ success: true, data: { exchange_workflow_enabled: true } });
        if (url.includes('/check')) return Promise.resolve({ success: true, data: null });
        return Promise.resolve({ success: true, data: ownedListing });
      });
    });

    async function openDeleteConfirm() {
      render(<ListingDetailPage />);
      const deleteButton = await screen.findByRole('button', { name: 'Delete' });
      fireEvent.click(deleteButton);
      return await screen.findByRole('button', { name: 'Delete listing' });
    }

    it('shows the delete error toast and does NOT navigate when the delete fails', async () => {
      api.delete.mockResolvedValue({ success: false, error: 'You do not have permission to delete this listing', code: 'HTTP_403' });

      const confirmButton = await openDeleteConfirm();
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(api.delete).toHaveBeenCalledWith('/v2/listings/1');
      });
      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith('Failed to delete', 'You do not have permission to delete this listing');
      });
      expect(successToast).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('falls back to the retry subtitle when the failed delete has no error detail', async () => {
      api.delete.mockResolvedValue({ success: false });

      const confirmButton = await openDeleteConfirm();
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith('Failed to delete', 'Please try again later');
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('still shows the success toast and navigates when the delete succeeds', async () => {
      api.delete.mockResolvedValue({ success: true });

      const confirmButton = await openDeleteConfirm();
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(successToast).toHaveBeenCalledWith('Listing deleted');
      });
      expect(mockNavigate).toHaveBeenCalledWith('/test/listings', { replace: true });
      expect(errorToast).not.toHaveBeenCalled();
    });

    it('shows the renew error toast (with the API detail) when the renew fails', async () => {
      api.post.mockResolvedValue({ success: false, error: 'Renewal limit reached', code: 'HTTP_429' });

      render(<ListingDetailPage />);
      const renewButton = await screen.findByRole('button', { name: 'Extend' });
      fireEvent.click(renewButton);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/v2/listings/1/renew', {});
      });
      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith('Failed to renew listing', 'Renewal limit reached');
      });
      expect(successToast).not.toHaveBeenCalled();
    });

    it('falls back to the retry subtitle when the failed renew has no error detail', async () => {
      api.post.mockResolvedValue({ success: false });

      render(<ListingDetailPage />);
      const renewButton = await screen.findByRole('button', { name: 'Extend' });
      fireEvent.click(renewButton);

      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith('Failed to renew listing', 'Please try again later');
      });
      expect(successToast).not.toHaveBeenCalled();
    });
  });
});
