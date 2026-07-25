// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ListingsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// The page (and its children) import contexts via direct paths, not the barrel —
// mock those modules too or the real providers throw in jsdom.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  })),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/contexts/ToastContext', () => ({
  // test-utils wraps renders in the real ToastProvider import — keep the name.
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: vi.fn((...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));

let mapsEnabled = false;
vi.mock('@/lib/map-config', () => ({
  get MAPS_ENABLED() { return mapsEnabled; },
}));

// Toggle phone layout (useMediaQuery drives the sticky bar + filter sheet).
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => isPhoneViewport),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/location', () => ({
  EntityMapView: () => <div data-testid="map-view">Map</div>,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { ListingsPage } from './ListingsPage';
import { api } from '@/lib/api';

describe('ListingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mapsEnabled = false;
    isPhoneViewport = false;
  });

  it('renders without crashing', () => {
    render(<ListingsPage />);
    expect(screen.getByText('Listings')).toBeInTheDocument();
  });

  it('shows the page heading and description', () => {
    render(<ListingsPage />);
    expect(screen.getByText('Listings')).toBeInTheDocument();
    expect(screen.getByText('Browse services and requests from the community')).toBeInTheDocument();
  });

  it('shows New Listing button when authenticated', () => {
    render(<ListingsPage />);
    expect(screen.getByText('Create Listing')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<ListingsPage />);
    expect(screen.getByPlaceholderText(/Search by title/i)).toBeInTheDocument();
  });

  it('shows view mode buttons (grid and list)', () => {
    render(<ListingsPage />);
    expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
    expect(screen.getByLabelText('List view')).toBeInTheDocument();
  });

  it('requests only coordinate-backed listings in map view', async () => {
    mapsEnabled = true;
    render(<ListingsPage />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/listings\?/));
    });

    fireEvent.click(screen.getByLabelText('Map view'));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('with_coordinates=1'));
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('per_page=100'));
    });
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky bar with search pill, Filters button and view toggle', () => {
      render(<ListingsPage />);
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search listings')).toBeInTheDocument();
      expect(screen.getByLabelText('Grid view')).toBeInTheDocument();
      expect(screen.getByLabelText('List view')).toBeInTheDocument();
    });

    it('opens the filter sheet with every filter section', async () => {
      render(<ListingsPage />);
      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByText('Duration')).toBeInTheDocument();
      });
      expect(screen.getByText('Service mode')).toBeInTheDocument();
      expect(screen.getByText('Posted date')).toBeInTheDocument();
      expect(screen.getByText('Distance')).toBeInTheDocument();
      expect(screen.getByText('Sort')).toBeInTheDocument();
      expect(screen.getByText('Under 1h')).toBeInTheDocument();
      expect(screen.getByText('Show listings')).toBeInTheDocument();
    });

    it('applies draft filters only when Show listings is pressed', async () => {
      render(<ListingsPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/listings\?/));
      });
      vi.mocked(api.get).mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByText('Offers')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Offers'));
      // Draft change fetches a live count (per_page=1) but must not refetch the grid.
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('per_page=1'));
      });
      expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('per_page=20'));

      fireEvent.click(screen.getByText('Show listings'));
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/type=offer.*per_page=20/));
      });
    });
  });
});
