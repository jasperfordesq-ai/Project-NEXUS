// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ProfilePage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

const { mockApiGet, mockUseFeature, routeState, AUTH_STATE } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockUseFeature: vi.fn(() => true),
  // Mutable route id so a test can simulate navigating from one profile to another
  // (the stale-data regression needs the :id param to change mid-component-life).
  routeState: { id: '42' },
  // 🔴 Stable object identities, created ONCE — the real AuthProvider memoises its
  // context value (AuthContext.tsx:835), so `useAuth().user` keeps the same identity
  // across renders. A factory returning a fresh literal per call is unfaithful and
  // breaks any consumer that compares `currentUser` by reference: rendering the
  // profile mounts <VereinCrossInvitationButton>, which adjusts state during render
  // when `prevEligibilityKey.currentUser !== currentUser`
  // (VereinCrossInvitationButton.tsx:57-67) — with a new object every render that
  // condition never settles and React aborts with "Too many re-renders".
  AUTH_STATE: {
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  },
}));

function installDefaultApiMocks() {
  mockApiGet.mockImplementation((url: string) => {
    if (url.includes('/verification-badges')) {
      return Promise.resolve({ success: true, data: [] });
    }

    if (url.includes('/v2/gamification/profile')) {
      return Promise.resolve({
        success: true,
        data: {
          xp: 120,
          level: 2,
          badges_count: 1,
        },
      });
    }

    if (url.includes('/v2/gamification/badges')) {
      return Promise.resolve({
        success: true,
        data: [
          {
            badge_key: 'first_exchange',
            name: 'First Exchange',
            description: 'Completed first exchange',
            icon: 'trophy',
            earned_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
    }

    if (url.includes('/v2/users/')) {
      return Promise.resolve({
        success: true,
        data: {
          id: 42,
          first_name: 'John',
          last_name: 'Doe',
          name: 'John Doe',
          bio: 'Test bio',
          location: 'Dublin',
          avatar_url: null,
          joined_at: '2025-01-01',
          hours_given: 10,
          hours_received: 5,
          listings_count: 3,
        },
      });
    }

    return Promise.resolve({ success: true, data: [] });
  });
}

vi.mock('@/lib/api', () => ({
  api: {
    get: mockApiGet,
    post: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: routeState.id })),
  };
});

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => AUTH_STATE),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useFeature: mockUseFeature,
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
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url) => url || ''),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));
// No '@/components/ui' barrel mock: ProfilePage imports every primitive it renders
// by direct path (Avatar, Button, Chip, Dropdown, GlassCard, Modal, Skeleton, Tabs,
// Tooltip, SafeHtml — ProfilePage.tsx:6-14), and Vitest keys mocks per specifier, so
// the barrel override never reached the page. The real components render here.
// (The dead barrel stub was also the source of a "Too many re-renders" loop: its
// generic proxy stub stood in for `useConfirm`, and calling a component stub as a
// hook set state on every render.)

// <StoryHighlights> — rendered inside the profile view — pulls `useConfirm` through
// the '@/components/ui' barrel, which re-exports it from './ConfirmDialog'
// (index.ts:228). The real hook needs a <ConfirmDialogProvider> plus a portal
// round-trip, neither of which test-utils provides, so it threw "useConfirm must be
// used within <ConfirmDialogProvider>" and killed the whole profile render. Stub just
// the hook on its own module and leave every other export of that module real.
const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/ConfirmDialog')>();
  return { ...actual, useConfirm: () => mockConfirm };
});

vi.mock('@/components/feedback', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>,
  EmptyState: ({ title, action }: { title: string; action?: unknown }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {action}
    </div>
  ),
}));
// DIRECT path: ProfilePage.tsx:46 imports LocationMapCard from
// '@/components/location/LocationMapCard', so a '@/components/location' barrel
// override was dead. Stubbed rather than rendered for real because the map card
// pulls Google Maps / tenant map config this test has no business owning.
vi.mock('@/components/location/LocationMapCard', () => ({
  LocationMapCard: () => <div data-testid="location-map">Map</div>,
}));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('dompurify', () => ({
  default: { addHook: vi.fn(), sanitize: (html: string) => html },
}));
vi.mock('@/lib/motion', () => {
  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
  const filterMotion = (props: Record<string, unknown>) => {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!motionProps.has(key)) filtered[key] = value;
    }
    return filtered;
  };

  return {
    motion: {
      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,
    },
    AnimatePresence: ({ children }: { children: unknown }) => <>{children}</>,
  };
});

import { ProfilePage } from './ProfilePage';

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = '42';
    mockUseFeature.mockReturnValue(true);
    installDefaultApiMocks();
  });

  it('renders without crashing', () => {
    render(<ProfilePage />);
    // Was `expect(document.body).toBeTruthy()`, which could not fail. isLoading
    // starts true, so the (stubbed) LoadingScreen is what the first paint must show.
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('loads profile data from API', async () => {
    const { api } = await import('@/lib/api');
    render(<ProfilePage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/v2/users/42'));
    });
  });

  it('shows profile name after loading', async () => {
    render(<ProfilePage />);

    // The name appears in more than one place (heading + avatar/meta), so
    // assert at least one rendering of the loaded profile name.
    await waitFor(() => {
      expect(screen.getAllByText('John Doe').length).toBeGreaterThan(0);
    });
  });

  it('uses Explore as the fallback destination when connections are disabled', async () => {
    mockUseFeature.mockImplementation((feature: string) => feature !== 'connections');
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/users/')) {
        return Promise.resolve({ success: false, code: 'NOT_FOUND' });
      }

      return Promise.resolve({ success: true, data: [] });
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('Back to Explore')).toBeInTheDocument();
    });

    // The real `Button as={Link}` renders a router <a>, so the fallback CTA is
    // role="link" (only the dead uiMock stub produced a <button> with an href).
    expect(screen.getByRole('link', { name: /Back to Explore/i })).toHaveAttribute('href', '/test/explore');
    // …and the members fallback is NOT offered, since `connections` is disabled.
    expect(screen.queryByText('Browse Members')).not.toBeInTheDocument();
  });

  it('clears the previously-loaded profile when a reload (id change) fails — no stale data', async () => {
    // Regression: loadProfile set `error`/`errorCode` on a failed (re)load but never
    // cleared the already-loaded `profile`, so the `error && !profile` render guard
    // stayed false and the PRIOR profile rendered under the new URL. Live-verified on
    // the running app (sibling of the same fix in EventDetailPage): navigating from a
    // loaded profile to a 404ing id now shows the error screen, not the stale profile.
    const { rerender } = render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getAllByText('John Doe').length).toBeGreaterThanOrEqual(1);
    });

    // Navigate to a different profile whose fetch fails.
    routeState.id = '99';
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/v2/users/')) {
        return Promise.resolve({ success: false, code: 'NOT_FOUND' });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    rerender(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Profile')).toBeInTheDocument();
    });
    // The stale profile-1 name must be gone (pre-fix it remained on screen).
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
  });
});
