// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SuperAdminBreadcrumbs.
 *
 * The component uses useLocation() (from react-router-dom) and useTenant()
 * (from @/contexts). We render directly with React Testing Library's render
 * (not the custom render wrapper which adds BrowserRouter) so we can provide
 * our own MemoryRouter with a controlled initialEntries path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createMockContexts } from '@/test/mock-contexts';

// Provide tenantSlug explicitly so the component can strip it from the path
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantSlug: 'test',
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

import { SuperAdminBreadcrumbs } from './SuperAdminBreadcrumbs';

/** Render the component inside a MemoryRouter with a specific pathname */
function renderAt(pathname: string) {
  return rtlRender(
    <MemoryRouter initialEntries={[pathname]}>
      <SuperAdminBreadcrumbs />
    </MemoryRouter>
  );
}

describe('SuperAdminBreadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Returns null for shallow paths (≤ 1 crumb) ─────────────────────────

  it('renders nothing for a single-segment path (only super-admin)', () => {
    const { container } = renderAt('/test/super-admin');
    // Only one crumb → component returns null
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for the bare tenant root path', () => {
    const { container } = renderAt('/test');
    expect(container.firstChild).toBeNull();
  });

  // ── Two segments → breadcrumbs appear ─────────────────────────────────

  it('renders a <nav> element for a two-segment path', () => {
    renderAt('/test/super-admin/tenants');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders an ordered list inside the nav', () => {
    renderAt('/test/super-admin/tenants');
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  // ── Crumb count ────────────────────────────────────────────────────────

  it('renders two list items for /super-admin/tenants', () => {
    renderAt('/test/super-admin/tenants');
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  it('renders three list items for /super-admin/tenants/create', () => {
    renderAt('/test/super-admin/tenants/create');
    expect(screen.getAllByRole('listitem').length).toBe(3);
  });

  // ── Last crumb is NOT a link ────────────────────────────────────────────

  it('the last crumb renders as a <span> (no anchor)', () => {
    renderAt('/test/super-admin/tenants');
    const items = screen.getAllByRole('listitem');
    const lastItem = items[items.length - 1];
    expect(lastItem.querySelector('span')).toBeInTheDocument();
    expect(lastItem.querySelector('a')).not.toBeInTheDocument();
  });

  // ── Intermediate crumbs ARE links ──────────────────────────────────────

  it('intermediate crumbs are rendered as links', () => {
    renderAt('/test/super-admin/tenants/create');
    const links = screen.getAllByRole('link');
    // super-admin (link) → tenants (link) → create (span, last)
    expect(links.length).toBe(2);
  });

  it('intermediate link hrefs include the correct segments', () => {
    renderAt('/test/super-admin/tenants/create');
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('super-admin'));
    expect(links[1]).toHaveAttribute('href', expect.stringContaining('tenants'));
  });

  // ── Numeric segments are skipped ───────────────────────────────────────

  it('skips pure-numeric segments (e.g. tenant IDs)', () => {
    renderAt('/test/super-admin/tenants/42/edit');
    // Segments after stripping slug: super-admin, tenants, [42 skipped], edit → 3 crumbs
    expect(screen.getAllByRole('listitem').length).toBe(3);
  });

  // ── Hyphenated segment labels ───────────────────────────────────────────

  it('handles hyphenated segments like "pilot-inquiries" without crashing', () => {
    renderAt('/test/super-admin/pilot-inquiries');
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  // ── aria-label on nav ──────────────────────────────────────────────────

  it('has a non-empty aria-label on the nav element', () => {
    renderAt('/test/super-admin/tenants');
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('aria-label');
    expect(nav.getAttribute('aria-label')).not.toBe('');
  });

  // ── Tenant slug is stripped from the path ─────────────────────────────

  it('does not emit a crumb for the tenant slug itself', () => {
    // The /test prefix is the tenant slug and must be stripped before building crumbs
    renderAt('/test/super-admin/users');
    const items = screen.getAllByRole('listitem');
    // Only super-admin + users → 2, not 3 (which would mean "test" leaked through)
    expect(items.length).toBe(2);
  });

  // ── Known segments ────────────────────────────────────────────────────

  it('renders correctly for federation segment', () => {
    renderAt('/test/super-admin/federation');
    expect(screen.getAllByRole('listitem').length).toBe(2);
  });

  it('renders correctly for billing under platform', () => {
    renderAt('/test/super-admin/platform/billing');
    expect(screen.getAllByRole('listitem').length).toBe(3);
  });

  it('names Branch payments and Branch plans by their titles, not their addresses', () => {
    renderAt('/test/super-admin/branch-payments');
    expect(screen.getByText('Branch payments')).toBeInTheDocument();
    expect(screen.queryByText('branch-payments')).not.toBeInTheDocument();
  });

  it('names Branch plans by its title', () => {
    renderAt('/test/super-admin/branch-plans');
    expect(screen.getByText('Branch plans')).toBeInTheDocument();
    expect(screen.queryByText('branch-plans')).not.toBeInTheDocument();
  });
});
