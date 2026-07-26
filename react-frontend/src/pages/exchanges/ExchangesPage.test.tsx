// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ExchangesPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

const tenantHasFeature = vi.fn(() => true);
const tenantHasModule = vi.fn(() => true);
const tenantPath = (p: string) => `/test${p}`;

// Mock API module
// Default mock: returns exchange_workflow_enabled config and empty exchanges
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockImplementation((url: string) => {
      if (url.includes('/config')) {
        return Promise.resolve({
          success: true,
          data: { exchange_workflow_enabled: true },
          meta: {},
        });
      }
      return Promise.resolve({ success: true, data: [], meta: {} });
    }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// Mock contexts
vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath,
    hasFeature: tenantHasFeature,
    hasModule: tenantHasModule,
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,

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
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// Toggle the phone layout. src/test/setup.ts stubs window.matchMedia to return
// matches:false for EVERY query, so without this mock `isPhone` is permanently
// false and the phone branch would get zero coverage.
// Query-aware on purpose: `Drawer` also asks '(max-width: 639px)', and answering
// min-width queries with the negation keeps any future consumer from seeing an
// impossible viewport.
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) =>
    query.includes('max-width') ? isPhoneViewport : !isPhoneViewport,
  ),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/lib/exchange-status', () => ({
  EXCHANGE_STATUS_CONFIG: {
    pending_provider: { label: 'Pending Provider', color: 'warning', icon: () => null },
    pending_requester: { label: 'Pending Requester', color: 'warning', icon: () => null },
    accepted: { label: 'Accepted', color: 'success', icon: () => null },
    active: { label: 'Active', color: 'primary', icon: () => null },
    pending_confirmation: { label: 'Pending Confirmation', color: 'warning', icon: () => null },
    completed: { label: 'Completed', color: 'success', icon: () => null },
    cancelled: { label: 'Cancelled', color: 'danger', icon: () => null },
    declined: { label: 'Declined', color: 'danger', icon: () => null },
    expired: { label: 'Expired', color: 'default', icon: () => null },
    disputed: { label: 'Disputed', color: 'danger', icon: () => null },
  },
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ExchangesPage } from './ExchangesPage';
import { api } from '@/lib/api';

describe('ExchangesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantHasFeature.mockReturnValue(true);
    tenantHasModule.mockReturnValue(true);
    isPhoneViewport = false;
  });

  const mockLoadedExchanges = async (exchanges: unknown[]) => {
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/config')) {
        return Promise.resolve({
          success: true,
          data: { exchange_workflow_enabled: true },
          meta: {},
        });
      }
      return Promise.resolve({ success: true, data: exchanges, meta: { has_more: false } });
    });
  };

  it('renders page title and description', () => {
    render(<ExchangesPage />);
    expect(screen.getAllByText('My Exchanges').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Track your service exchange requests and confirmations')).toBeInTheDocument();
  });

  it('shows Browse Listings button', () => {
    render(<ExchangesPage />);
    expect(screen.getAllByText('Browse Listings').length).toBeGreaterThanOrEqual(1);
  });

  it('renders status filter tabs', () => {
    render(<ExchangesPage />);
    // Counterpart to the phone-layout assertion that this strip is gone.
    expect(screen.getByLabelText('Exchange status filter')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Needs Confirmation')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('All').length).toBeGreaterThanOrEqual(1);
  });

  it('shows loading skeletons initially', () => {
    render(<ExchangesPage />);
    // The loading region renders 4 ExchangeCardSkeleton placeholders (each a
    // role="status" element) inside the aria-busy loading container.
    // `:scope >` is load-bearing: HeroUI v3's Skeleton primitive is itself a
    // role="status" element, so each card contributes 1 + 6 nested ones.
    const loading = screen.getByLabelText('Loading exchanges...');
    const skeletons = loading.querySelectorAll(':scope > [role="status"]');
    expect(skeletons.length).toBe(4);
  });

  it('shows empty state when no exchanges are loaded', async () => {
    // Default mock already returns config with exchange_workflow_enabled: true
    // and empty exchanges array, so just render
    render(<ExchangesPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
    expect(screen.getByText('No Exchanges Found')).toBeInTheDocument();
  });

  it('displays exchanges when loaded', async () => {
    const mockExchanges = [
      {
        id: 1,
        requester_id: 1,
        provider_id: 2,
        status: 'active',
        proposed_hours: 2,
        created_at: '2026-01-15T10:00:00Z',
        listing: { title: 'Gardening Help' },
        requester: { name: 'Test User', avatar: null },
        provider: { name: 'Provider User', avatar: null },
        requester_confirmed_at: null,
        provider_confirmed_at: null,
      },
    ];

    await mockLoadedExchanges(mockExchanges);

    render(<ExchangesPage />);

    await waitFor(() => {
      expect(screen.getByText('Gardening Help')).toBeInTheDocument();
    });
    expect(screen.getByText('With Provider User')).toBeInTheDocument();
  });

  it('shows role indicator for requester', async () => {
    const mockExchanges = [
      {
        id: 1,
        requester_id: 1,
        provider_id: 2,
        status: 'active',
        proposed_hours: 1,
        created_at: '2026-01-15T10:00:00Z',
        listing: { title: 'Test Service' },
        requester: { name: 'Test User', avatar: null },
        provider: { name: 'Other User', avatar: null },
        requester_confirmed_at: null,
        provider_confirmed_at: null,
      },
    ];

    await mockLoadedExchanges(mockExchanges);

    render(<ExchangesPage />);

    await waitFor(() => {
      expect(screen.getByText('You requested')).toBeInTheDocument();
    });
  });

  it('shows hour count on exchange cards', async () => {
    const mockExchanges = [
      {
        id: 1,
        requester_id: 1,
        provider_id: 2,
        status: 'active',
        proposed_hours: 3,
        created_at: '2026-01-15T10:00:00Z',
        listing: { title: 'Cooking Lessons' },
        requester: { name: 'Test User', avatar: null },
        provider: { name: 'Chef Bob', avatar: null },
        requester_confirmed_at: null,
        provider_confirmed_at: null,
      },
    ];

    await mockLoadedExchanges(mockExchanges);

    render(<ExchangesPage />);

    await waitFor(() => {
      expect(screen.getByText('3 hours')).toBeInTheDocument();
    });
  });

  describe('phone layout', () => {
    beforeEach(async () => {
      isPhoneViewport = true;
      // Pin the API implementation: `vi.clearAllMocks()` clears calls but not
      // implementations, so an earlier test's exchange fixture would otherwise leak.
      await mockLoadedExchanges([]);
    });

    it('renders the sticky bar labelled with the active status, plus the re-homed CTA', () => {
      render(<ExchangesPage />);
      expect(screen.getByTestId('exchanges-filter-bar')).toBeInTheDocument();
      // Filters button carries the current bucket, not a generic "Filters".
      expect(
        screen.getByLabelText('Filter by exchange status: Active'),
      ).toBeInTheDocument();
      // "Browse Listings" was only reachable from the (now hidden) page header.
      expect(screen.getByLabelText('Browse Listings')).toBeInTheDocument();
    });

    it('does not render the desktop header or the tab strip', () => {
      render(<ExchangesPage />);
      expect(screen.queryByRole('heading', { name: 'My Exchanges' })).not.toBeInTheDocument();
      expect(
        screen.queryByText('Track your service exchange requests and confirmations'),
      ).not.toBeInTheDocument();
      // The GlassCard tab strip owns this aria-label; with the sheet closed
      // nothing else in the tree carries it.
      expect(screen.queryByLabelText('Exchange status filter')).not.toBeInTheDocument();
      expect(screen.queryByText('Needs Confirmation')).not.toBeInTheDocument();
    });

    it('opens the filter sheet with every status chip and no draft footer', async () => {
      render(<ExchangesPage />);
      fireEvent.click(screen.getByLabelText('Filter by exchange status: Active'));

      await waitFor(() => {
        expect(
          screen.getByRole('radiogroup', { name: 'Exchange status filter' }),
        ).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: 'Active' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: 'Needs Confirmation' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Completed' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
      // Simple archetype: immediate-apply, so there is no footer at all — and no
      // fabricated count, because /v2/exchanges meta has no total.
      expect(screen.queryByText('Show results')).not.toBeInTheDocument();
      expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
    });

    it('applies a tapped status immediately and closes the sheet', async () => {
      render(<ExchangesPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/v2/exchanges?status=active'));
      });
      vi.mocked(api.get).mockClear();

      fireEvent.click(screen.getByLabelText('Filter by exchange status: Active'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Completed' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('radio', { name: 'Completed' }));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('status=completed'));
      });
      await waitFor(() => {
        expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      });
      // Bar label follows the applied status.
      expect(
        screen.getByLabelText('Filter by exchange status: Completed'),
      ).toBeInTheDocument();
    });
  });
});
