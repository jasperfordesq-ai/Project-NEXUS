// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for OrganisationsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
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

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// PageMeta is imported via the deep path `@/components/seo/PageMeta`, which the
// global `@/components/seo` mock in src/test/setup.ts does NOT intercept. Left
// real, it calls useTenant() from @/contexts/TenantContext (bypassing this file's
// `@/contexts` mock) and throws "useTenant must be used within a TenantProvider".
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string; href?: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { OrganisationsPage } from './OrganisationsPage';
import { api } from '@/lib/api';

describe('OrganisationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading and description', () => {
    render(<OrganisationsPage />);
    // "Organisations" appears in breadcrumbs and heading, use getAllByText
    expect(screen.getAllByText('Organisations').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Discover volunteer organisations in your community')).toBeInTheDocument();
  });

  it('shows breadcrumbs', () => {
    render(<OrganisationsPage />);
    expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    expect(screen.getByText('Volunteering')).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<OrganisationsPage />);
    expect(screen.getByPlaceholderText('Search organisations...')).toBeInTheDocument();
  });

  it('shows empty state when no organisations exist', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [],
      meta: { cursor: null, has_more: false },
    });
    render(<OrganisationsPage />);
    await waitFor(() => {
      expect(screen.getByText('No organisations found')).toBeInTheDocument();
    });
  });

  it('renders organisation cards with details', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: 'Green Earth Foundation',
          description: 'Environmental conservation organisation',
          logo_url: null,
          website: 'https://greenearth.example.com',
          contact_email: 'contact@greenearth.example.com',
          location: 'Dublin, Ireland',
          opportunity_count: 5,
          total_hours: 120,
          volunteer_count: 15,
          average_rating: 4.5,
          created_at: '2026-01-01',
        },
        {
          id: 2,
          name: 'Community Care',
          description: 'Supporting local communities',
          logo_url: null,
          website: null,
          contact_email: null,
          location: 'Cork',
          opportunity_count: 0,
          total_hours: 0,
          volunteer_count: 0,
          average_rating: null,
          created_at: '2026-01-15',
        },
      ],
      meta: { cursor: null, has_more: false },
    });
    render(<OrganisationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Green Earth Foundation')).toBeInTheDocument();
    });
    expect(screen.getByText('Community Care')).toBeInTheDocument();
    expect(screen.getByText('Environmental conservation organisation')).toBeInTheDocument();
    // No logo: a tile in the organisation's own colour — the same as its page
    // (was its initials, coloured by name, so list and page did not match).
    const { colourForSeed, paletteFor } = await import('@/lib/categoryColours');
    const { coverSeed } = await import('@/lib/coverSeeds');
    expect(screen.getAllByTestId('organisation-card-tile').map((tile) => tile.getAttribute('data-colour'))).toEqual([
      colourForSeed(coverSeed.organisation(1), paletteFor(null)),
      colourForSeed(coverSeed.organisation(2), paletteFor(null)),
    ]);
  });

  it('displays stats on organisation cards (opportunities, volunteers, hours)', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: 'Active Org',
          description: 'Has lots of stats',
          logo_url: null,
          website: 'https://example.com',
          contact_email: null,
          location: 'Limerick',
          opportunity_count: 3,
          total_hours: 50,
          volunteer_count: 8,
          average_rating: 4.2,
          created_at: '2026-01-01',
        },
      ],
      meta: { cursor: null, has_more: false },
    });
    render(<OrganisationsPage />);
    await waitFor(() => {
      expect(screen.getByText(/3 opportunit/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/8 volunteers/i)).toBeInTheDocument();
    expect(screen.getByText(/50h logged/i)).toBeInTheDocument();
    expect(screen.getByText('4.2')).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<OrganisationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Unable to Load Organisations')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('shows a "currently showing" hero stat reflecting the loaded count, not a partners grand total', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          name: 'Org One',
          description: null,
          logo_url: null,
          website: null,
          contact_email: null,
          opportunity_count: 0,
          total_hours: 0,
          volunteer_count: 0,
          average_rating: null,
          created_at: '2026-01-01',
        },
        {
          id: 2,
          name: 'Org Two',
          description: null,
          logo_url: null,
          website: null,
          contact_email: null,
          opportunity_count: 0,
          total_hours: 0,
          volunteer_count: 0,
          average_rating: null,
          created_at: '2026-01-02',
        },
      ],
      // The org list endpoint (respondWithCollection) provides NO server total —
      // only cursor / per_page / has_more — so the stat must not claim a total.
      meta: { cursor: null, has_more: false },
    });
    render(<OrganisationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Org One')).toBeInTheDocument();
    });
    // Relabelled to "showing N" semantics; the misleading "Partners shown"
    // grand-total label must be gone.
    expect(screen.getByText('Currently showing')).toBeInTheDocument();
    expect(screen.queryByText('Partners shown')).not.toBeInTheDocument();
  });
});
