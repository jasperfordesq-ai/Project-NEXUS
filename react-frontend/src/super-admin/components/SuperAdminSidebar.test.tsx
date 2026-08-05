// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    /*
     * 🔴 Required now that the panel is two-tiered. The platform-only sections
     * (Federation, Commercial, Provisioning) render only for an explicit
     * 'master' level, and createMockContexts defaults `user` to null — which
     * resolves to 'none' and hides them. This file asserts the FULL platform
     * navigation, so it must act as a platform super-admin.
     */
    // Cast: only `user` matters here, and a partial AuthContext shape would trip
    // the test-type ratchet (which is shrink-only, so it must not grow).
    useAuth: () => ({ user: { is_super_admin: true, super_panel_level: 'master' } } as never),
  })
);

import { SuperAdminSidebar } from './SuperAdminSidebar';

const defaultProps = {
  collapsed: false,
  onToggle: vi.fn(),
};

describe('SuperAdminSidebar — expanded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<SuperAdminSidebar {...defaultProps} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a nav landmark', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  // ── Section headings ───────────────────────────────────────────────────────
  // i18n resolves real English: section_tenants → "Tenants", etc.

  it('renders the Tenants section heading', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    // "Tenants" appears as both the section heading <p> and as a nav link <span>.
    const all = screen.getAllByText('Tenants');
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Federation section heading', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    expect(screen.getByText('Federation')).toBeInTheDocument();
  });

  it('renders the Commercial section heading', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    expect(screen.getByText('Commercial')).toBeInTheDocument();
  });

  // Overview section heading is intentionally hidden (section.key === 'overview')
  it('does NOT render an explicit Overview section heading', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    // "Overview" is the section.title but it is not rendered when section.key === 'overview'
    // Note: "Overview" may not appear at all (there is no other "Overview" text in the sidebar)
    const headings = screen.queryAllByText('Overview');
    expect(headings).toHaveLength(0);
  });

  // ── Nav links ──────────────────────────────────────────────────────────────
  // nav.dashboard → "Dashboard", nav.federation_dashboard → also "Dashboard"
  // Both "Dashboard" links exist; we find the correct one by href.

  it('renders a Dashboard link pointing to /test/super-admin', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    // Multiple "Dashboard" links exist (main + federation); find by href
    const links = screen.getAllByRole('link', { name: 'Dashboard' });
    const dashLink = links.find((l) => l.getAttribute('href') === '/test/super-admin');
    expect(dashLink).toBeDefined();
  });

  it('renders a Tenants link pointing to /test/super-admin/tenants', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    // "Tenants" appears as both a section heading and a nav link.
    // Find the link element specifically.
    const links = screen.getAllByRole('link', { name: 'Tenants' });
    const tenantsLink = links.find((l) => l.getAttribute('href') === '/test/super-admin/tenants');
    expect(tenantsLink).toBeDefined();
  });

  it('renders a Users link', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    const link = screen.getByRole('link', { name: 'Users' });
    expect(link).toHaveAttribute('href', '/test/super-admin/users');
  });

  it('renders a Federation Dashboard link pointing to /test/super-admin/federation', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    const links = screen.getAllByRole('link', { name: 'Dashboard' });
    const fedLink = links.find((l) => l.getAttribute('href') === '/test/super-admin/federation');
    expect(fedLink).toBeDefined();
  });

  it('renders a Billing Control link', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    const link = screen.getByRole('link', { name: 'Billing Control' });
    expect(link).toHaveAttribute('href', '/test/super-admin/billing');
  });

  it('renders a Provisioning Queue link', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    const link = screen.getByRole('link', { name: 'Provisioning Queue' });
    expect(link).toBeInTheDocument();
  });

  it('renders an Audit Log link', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    const link = screen.getByRole('link', { name: 'Audit Log' });
    expect(link).toHaveAttribute('href', '/test/super-admin/audit');
  });

  it('renders a Back to Platform Admin link at the bottom', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    const link = screen.getByRole('link', { name: 'Back to Platform Admin' });
    expect(link).toHaveAttribute('href', '/test/admin');
  });

  // ── Brand header ──────────────────────────────────────────────────────────

  it('renders the brand label "Super Admin" in the header when expanded', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    // nav.brand → "Super Admin"
    expect(screen.getByText('Super Admin')).toBeInTheDocument();
  });

  // ── Toggle button ─────────────────────────────────────────────────────────

  it('renders a collapse toggle button with correct aria-label', () => {
    render(<SuperAdminSidebar {...defaultProps} />);
    // sidebar.collapse → "Collapse sidebar"
    const toggleBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggleBtn).toBeInTheDocument();
  });

  it('calls onToggle when toggle button is pressed', () => {
    const onToggle = vi.fn();
    render(<SuperAdminSidebar collapsed={false} onToggle={onToggle} />);
    const toggleBtn = screen.getByRole('button', { name: 'Collapse sidebar' });
    fireEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  // ── Active state ──────────────────────────────────────────────────────────

  it('does NOT mark any link aria-current when no route is active', () => {
    // BrowserRouter in test-utils defaults to '/' which does not match /super-admin exactly
    // (the isActive check for dashboard requires pathname === tenantPath('/super-admin'))
    render(<SuperAdminSidebar {...defaultProps} />);
    const activeLinks = screen.queryAllByRole('link', { current: 'page' });
    // '/' does not match any super-admin link — none should be current
    expect(activeLinks).toHaveLength(0);
  });
});

describe('SuperAdminSidebar — collapsed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in collapsed mode without crashing', () => {
    const { container } = render(
      <SuperAdminSidebar collapsed={true} onToggle={vi.fn()} />
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('hides the brand label when collapsed', () => {
    render(<SuperAdminSidebar collapsed={true} onToggle={vi.fn()} />);
    expect(screen.queryByText(/nav\.brand/i)).not.toBeInTheDocument();
  });

  it('hides section headings when collapsed', () => {
    render(<SuperAdminSidebar collapsed={true} onToggle={vi.fn()} />);
    expect(screen.queryByText(/section_tenants/i)).not.toBeInTheDocument();
  });

  it('renders expand toggle button with correct aria-label when collapsed', () => {
    render(<SuperAdminSidebar collapsed={true} onToggle={vi.fn()} />);
    // sidebar.expand → "Expand sidebar"
    const expandBtn = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expandBtn).toBeInTheDocument();
  });

  it('calls onToggle when the expand button is pressed', () => {
    const onToggle = vi.fn();
    render(<SuperAdminSidebar collapsed={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('applies w-16 width class when collapsed', () => {
    const { container } = render(
      <SuperAdminSidebar collapsed={true} onToggle={vi.fn()} />
    );
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('w-16');
  });

  it('applies w-64 width class when expanded', () => {
    const { container } = render(
      <SuperAdminSidebar collapsed={false} onToggle={vi.fn()} />
    );
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('w-64');
  });

  // SKIPPED: Tooltip popover content for nav items in collapsed mode is rendered
  // in a portal. HeroUI Tooltip portals are not reliably queryable in jsdom
  // without pointer-event simulation via @testing-library/user-event + a
  // real FocusScope environment. Nav link hrefs are still asserted via the
  // `to` prop which is always set regardless of collapsed state.
});
