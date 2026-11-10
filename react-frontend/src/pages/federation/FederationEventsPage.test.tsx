// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
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

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string | null) => url ?? '',
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import { FederationEventsPage } from './FederationEventsPage';

const mockEvent = {
  id: 100,
  title: 'Cross-Community Skill Swap',
  description: 'A joint event between Cork and Dublin timebanks.',
  start_date: '2026-08-10T10:00:00Z',
  end_date: '2026-08-10T14:00:00Z',
  location: 'Dublin Hub',
  is_online: false,
  cover_image: null,
  timebank: { id: 3, name: 'Cork Timebank' },
  attendees_count: 20,
  max_attendees: 50,
  is_attending: false,
};

const mockPartner = {
  id: 3,
  name: 'Cork Timebank',
  slug: 'cork',
  description: null,
  logo_url: null,
  member_count: 80,
  is_connected: true,
  permissions: { can_view_members: true, can_message: true, can_transact: true },
};

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/v2/federation/partners')) {
      return Promise.resolve({ success: true, data: [mockPartner] });
    }
    if (url.includes('/v2/federation/events')) {
      return Promise.resolve({
        success: true,
        data: [mockEvent], meta: { cursor: null, has_more: false },
      });
    }
    return Promise.resolve({ success: true, data: [] });
  });
}

describe('FederationEventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders event title on success', async () => {
    setupMocks();
    render(<FederationEventsPage />);
    await waitFor(() => {
      expect(screen.getByText('Cross-Community Skill Swap')).toBeInTheDocument();
    });
  });

  // Every date tile was amber; events from one partner community now share its colour.
  it('colours the date tile with the partner community\'s colour', async () => {
    setupMocks();
    render(<FederationEventsPage />);
    const tile = await screen.findByTestId('federated-event-date');
    expect(tile.className).toMatch(/bg-[a-z]+-100/);
    expect(tile.className).not.toContain('from-amber-500/20');
  });

  // Warmth plan W8 (10 Nov 2026): the test above still passed when every
  // partner's events were drawn in one fixed colour (checked by breaking the
  // code on purpose). This one pins the rule: one colour per partner
  // community, from that community, and different communities apart.
  it("gives each partner community's events that community's colour", async () => {
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    const colourOf = (id: number) => colourForSeed(coverSeed.federatedCommunity(id), paletteFor(null));
    let other = 4;
    while (colourOf(other) === colourOf(3)) other += 1;
    const events = [
      mockEvent,
      { ...mockEvent, id: 101, title: 'Repair Cafe' },
      { ...mockEvent, id: 102, title: 'Choir Night', timebank: { id: other, name: 'Galway Timebank' } },
    ];
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/partners')) return Promise.resolve({ success: true, data: [mockPartner] }) as ReturnType<typeof api.get>;
      if (url.includes('/v2/federation/events')) return Promise.resolve({ success: true, data: events, meta: { cursor: null, has_more: false } }) as ReturnType<typeof api.get>;
      return Promise.resolve({ success: true, data: [] }) as ReturnType<typeof api.get>;
    });
    render(<FederationEventsPage />);
    await screen.findByText('Choir Night');
    const tiles = screen.getAllByTestId('federated-event-date');
    expect(tiles.map((tile) => tile.getAttribute('data-colour'))).toEqual([colourOf(3), colourOf(3), colourOf(other)]);
  });

  it('shows partner community name on event card', async () => {
    setupMocks();
    render(<FederationEventsPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Cork Timebank').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/events')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<FederationEventsPage />);
    await waitFor(() => {
      expect(screen.getByText('events.unable_to_load')).toBeInTheDocument();
    });
  });

  it('shows empty state when no events exist', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/events')) {
        return Promise.resolve({
          success: true,
          data: [], meta: { cursor: null, has_more: false },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<FederationEventsPage />);
    await waitFor(() => {
      expect(screen.queryByText('Cross-Community Skill Swap')).not.toBeInTheDocument();
    });
  });

  it('shows Load More button when has_more is true', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/federation/events')) {
        return Promise.resolve({
          success: true,
          data: [mockEvent], meta: { cursor: 'cursor-next', has_more: true },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<FederationEventsPage />);
    await waitFor(() => {
      expect(screen.getByText('events.load_more')).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoints on mount', async () => {
    setupMocks();
    render(<FederationEventsPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/federation/events'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/v2/federation/partners'),
    );
  });
});
