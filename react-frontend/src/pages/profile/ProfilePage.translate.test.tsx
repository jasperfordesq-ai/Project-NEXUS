// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 31 Oct 2026: a member's tagline is translated with their bio, on the
 * same Translate press. Mocks copied from ProfilePage.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import type { ReactNode } from 'react';

const { mockApiGet, mockUseFeature, mockHasModule, routeState, AUTH_STATE } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockHasModule: vi.fn((_module: string) => true),
  mockUseFeature: vi.fn((_feature: string) => true),
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
    hasModule: mockHasModule,
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
  EmptyState: ({ title, action }: { title: string; action?: ReactNode }) => (
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
      div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => <div {...filterMotion(props)}>{children}</div>,
    },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { ProfilePage } from './ProfilePage';
import { api } from '@/lib/api';

const translations: Record<string, string> = {
  profile_bio: 'I love gardening',
  profile_bio_tagline: 'Gardener and baker',
};

describe('ProfilePage — Translate the bio and tagline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = '42';
    mockUseFeature.mockReturnValue(true);
    mockHasModule.mockReturnValue(true);
    installDefaultApiMocks();
    const base = mockApiGet.getMockImplementation()!;
    mockApiGet.mockImplementation((url: string) => (url.includes('/v2/users/') && !url.includes('block-status')
      ? base(url).then((res: { data: Record<string, unknown> }) => ({
        ...res,
        data: { ...res.data, bio: 'Me encanta la jardinería', tagline: 'Jardinera y panadera' },
      }))
      : base(url)));
    vi.mocked(api.post).mockImplementation((url: string, body?: unknown) => {
      if (url !== '/v2/ugc-translate') return Promise.resolve({ success: true });
      return Promise.resolve({
        success: true,
        data: {
          translated_text: translations[(body as { content_type: string }).content_type],
          source_locale: 'es', target_locale: 'en', cached: false,
        },
      });
    });
  });

  it('translates the tagline with the bio and restores both originals', async () => {
    render(<ProfilePage />);
    await screen.findByText('Me encanta la jardinería');
    expect(screen.getByText('Jardinera y panadera')).toBeInTheDocument();
    // One button only: the tagline rides on the bio's button.
    expect(screen.getAllByRole('button', { name: /^translate/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^translate/i }));

    expect(await screen.findByText('I love gardening')).toBeInTheDocument();
    expect(screen.getByText('Gardener and baker')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'profile_bio', content_id: 42, source_text: 'Me encanta la jardinería',
    }));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'profile_bio_tagline', content_id: 42, source_text: 'Jardinera y panadera',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    expect(await screen.findByText('Me encanta la jardinería')).toBeInTheDocument();
    expect(screen.getByText('Jardinera y panadera')).toBeInTheDocument();
  });
});
