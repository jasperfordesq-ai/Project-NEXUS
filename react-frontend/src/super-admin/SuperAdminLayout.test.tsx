// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// Mock Outlet so we can verify it renders
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Outlet: () => <div data-testid="outlet-content">Outlet content</div>,
    useLocation: () => ({ pathname: '/test/super-admin' }),
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin User', avatar_url: null, avatar: null },
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
      tenantSlug: 'test',
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn(() => null),
  resolveAssetUrl: vi.fn(() => null),
  cn: (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' '),
}));

// The band has its own tests; here only that every super admin page carries it.
vi.mock('@/admin/components/PlatformNoticeBand', () => ({
  PlatformNoticeBand: () => <div data-testid="platform-notice-band" />,
}));

import { SuperAdminLayout } from './SuperAdminLayout';

describe('SuperAdminLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the platform team\'s notices above the page, inside the main area', () => {
    render(<SuperAdminLayout />);

    expect(screen.getByTestId('platform-notice-band').closest('main')).not.toBeNull();
  });

  it('renders without crashing', () => {
    render(<SuperAdminLayout />);
    expect(document.body).toBeInTheDocument();
  });

  it('renders the skip-to-main-content link for accessibility', () => {
    render(<SuperAdminLayout />);
    // The skip link is sr-only but present in DOM
    const skipLink = document.querySelector('a[href="#main-content"]');
    expect(skipLink).toBeInTheDocument();
  });

  it('renders the main content area', () => {
    render(<SuperAdminLayout />);
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main-content');
  });

  it('renders the Outlet inside main', () => {
    render(<SuperAdminLayout />);
    expect(screen.getByTestId('outlet-content')).toBeInTheDocument();
  });

  it('renders the sidebar (desktop, not collapsed by default)', () => {
    render(<SuperAdminLayout />);
    // SuperAdminSidebar renders an <aside> element
    const sidebar = screen.getAllByRole('complementary');
    expect(sidebar.length).toBeGreaterThan(0);
  });

  it('renders the header', () => {
    render(<SuperAdminLayout />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders the mobile drawer overlay (dialog) in the DOM', () => {
    render(<SuperAdminLayout />);
    // The mobile drawer is always in the DOM (hidden via CSS translate), rendered
    // as role="dialog" with aria-modal
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('does not show the mobile backdrop overlay by default', () => {
    render(<SuperAdminLayout />);
    // The semi-transparent overlay button is only rendered when mobileDrawerOpen=true
    const overlay = screen.queryByRole('button', { name: /close.navigation/i });
    expect(overlay).not.toBeInTheDocument();
  });

  it('opens mobile drawer and shows close overlay when header toggle is pressed', () => {
    render(<SuperAdminLayout />);
    // The header toggle button has aria-label "Toggle sidebar" (from i18n key header.toggle_sidebar)
    const toggleBtn = screen.getByRole('button', { name: /toggle sidebar/i });
    fireEvent.click(toggleBtn);
    // After opening, the overlay backdrop button with "Close super admin navigation" appears
    expect(
      screen.getByRole('button', { name: /close super admin navigation/i }),
    ).toBeInTheDocument();
  });

  it('closes mobile drawer when the overlay backdrop is clicked', () => {
    render(<SuperAdminLayout />);
    const toggleBtn = screen.getByRole('button', { name: /toggle sidebar/i });
    fireEvent.click(toggleBtn);

    const overlay = screen.getByRole('button', { name: /close super admin navigation/i });
    fireEvent.click(overlay);

    expect(
      screen.queryByRole('button', { name: /close super admin navigation/i }),
    ).not.toBeInTheDocument();
  });

  it('sidebar has nav element with accessible label', () => {
    render(<SuperAdminLayout />);
    // There are multiple navs with "Super admin navigation" (desktop + mobile drawer)
    const navs = screen.getAllByRole('navigation', { name: /super admin navigation/i });
    expect(navs.length).toBeGreaterThan(0);
  });

  it('renders sidebar navigation links', () => {
    render(<SuperAdminLayout />);
    // Sidebar contains links; e.g. to /super-admin (Dashboard)
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
  });
});
