// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for StoriesBar component
 *
 * StoriesBar now fetches stories from the API (not from a friends prop).
 * It shows a "Your Story" create button and story circles for other users.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

const mockApiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
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
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'TestUser', last_name: 'Smith', avatar: '/test-avatar.png' },
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle',
    error: null,
  })),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: unknown) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url: unknown) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));

vi.mock('@/components/stories/StoryViewer', () => ({
  StoryViewer: () => <div data-testid="story-viewer" />,
}));

vi.mock('@/components/stories/StoryCreator', () => ({
  StoryCreator: () => <div data-testid="story-creator" />,
}));

import { StoriesBar } from './StoriesBar';
import { useAuth } from '@/contexts';

const mockStoryUsers = [
  {
    user_id: 10,
    name: 'Alice Smith',
    first_name: 'Alice',
    avatar_url: '/alice.png',
    story_count: 2,
    has_unseen: true,
    is_own: false,
    is_connected: true,
    latest_at: '2026-03-23T10:00:00Z',
  },
  {
    user_id: 20,
    name: 'Bob Jones',
    first_name: 'Bob',
    avatar_url: '/bob.png',
    story_count: 1,
    has_unseen: false,
    is_own: false,
    is_connected: true,
    latest_at: '2026-03-23T09:00:00Z',
  },
];

const authenticatedAuthReturn = {
  user: { id: 1, first_name: 'TestUser', last_name: 'Smith', avatar: '/test-avatar.png' },
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  updateUser: vi.fn(),
  refreshUser: vi.fn(),
  status: 'idle' as const,
  error: null,
};

describe('StoriesBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    // Restore authenticated state for each test (clearAllMocks doesn't reset implementations)
    vi.mocked(useAuth).mockReturnValue(authenticatedAuthReturn as ReturnType<typeof useAuth>);
  });

  it('returns null when user is not authenticated', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle',
      error: null,
    } as ReturnType<typeof useAuth>);
    const { container } = render(<StoriesBar />);
    // Not authenticated => returns null, no scrollable area rendered
    expect(container.querySelector('.overflow-x-auto')).not.toBeInTheDocument();
  });

  it('shows "Your Story" create button when authenticated', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<StoriesBar />);
    await waitFor(() => {
      expect(screen.getByLabelText('Create your story')).toBeInTheDocument();
    });
  });

  it('renders story circles for story users from API', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockStoryUsers });
    render(<StoriesBar />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('renders "Your Story" label text', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<StoriesBar />);
    await waitFor(() => {
      expect(screen.getByText('Your Story')).toBeInTheDocument();
    });
  });

  it('truncates long first names (max 12 chars)', async () => {
    const longNameUser = [{
      user_id: 99,
      name: 'Alexandrovich Longname',
      first_name: 'Alexandrovich',
      avatar_url: '/alex.png',
      story_count: 1,
      has_unseen: true,
      is_own: false,
      is_connected: true,
      latest_at: '2026-03-23T10:00:00Z',
    }];
    mockApiGet.mockResolvedValue({ success: true, data: longNameUser });
    render(<StoriesBar />);
    // "Alexandrovich" is 13 chars, truncated to 12 chars + "..."
    await waitFor(() => {
      expect(screen.getByText('Alexandrovic...')).toBeInTheDocument();
    });
  });

  it('calls api.get to fetch stories', async () => {
    render(<StoriesBar />);
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/v2/stories');
    });
  });

  it('shows gradient ring for unseen stories', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockStoryUsers });
    const { container } = render(<StoriesBar />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
    // Unseen story (Alice) gets gradient ring
    const gradientRings = container.querySelectorAll('.bg-linear-to-tr');
    expect(gradientRings.length).toBeGreaterThanOrEqual(1);
  });
});
