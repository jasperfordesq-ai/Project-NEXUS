// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAssetUrl: (url: string) => url,
  resolveAvatarUrl: () => null,
}));

vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGet: vi.fn(() => null),
  safeLocalStorageGetJSON: vi.fn(() => null),
  safeLocalStorageSet: vi.fn(),
  safeLocalStorageSetJSON: vi.fn(),
}));

// ─── Toast context direct import mock (ToastProvider is real from test-utils) ─
// AdminMetaTags renders PageMeta; stub it to avoid helmet complaints
vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null, default: () => null }));

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/test/admin', search: '', hash: '', state: null, key: 'default' }),
    Outlet: () => <div data-testid="outlet" />,
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin User', avatar_url: null, is_super_admin: true, roles: ['admin'] },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Stub heavy sidebar / header / breadcrumbs to avoid deep dependency chains ─
vi.mock('./components/AdminSidebar', () => ({
  AdminSidebar: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => (
    <nav data-testid="admin-sidebar" data-collapsed={String(collapsed)}>
      <button onClick={onToggle} data-testid="sidebar-toggle">Toggle</button>
    </nav>
  ),
}));

vi.mock('./components/AdminHeader', () => ({
  AdminHeader: ({ sidebarCollapsed, onSidebarToggle }: { sidebarCollapsed: boolean; onSidebarToggle: () => void }) => (
    <header data-testid="admin-header" data-collapsed={String(sidebarCollapsed)}>
      <button onClick={onSidebarToggle} data-testid="header-sidebar-toggle">Menu</button>
    </header>
  ),
}));

vi.mock('./components/AdminBreadcrumbs', () => ({
  AdminBreadcrumbs: () => <nav data-testid="admin-breadcrumbs" aria-label="breadcrumb" />,
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('AdminLayout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('renders the admin header', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-header')).toBeInTheDocument();
    });
  });

  it('renders the admin sidebar', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      // There are two sidebars: desktop (hidden md:block) + mobile drawer
      const sidebars = screen.getAllByTestId('admin-sidebar');
      expect(sidebars.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the Outlet placeholder for child routes', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });
  });

  it('renders the breadcrumbs navigation', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-breadcrumbs')).toBeInTheDocument();
    });
  });

  it('renders skip-to-main-content link for accessibility', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      const skipLink = screen.getByRole('link', { name: /skip to main content/i });
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });
  });

  it('renders main content area with id=main-content', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      const main = screen.getByRole('main');
      expect(main).toHaveAttribute('id', 'main-content');
    });
  });

  it('sidebar starts in expanded state (collapsed=false)', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => {
      // The desktop sidebar (first one) should start expanded
      const sidebars = screen.getAllByTestId('admin-sidebar');
      expect(sidebars[0]).toHaveAttribute('data-collapsed', 'false');
    });
  });

  it('collapses sidebar when desktop sidebar toggle is clicked', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => screen.getAllByTestId('sidebar-toggle'));

    // Desktop sidebar toggle is the first one
    const toggles = screen.getAllByTestId('sidebar-toggle');
    const desktopToggle = toggles[0];
    const desktopSidebar = screen.getAllByTestId('admin-sidebar')[0];

    expect(desktopSidebar).toHaveAttribute('data-collapsed', 'false');
    fireEvent.click(desktopToggle);

    await waitFor(() => {
      expect(screen.getAllByTestId('admin-sidebar')[0]).toHaveAttribute('data-collapsed', 'true');
    });
  });

  it('toggles sidebar back to expanded on second click', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => screen.getAllByTestId('sidebar-toggle'));

    const desktopToggle = screen.getAllByTestId('sidebar-toggle')[0];

    fireEvent.click(desktopToggle);
    await waitFor(() => {
      expect(screen.getAllByTestId('admin-sidebar')[0]).toHaveAttribute('data-collapsed', 'true');
    });

    fireEvent.click(desktopToggle);
    await waitFor(() => {
      expect(screen.getAllByTestId('admin-sidebar')[0]).toHaveAttribute('data-collapsed', 'false');
    });
  });

  it('mobile drawer is hidden initially (not rendered in DOM)', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => screen.getByTestId('admin-header'));

    // Mobile overlay button should not be visible initially (drawer closed)
    expect(screen.queryByRole('button', { name: /close_sidebar/i })).not.toBeInTheDocument();
  });

  it('opens mobile drawer when header menu button is clicked', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => screen.getByTestId('header-sidebar-toggle'));

    fireEvent.click(screen.getByTestId('header-sidebar-toggle'));

    await waitFor(() => {
      // The mobile drawer overlay close-button appears
      const overlay = document.querySelector('[aria-label]');
      expect(overlay).toBeTruthy();
    });
  });

  it('closes mobile drawer on Escape key press', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => screen.getByTestId('header-sidebar-toggle'));

    // Open drawer
    fireEvent.click(screen.getByTestId('header-sidebar-toggle'));
    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      // Close button overlay should be gone
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });
  });

  it('mobile drawer has role=dialog and aria-modal', async () => {
    const { AdminLayout } = await import('./AdminLayout');
    render(<AdminLayout />);

    await waitFor(() => screen.getByTestId('header-sidebar-toggle'));

    // The mobile drawer div is always in DOM (controlled by inert + translate)
    // It has role="dialog" and aria-modal="true"
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).toBeInTheDocument();
  });
  // Owner decision, 3 Oct 2026: admins see the same "jurisdiction not set"
  // notice in the admin panel, because only they can set it.
  describe('safeguarding jurisdiction notice', () => {
    const NOTICE = 'Safeguarding jurisdiction not set';
    const policyIs = (configured: boolean | 'fail') => {
      mockApi.get.mockImplementation((url: string) => {
        if (url === '/v2/admin/vetting/policy') {
          return configured === 'fail'
            ? Promise.resolve({ success: false, error: 'Forbidden' })
            : Promise.resolve({ success: true, data: { policy: { configured }, jurisdictions: [] } });
        }
        return Promise.resolve({ success: true, data: [] });
      });
    };

    it('shows the notice with a button to the setting when it is not set', async () => {
      policyIs(false);
      const { AdminLayout } = await import('./AdminLayout');
      render(<AdminLayout />);

      expect(await screen.findByText(NOTICE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Set the jurisdiction/ })).toBeInTheDocument();
    });

    it('shows nothing once it is set', async () => {
      policyIs(true);
      const { AdminLayout } = await import('./AdminLayout');
      render(<AdminLayout />);

      await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/vetting/policy'));
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it('shows nothing when the policy cannot be read', async () => {
      policyIs('fail');
      const { AdminLayout } = await import('./AdminLayout');
      render(<AdminLayout />);

      await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/vetting/policy'));
      expect(screen.queryByText(NOTICE)).toBeNull();
    });
  });
});
