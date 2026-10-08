// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock (unused but required to avoid module resolution issues) ─────────
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

// ─── react-router-dom: partial mock to control useLocation ───────────────────
const { mockLocation } = vi.hoisted(() => ({
  mockLocation: { pathname: '/hour-timebank/admin', search: '', hash: '', state: null, key: 'default' },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useLocation: () => mockLocation,
  };
});

// ─── Context mocks ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
      tenantSlug: 'hour-timebank',
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─────────────────────────────────────────────────────────────────────────────
describe('AdminBreadcrumbs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset location to single-segment default
    mockLocation.pathname = '/hour-timebank/admin';
  });

  it('returns null (no nav) when only one segment in path', async () => {
    mockLocation.pathname = '/hour-timebank/admin';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    const { container } = render(<AdminBreadcrumbs />);

    // Component returns null when crumbs.length <= 1
    const nav = container.querySelector('nav');
    expect(nav).toBeNull();
  });

  it('renders nav element for two-segment path', async () => {
    mockLocation.pathname = '/hour-timebank/admin/users';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs />);

    await waitFor(() => {
      expect(document.querySelector('nav')).toBeTruthy();
    });
  });

  it('renders explicit items prop (bypasses URL auto-parse)', async () => {
    const items = [
      { label: 'Admin', href: '/hour-timebank/admin' },
      { label: 'Users' },
    ];
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs items={items} />);

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Users')).toBeInTheDocument();
    });
  });

  it('renders first item as a clickable link when href is provided', async () => {
    const items = [
      { label: 'Admin', href: '/hour-timebank/admin' },
      { label: 'Listings' },
    ];
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs items={items} />);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Admin' });
      expect(link).toBeInTheDocument();
    });
  });

  it('renders last item as plain span (no link) when no href', async () => {
    const items = [
      { label: 'Admin', href: '/hour-timebank/admin' },
      { label: 'Users' },
    ];
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs items={items} />);

    await waitFor(() => {
      // "Users" should not be a link
      const usersLink = screen.queryAllByRole('link', { name: 'Users' });
      expect(usersLink.length).toBe(0);
      expect(screen.getByText('Users')).toBeInTheDocument();
    });
  });

  it('auto-parses /admin/users into two visible breadcrumb items', async () => {
    mockLocation.pathname = '/hour-timebank/admin/users';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs />);

    await waitFor(() => {
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      // Both "admin" and "users" translated text should appear
      expect(nav!.textContent?.toLowerCase()).toMatch(/admin/);
      expect(nav!.textContent?.toLowerCase()).toMatch(/users/);
    });
  });

  it('skips numeric segments (e.g. record IDs) in auto-parsed path', async () => {
    mockLocation.pathname = '/hour-timebank/admin/users/42';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs />);

    await waitFor(() => {
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      // "42" should NOT appear as its own crumb label
      expect(nav!.textContent).not.toMatch(/\b42\b/);
    });
  });

  it('shows ⚠ warning marker for unknown URL segments', async () => {
    mockLocation.pathname = '/hour-timebank/admin/unknownsegmentxyz';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs />);

    await waitFor(() => {
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      // Unknown segments get a ⚠ prefix per the component logic
      expect(nav!.textContent).toMatch(/⚠/);
    });
  });

  // Found walking the admin Certificates page (7 Oct 2026): it read "⚠ certificates".
  it('names every volunteering admin page, including Certificates', async () => {
    mockLocation.pathname = '/hour-timebank/admin/volunteering/certificates';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs />);

    await waitFor(() => {
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      expect(nav!.textContent).toContain('Certificates');
      expect(nav!.textContent).not.toMatch(/⚠/);
    });
  });

  it('names the admin Group bookings page', async () => {
    mockLocation.pathname = '/hour-timebank/admin/volunteering/group-bookings';
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs />);

    await waitFor(() => {
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      expect(nav!.textContent).toContain('Group bookings');
      expect(nav!.textContent).not.toMatch(/⚠/);
    });
  });

  it('renders an ordered list (<ol>) inside the nav', async () => {
    const items = [
      { label: 'Admin', href: '/hour-timebank/admin' },
      { label: 'Settings' },
    ];
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs items={items} />);

    await waitFor(() => {
      expect(document.querySelector('ol')).toBeTruthy();
    });
  });

  it('renders three-level crumbs with two links and one span', async () => {
    const items = [
      { label: 'Admin', href: '/hour-timebank/admin' },
      { label: 'Users', href: '/hour-timebank/admin/users' },
      { label: 'Edit' },
    ];
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs items={items} />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      // "Edit" is the last crumb — no link role
      expect(screen.queryAllByRole('link', { name: 'Edit' })).toHaveLength(0);
    });
  });

  it('renders a nav with accessible aria-label', async () => {
    const items = [
      { label: 'Admin', href: '/hour-timebank/admin' },
      { label: 'Blog' },
    ];
    const { AdminBreadcrumbs } = await import('./AdminBreadcrumbs');
    render(<AdminBreadcrumbs items={items} />);

    await waitFor(() => {
      // nav should have an accessible aria-label (translated from 'aria.breadcrumbs')
      const nav = document.querySelector('nav');
      expect(nav).toBeTruthy();
      expect(nav!.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
