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
  // The sidebar reads the caller's super-panel level to decide whether to show
  // the platform-only sections (federation, commercial, provisioning). A platform
  // super-admin sees everything; see the regional cases below.
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
      // with no branch check, which is why a branch admin must never reach them.
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
  });

  it('keeps every section for an explicit platform-level caller', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { is_super_admin: true, super_panel_level: 'master' },
    } as never);

    render(
      <MemoryRouter initialEntries={['/test/super-admin']}>
        <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Billing Control' })).toBeInTheDocument();
    // 🔴 Assert the section HEADING, not a "Federation Dashboard" link — that
    // label does not exist. `nav.federation_dashboard` is literally "Dashboard",
    // which collides with the Overview entry. An earlier version of this file
    // queried the non-existent name, which made the negative assertions in the
    // regional cases below pass vacuously.
    expect(screen.getByText('Federation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Whitelist' })).toBeInTheDocument();
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
