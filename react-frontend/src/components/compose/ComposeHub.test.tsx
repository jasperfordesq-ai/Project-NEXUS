// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for the Universal Compose Hub
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

const mockGet = vi.fn().mockResolvedValue({ success: true, data: [], meta: {} });
const mockPost = vi.fn().mockResolvedValue({ success: true, data: { id: 1 } });

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    upload: (...args: unknown[]) => mockPost(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

const mockHasFeature = vi.fn(() => true);
const mockHasModule = vi.fn(() => true);

// Stable references to prevent infinite render loops — mocks that return new objects
// each render cause useCallback/useEffect dep changes → setState → re-render → loop
const stableToastValue = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenantValue = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: (...args: unknown[]) => mockHasFeature(...args),
  hasModule: (...args: unknown[]) => mockHasModule(...args),
};

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', avatar: null },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => stableTenantValue),
  useToast: vi.fn(() => stableToastValue),

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

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAssetUrl: vi.fn((url) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));

// Stable t function and i18n — must be module-level constants so useEffect deps don't change
const stableT = (key: string, opts?: Record<string, string>) => {
  const map: Record<string, string> = {
    'compose.tab_post': 'Post',
    'compose.tab_poll': 'Poll',
    'compose.tab_listing': 'Listing',
    'compose.tab_event': 'Event',
    'compose.tab_goal': 'Goal',
    'compose.create_title': `Create ${opts?.type ?? ''}`,
    'compose.cancel': 'Cancel',
    'compose.post_button': 'Post',
    'compose.create_poll': 'Create poll',
    'compose.create_listing': 'Create Listing',
    'compose.create_event': "Create event",
    'compose.create_goal': "Create goal",
    'compose.poll_question_placeholder': 'Ask a question...',
    'whats_on_your_mind': "What's on your mind?",
    'compose.emoji_search': 'Search emoji',
    'compose.voice_input': 'Voice input',
  };
  return map[key] ?? key;
};
const stableI18n = { language: 'en', changeLanguage: vi.fn() };
const stableTranslation = { t: stableT, i18n: stableI18n };

vi.mock('react-i18next', () => ({
  useTranslation: () => stableTranslation,
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('@/components/location', () => ({
  PlaceAutocompleteInput: ({ label, ...props }: Record<string, unknown>) => (
    <input placeholder={label as string} {...props} />
  ),
}));

// Mock useMediaQuery to return false (desktop) by default
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false),
}));

import { ComposeHub } from './ComposeHub';

describe('ComposeHub', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockHasModule.mockReturnValue(true);
    mockGet.mockResolvedValue({ success: true, data: [], meta: {} });
    mockPost.mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it('renders without crashing when open', () => {
    render(<ComposeHub {...defaultProps} />);
    expect(screen.getAllByText(/Create Post/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows all 5 tab labels when all features enabled', () => {
    render(<ComposeHub {...defaultProps} />);
    for (const label of ['Post', 'Poll', 'Listing', 'Event', 'Goal']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('hides Poll tab when polls feature is disabled', () => {
    mockHasFeature.mockImplementation((f: unknown) => f !== 'polls');
    render(<ComposeHub {...defaultProps} />);
    // Poll should not appear in the tabs
    // The word "Post" may appear multiple times (tab + button), but "Poll" should be absent
    const pollElements = screen.queryAllByText('Poll');
    expect(pollElements.length).toBe(0);
    // Listing should still exist
    expect(screen.getAllByText('Listing').length).toBeGreaterThanOrEqual(1);
  });

  it('hides Listing tab when listings module is disabled', () => {
    mockHasModule.mockImplementation((m: unknown) => m !== 'listings');
    render(<ComposeHub {...defaultProps} />);
    expect(screen.queryAllByText('Listing').length).toBe(0);
  });

  it('hides Event tab when events feature is disabled', () => {
    mockHasFeature.mockImplementation((f: unknown) => f !== 'events');
    render(<ComposeHub {...defaultProps} />);
    expect(screen.queryAllByText('Event').length).toBe(0);
    // Goal should still be visible
    expect(screen.getAllByText('Goal').length).toBeGreaterThanOrEqual(1);
  });

  it('hides Goal tab when goals feature is disabled', () => {
    mockHasFeature.mockImplementation((f: unknown) => f !== 'goals');
    render(<ComposeHub {...defaultProps} />);
    expect(screen.queryAllByText('Goal').length).toBe(0);
  });

  it('defaults to Post tab header', () => {
    render(<ComposeHub {...defaultProps} />);
    expect(screen.getAllByText(/Create Post/).length).toBeGreaterThanOrEqual(1);
  });

  it('opens to specified defaultTab', () => {
    render(<ComposeHub {...defaultProps} defaultTab="goal" />);
    // "Create goal" appears in both header and submit button
    expect(screen.getAllByText(/Create Goal/).length).toBeGreaterThanOrEqual(1);
  });

  it('switches tabs when clicking a tab', async () => {
    const user = userEvent.setup();
    render(<ComposeHub {...defaultProps} />);

    expect(screen.getAllByText(/Create Post/).length).toBeGreaterThanOrEqual(1);

    // Click the Post tab
    const postTabs = screen.getAllByText('Post');
    await user.click(postTabs[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/Create Post/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not render content when isOpen is false', () => {
    render(<ComposeHub {...defaultProps} isOpen={false} />);
    expect(screen.queryByText(/Create Post/)).not.toBeInTheDocument();
  });

  it('always shows Post tab regardless of feature gates', () => {
    mockHasFeature.mockReturnValue(false);
    mockHasModule.mockReturnValue(false);
    render(<ComposeHub {...defaultProps} />);
    // Post tab should still render (no gate) — find it in tabs
    expect(screen.getAllByText('Post').length).toBeGreaterThanOrEqual(1);
    // Gated tabs should be hidden
    expect(screen.queryAllByText('Poll').length).toBe(0);
    expect(screen.queryAllByText('Listing').length).toBe(0);
    expect(screen.queryAllByText('Event').length).toBe(0);
    expect(screen.queryAllByText('Goal').length).toBe(0);
  });

  it('shows Goal tab content when selected', async () => {
    const user = userEvent.setup();
    render(<ComposeHub {...defaultProps} />);

    const goalTabs = screen.getAllByText('Goal');
    await user.click(goalTabs[0]);

    await waitFor(() => {
      // "Create goal" appears in both header and submit button
      expect(screen.getAllByText(/Create Goal/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Event tab content when selected', async () => {
    const user = userEvent.setup();
    render(<ComposeHub {...defaultProps} />);

    const eventTabs = screen.getAllByText('Event');
    await user.click(eventTabs[0]);

    await waitFor(() => {
      // "Create event" appears in both header and submit button
      expect(screen.getAllByText(/Create Event/).length).toBeGreaterThanOrEqual(1);
    });
  });
});
