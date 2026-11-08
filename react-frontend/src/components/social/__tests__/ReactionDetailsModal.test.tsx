// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ReactionDetailsModal — the "who reacted" dialog opened from a
 * feed card's reaction summary.
 *
 * Regression (8 Nov 2026, hour-timebank feed): a post with 3 👍 and 1 ❤️ showed
 * "Reactions (4)" but only 3 names under "All" (the list came from the
 * summary's three-name preview, with every time faked as "now"), and both
 * emoji tabs said "No reactions yet" (the tab key reached the API as
 * "1:$like"). The modal must list every reactor from the paginated reactors
 * endpoint, for "All" and for each reaction type.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockTenant = {
  tenant: { id: 2, name: 'Test', slug: 'test' },
  tenantSlug: 'test',
  branding: { name: 'Test' },
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  tenantPath: (p: string) => `/test${p}`,
};

const labels: Record<string, string> = {
  'reaction.like': 'Like',
  'reaction.love': 'Love',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => labels[key] ?? fallback ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true })),
  useTenant: vi.fn(() => mockTenant),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

const mockApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
  tokenManager: {
    hasAccessToken: vi.fn(() => true),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null | undefined) => url || '/default-avatar.png',
  formatRelativeTime: (dateString: string | null | undefined) => `at ${dateString ?? ''}`,
}));

import { ReactionDetailsModal } from '../ReactionDetailsModal';

const reactor = (id: number, name: string, reactionType: string, reactedAt: string) => ({
  id,
  name,
  avatar_url: null,
  reacted_at: reactedAt,
  reaction_type: reactionType,
});

const everyone = [
  reactor(1, 'Sridevi', 'like', '2026-11-08 10:04:00'),
  reactor(2, 'Andy', 'like', '2026-11-08 10:03:00'),
  reactor(3, 'Jasper', 'like', '2026-11-08 10:02:00'),
  reactor(4, 'Dana', 'love', '2026-11-08 10:01:00'),
];

function respondByType(url: string) {
  const type = /\/users\/([^?]+)/.exec(url)?.[1];
  const users = type === 'all' ? everyone : everyone.filter((u) => u.reaction_type === type);
  return Promise.resolve({
    success: true,
    data: users,
    meta: { total: users.length, has_more: false },
  });
}

async function renderModal() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/test/feed']}>
        <ReactionDetailsModal
          isOpen
          onClose={vi.fn()}
          sortedTypes={[['like', 3], ['love', 1]]}
          total={4}
          entityType="post"
          entityId={42}
        />
      </MemoryRouter>,
    );
  });
}

describe('ReactionDetailsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation(respondByType);
  });

  it('lists every reactor under "All" from the paginated reactors endpoint', async () => {
    await renderModal();

    await waitFor(() => {
      expect(screen.getByText('Dana')).toBeInTheDocument();
    });
    for (const name of ['Sridevi', 'Andy', 'Jasper', 'Dana']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(mockApiGet).toHaveBeenCalledWith('/v2/reactions/post/42/users/all?page=1&per_page=20');
    // The real reaction time, not a placeholder "now".
    expect(screen.getByText('at 2026-11-08 10:01:00')).toBeInTheDocument();
  });

  it('shows which reaction each person gave under "All"', async () => {
    await renderModal();

    const danaLink = await screen.findByRole('link', { name: /Dana/ });
    expect(danaLink.querySelector('[role="img"][aria-label="Love"]')).not.toBeNull();
    const andyLink = screen.getByRole('link', { name: /Andy/ });
    expect(andyLink.querySelector('[role="img"][aria-label="Like"]')).not.toBeNull();
  });

  it('lists the people behind an emoji tab when it is selected', async () => {
    await renderModal();
    await screen.findByText('Dana');

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /Like/ }));
    });

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenLastCalledWith('/v2/reactions/post/42/users/like?page=1&per_page=20');
    });
    await waitFor(() => {
      expect(screen.queryByText('Dana')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Sridevi')).toBeInTheDocument();
    expect(screen.getByText('Andy')).toBeInTheDocument();
    expect(screen.getByText('Jasper')).toBeInTheDocument();
    expect(screen.queryByText('No reactions yet')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /Love/ }));
    });

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenLastCalledWith('/v2/reactions/post/42/users/love?page=1&per_page=20');
    });
    expect(await screen.findByText('Dana')).toBeInTheDocument();
    expect(screen.queryByText('Sridevi')).not.toBeInTheDocument();
  });
});
