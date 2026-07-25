// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ResourcesPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [], meta: {} }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  API_BASE: '/api',
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

// PageMeta imports useTenant from the DIRECT module path, not the '@/contexts'
// barrel, so the barrel mock below does not reach it and the real provider throws
// in jsdom. Mock the module too. (This is why the file was red before this change.)
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test', tagline: null },
    branding: { name: 'Test', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    isLoading: false,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
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
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// src/test/setup.ts stubs matchMedia to matches:false for EVERY query, so without
// this the phone branch would get zero coverage while the desktop assertions kept
// passing. Query-aware so a future min-width consumer in the subtree cannot end up
// in an impossible viewport (today the page and Drawer both ask max-width only).
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) =>
    query.includes('min-width') ? !isPhoneViewport : isPhoneViewport,
  ),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));
vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,    },    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,  };});

import { ResourcesPage } from './ResourcesPage';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts';

const CATEGORY_TREE = [
  {
    id: 7,
    name: 'Guides',
    slug: 'guides',
    color: 'blue',
    resource_count: 3,
    children: [
      { id: 8, name: 'Templates', slug: 'guides-templates', color: 'blue', resource_count: 1, children: [] },
    ],
  },
  {
    id: 9,
    name: 'Policies',
    slug: 'policies',
    color: 'gray',
    resource_count: 2,
    children: [
      { id: 10, name: 'Templates', slug: 'policies-templates', color: 'gray', resource_count: 1, children: [] },
    ],
  },
];

/** Answer the tree endpoint with real nodes; everything else stays empty. */
function mockCategoryTree() {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.includes('/categories/tree')) {
      return Promise.resolve({ success: true, data: CATEGORY_TREE, meta: {} });
    }
    return Promise.resolve({ success: true, data: [], meta: {} });
  });
}

describe('ResourcesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [], meta: {} });
    // Re-seed so one test's admin override cannot leak into the next.
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, first_name: 'Test' },
      isAuthenticated: true,
    });
  });

  it('renders without crashing', () => {
    render(<ResourcesPage />);
    expect(screen.getByText('Resources')).toBeInTheDocument();
  });

  it('shows search input', () => {
    render(<ResourcesPage />);
    expect(screen.getByPlaceholderText(/Search resources/i)).toBeInTheDocument();
  });

  it('shows Upload button for authenticated users', () => {
    render(<ResourcesPage />);
    expect(screen.getByRole('button', { name: /Upload/i })).toBeInTheDocument();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('renders the sticky bar with the search pill, Filters button and re-homed Upload action', () => {
      render(<ResourcesPage />);
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      // Search lives behind the pill, so the placeholder is TEXT, not an attribute.
      expect(screen.getByText('Search resources...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Upload Resource' })).toBeInTheDocument();
    });

    it('does not render the desktop hero or the desktop search field', () => {
      render(<ResourcesPage />);
      // The hero <h1> is the only place the bare title is painted.
      expect(screen.queryByRole('heading', { level: 1, name: 'Resources' })).not.toBeInTheDocument();
      expect(screen.queryByText('Community knowledge library')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/Search resources/i)).not.toBeInTheDocument();
    });

    it('does not render the desktop category tree sidebar', async () => {
      mockCategoryTree();
      render(<ResourcesPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/v2/resources/categories/tree');
      });
      // "All Resources" and the collapse control belong to the sidebar only.
      expect(screen.queryByText('All Resources')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Hide categories')).not.toBeInTheDocument();
    });

    it('opens the filter sheet with the flattened category chips', async () => {
      mockCategoryTree();
      render(<ResourcesPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/v2/resources/categories/tree');
      });

      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'Filter by category' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Guides' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Policies' })).toBeInTheDocument();
      // Two different parents each own a "Templates" — both get parent-prefixed.
      expect(screen.getByRole('radio', { name: 'Guides › Templates' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Policies › Templates' })).toBeInTheDocument();
      // No total in this endpoint's meta, so the footer must stay unknown-count.
      expect(screen.getByText('Show results')).toBeInTheDocument();
    });

    it('applies draft category changes only when the footer is pressed', async () => {
      mockCategoryTree();
      render(<ResourcesPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/resources\?/));
      });
      vi.mocked(api.get).mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Guides' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('radio', { name: 'Guides' }));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Guides' })).toHaveAttribute('aria-checked', 'true');
      });
      // Draft-only: no count probe exists on this page, so NOTHING refetches.
      expect(api.get).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('Show results'));
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining('category_id=7'));
      });
    });

    it('surfaces the applied category as a removable chip that clears the filter', async () => {
      mockCategoryTree();
      render(<ResourcesPage />);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/v2\/resources\?/));
      });

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Guides' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('radio', { name: 'Guides' }));
      fireEvent.click(screen.getByText('Show results'));

      const chip = await screen.findByLabelText('Remove filter: Guides');
      expect(chip).toBeInTheDocument();

      vi.mocked(api.get).mockClear();
      fireEvent.click(chip);
      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(expect.not.stringContaining('category_id'));
      });
    });

    it('re-homes the admin reorder mode, and shows it to admins only', () => {
      render(<ResourcesPage />);
      // Non-admin: the hidden desktop control row cost them nothing.
      expect(screen.queryByText('Reorder')).not.toBeInTheDocument();

      vi.mocked(useAuth).mockReturnValue({
        user: { id: 1, first_name: 'Test', role: 'tenant_admin' },
        isAuthenticated: true,
      });
      render(<ResourcesPage />);
      expect(screen.getByText('Reorder')).toBeInTheDocument();
    });
  });
});
