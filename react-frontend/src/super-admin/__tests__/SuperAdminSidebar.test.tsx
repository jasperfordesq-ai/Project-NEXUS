// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenantPath: (path: string) => `/test${path}`,
  })),
  // The menu no longer depends on the caller's super-panel level: the
  // platform-only sections (federation, commercial, provisioning) moved to the
  // Platform team panel on 15 Nov 2026, so every caller sees the same entries.
  useAuth: vi.fn(() => ({ user: { is_super_admin: true } })),
}));

import { useAuth } from '@/contexts';
import { SuperAdminSidebar } from '../components/SuperAdminSidebar';

describe('SuperAdminSidebar', () => {
  beforeEach(() => {
    // Reset to the platform super-admin default; individual cases override it.
    vi.mocked(useAuth).mockReturnValue({ user: { is_super_admin: true } } as never);
  });

  it('renders dedicated super-admin navigation with a back link to the main admin panel', () => {
    render(
      <MemoryRouter initialEntries={['/test/super-admin/tenants']}>
        <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Super Admin' })).toHaveAttribute('href', '/test/super-admin');
    expect(screen.getByRole('link', { name: 'Tenants' })).toHaveAttribute('href', '/test/super-admin/tenants');
    expect(screen.getByRole('link', { name: 'Back to Platform Admin' })).toHaveAttribute('href', '/test/admin');
  });

  /**
   * 🔴 The panel is two-tiered. A 'regional' caller — the super-admin of a
   * community that has communities beneath it — may manage its own branch, and
   * must not be shown platform-wide controls.
   *
   * The API refuses those regardless (they sit behind EnsureIsSuperAdmin, which
   * refuses tenant super-admins). These tests are about not offering a branch
   * admin controls that can only fail.
   */
  describe('a regional (branch) super-admin', () => {
    function renderAsRegional() {
      vi.mocked(useAuth).mockReturnValue({
        user: { is_tenant_super_admin: true, super_panel_level: 'regional' },
      } as never);

      return render(
        <MemoryRouter initialEntries={['/test/super-admin/tenants']}>
          <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
        </MemoryRouter>,
      );
    }

    it('still gets the community, member, hierarchy and audit screens', () => {
      renderAsRegional();

      // These are subtree-scoped by the backend, so they are safe and are the
      // whole point of giving a branch its own panel.
      expect(screen.getByRole('link', { name: 'Tenants' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Hierarchy' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Audit Log' })).toBeInTheDocument();
    });

    it('is not shown the platform income or pricing screens', () => {
      renderAsRegional();

      // 🔴 The billing endpoints take the community they act on from the request
      // with no branch check, which is why a tenant super admin must never reach them.
      expect(screen.queryByText('Commercial')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Billing Control' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Revenue Dashboard' })).toBeNull();
    });

    it('is not shown the cross-installation federation controls', () => {
      renderAsRegional();

      // Section heading plus two unambiguous items. Do NOT assert on
      // "Federation Dashboard" — no such label exists, so it would pass whatever
      // the component did.
      expect(screen.queryByText('Federation')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Whitelist' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Partnerships' })).toBeNull();
    });

    it('is not shown the platform provisioning queue or enquiries', () => {
      renderAsRegional();

      // Approving a provisioning request assigns a parent anywhere in the tree.
      expect(screen.queryByRole('link', { name: 'Provisioning Queue' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Pilot Inquiries' })).toBeNull();
    });

    it('is shown bulk operations', () => {
      // Owner rule, 12 Oct 2026: bulk moves and bulk tenant updates are scoped
      // to the tenant super-admin's own subtree by the API, so they are offered.
      renderAsRegional();

      expect(screen.getByRole('link', { name: 'Bulk Ops' })).toBeInTheDocument();
    });
  });

  /**
   * 🔴 One tier since 15 Nov 2026. The platform-wide pages moved to the Platform
   * team panel, so a global super admin ('master') and a tenant super admin
   * ('regional') are offered exactly the same eight pages here.
   */
  function panelLinks(user: Record<string, unknown>): string[] {
    vi.mocked(useAuth).mockReturnValue({ user } as never);
    const { unmount } = render(
      <MemoryRouter initialEntries={['/test/super-admin']}>
        <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );
    const hrefs = screen
      .getAllByRole('navigation')[0]!
      .querySelectorAll('a');
    const list = Array.from(hrefs).map((a) => a.getAttribute('href') ?? '');
    unmount();
    return list;
  }

  const BRANCH_PAGES = [
    '/test/super-admin',
    '/test/super-admin/tenants',
    '/test/super-admin/tenants/hierarchy',
    '/test/super-admin/users',
    '/test/super-admin/bulk',
    '/test/super-admin/audit',
    // Added 20 Nov 2026: the payment standing of the communities below the
    // signed-in manager. A branch page, not a platform-wide one, so it
    // belongs here and both levels see it.
    '/test/super-admin/branch-payments',
    // Added 21 Nov 2026: the standard plans as the manager's hub offers them
    // to the communities that pay it. Confined to the caller's own branch.
    '/test/super-admin/branch-plans',
  ];

  it('offers a global super admin exactly the eight branch pages', () => {
    expect(panelLinks({ is_super_admin: true, super_panel_level: 'master' })).toEqual(BRANCH_PAGES);
  });

  it('offers a tenant super admin the same eight pages', () => {
    expect(panelLinks({ is_tenant_super_admin: true, super_panel_level: 'regional' })).toEqual(BRANCH_PAGES);
  });

  it('no longer lists the platform-wide pages, even for a global super admin', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { is_super_admin: true, super_panel_level: 'master' },
    } as never);

    render(
      <MemoryRouter initialEntries={['/test/super-admin']}>
        <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    // Section headings plus unambiguous items. Do NOT assert on a "Federation
    // Dashboard" link: no such label exists (`nav.federation_dashboard` is
    // literally "Dashboard"), so it would pass whatever the component did.
    expect(screen.queryByText('Federation')).toBeNull();
    expect(screen.queryByText('Commercial')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Billing Control' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Revenue Dashboard' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Whitelist' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Partnerships' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Provisioning Queue' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Pilot Inquiries' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Translation key' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'National Dashboard' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Bulk Ops' })).toBeInTheDocument();
  });

  // The backwards-compatibility fallback for a payload predating
  // `super_panel_level` is behaviour of superPanelLevel() itself, and is tested
  // in src/lib/access.test.ts rather than through this component.

  it('shows no panel sections at all to a user with no super-panel reach', () => {
    vi.mocked(useAuth).mockReturnValue({ user: { is_admin: true } } as never);

    render(
      <MemoryRouter initialEntries={['/test/super-admin']}>
        <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    // An ordinary admin should never reach this component — the entry link is
    // hidden and the API refuses — but if they do, no platform controls appear.
    expect(screen.queryByRole('link', { name: 'Billing Control' })).toBeNull();
    expect(screen.queryByText('Federation')).toBeNull();
    expect(screen.queryByText('Commercial')).toBeNull();
  });
});
