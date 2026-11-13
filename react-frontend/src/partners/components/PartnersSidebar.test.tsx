// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mutable auth / tenant state (read by the factory each render) ───────────
const { mockAuth, mockTenant, mockExternalStatus } = vi.hoisted(() => ({
  mockAuth: {
    user: { id: 1, role: 'super_admin' } as Record<string, unknown>,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  },
  mockTenant: {
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
  },
  mockExternalStatus: { value: null as null | { effective: boolean } },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ ...mockAuth }),
    useTenant: () => ({ ...mockTenant }),
  })
);

vi.mock('./useExternalFederationStatus', () => ({
  useExternalFederationStatus: () => mockExternalStatus.value,
}));

import { PartnersSidebar } from './PartnersSidebar';

const mockOnToggle = vi.fn();

/** test-utils renders inside a BrowserRouter, so the address bar is the route. */
function goTo(path: string) {
  window.history.pushState({}, '', path);
}

const technicalToggle = () => screen.getByRole('button', { name: 'Technical setup' });
/** Names of the links a sighted user can see, in order. `hidden` lists are excluded by role queries. */
const visibleLinks = () => screen.getAllByRole('link').map((a) => a.textContent?.trim());

describe('PartnersSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenant.hasFeature = vi.fn(() => true);
    mockAuth.user = { id: 1, role: 'super_admin' };
    mockExternalStatus.value = null;
    goTo('/test/partner-timebanks');
  });

  it('renders the sidebar navigation landmark', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    // i18n: partners.sidebar.nav_label → "Partner Timebanks sections"
    expect(screen.getByRole('navigation', { name: /Partner Timebanks sections/i })).toBeInTheDocument();
  });

  // ─── Order and grouping (November 2026) ────────────────────────────────────

  it('lists the everyday pages first, in the order an admin uses them', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);

    // Settings is step one of setting up; it used to be the very last link,
    // below nine technical ones.
    expect(visibleLinks()).toEqual([
      'Partner Timebanks', // the panel title links home
      'Overview',
      'Partnerships',
      'Partner directory',
      'Our listing',
      'Neighbourhoods',
      'Credit agreements',
      'Activity feed',
      'Analytics',
      'Network settings',
      'Full Admin Panel',
    ]);
  });

  it('gives "Our listing" its own link, to the directory page\'s listing tab', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.getByRole('link', { name: 'Our listing' })).toHaveAttribute(
      'href',
      '/test/partner-timebanks/directory?tab=profile'
    );
  });

  it('marks only the right one of the two directory links as the current page', () => {
    goTo('/test/partner-timebanks/directory?tab=profile');
    const { unmount } = render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.getByRole('link', { name: 'Our listing' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Partner directory' })).not.toHaveAttribute('aria-current');
    unmount();

    goTo('/test/partner-timebanks/directory');
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.getByRole('link', { name: 'Partner directory' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Our listing' })).not.toHaveAttribute('aria-current');
  });

  it('marks the current page when the router has stripped the community slug from the address', () => {
    // On a shared host (localhost, the app host) the address is
    // /<slug>/partner-timebanks/…, but TenantShell renders the routes with the
    // slug stripped, so useLocation() returns /partner-timebanks/… while
    // tenantPath() still adds the slug. Until November 2026 the two were
    // compared directly and no link was ever marked on a slug address.
    goTo('/partner-timebanks/partnerships');
    const { unmount } = render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.getByRole('link', { name: 'Partnerships' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    unmount();

    goTo('/partner-timebanks');
    const again = render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    again.unmount();

    // …and the technical group still opens itself there.
    goTo('/partner-timebanks/api-keys/create');
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(technicalToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'API keys' })).toHaveAttribute('aria-current', 'page');
  });

  // ─── Technical setup: one group, closed until opened ───────────────────────

  it('keeps the technical pages in one group that is closed to begin with', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);

    expect(technicalToggle()).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['External platforms', 'Credit Commons', 'API keys', 'Event webhooks', 'Developer guide', 'Shared statistics', 'Data management']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    // The three always-open technical headings are gone.
    expect(screen.queryByText('External connections')).not.toBeInTheDocument();
    expect(screen.queryByText('Access & security')).not.toBeInTheDocument();
    expect(screen.queryByText('Caring Community')).not.toBeInTheDocument();
  });

  it('opens and closes the technical group', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);

    fireEvent.click(technicalToggle());
    expect(technicalToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'External platforms' })).toHaveAttribute('href', '/test/partner-timebanks/external-partners');
    expect(screen.getByRole('link', { name: 'Data management' })).toHaveAttribute('href', '/test/partner-timebanks/data');

    fireEvent.click(technicalToggle());
    expect(technicalToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'External platforms' })).not.toBeInTheDocument();
  });

  it('is already open when the current page is one of the technical pages', () => {
    goTo('/test/partner-timebanks/webhooks');
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);

    expect(technicalToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Event webhooks' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks only the pages that talk to other platforms as Off while those links are switched off', () => {
    mockExternalStatus.value = { effective: false };
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    fireEvent.click(technicalToggle());

    for (const name of ['External platforms', 'Credit Commons', 'Inbound API partners', 'API keys', 'Event webhooks', 'Developer guide']) {
      expect(within(screen.getByRole('link', { name: new RegExp(name) })).getByText('Off')).toBeInTheDocument();
    }
    // Pages about communities on this platform are not affected and carry no mark.
    for (const name of ['Partnerships', 'Credit agreements', 'Shared statistics', 'Data management', 'Network settings']) {
      expect(within(screen.getByRole('link', { name: new RegExp(name) })).queryByText('Off')).not.toBeInTheDocument();
    }
  });

  it('shows no Off marks when the links to other platforms are live', () => {
    mockExternalStatus.value = { effective: true };
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    fireEvent.click(technicalToggle());
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  // ─── Feature and role gates (must mirror routes.tsx) ───────────────────────

  it('hides Partner cooperatives when the Caring Community module is off', () => {
    mockTenant.hasFeature = vi.fn((f: string) => f !== 'caring_community');
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    fireEvent.click(technicalToggle());
    expect(screen.queryByRole('link', { name: /Partner cooperatives/i })).not.toBeInTheDocument();
    // The rest of the panel is unaffected
    expect(screen.getByText('Partner network')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /External platforms/i })).toBeInTheDocument();
  });

  it('shows Partner cooperatives inside the technical group when the module is on', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    fireEvent.click(technicalToggle());
    expect(screen.getByRole('link', { name: /Partner cooperatives/i })).toHaveAttribute('href', '/test/partner-timebanks/caring/peers');
  });

  it('hides the Inbound API partners item without the partner_api feature', () => {
    mockTenant.hasFeature = vi.fn((f: string) => f !== 'partner_api');
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    fireEvent.click(technicalToggle());
    expect(screen.queryByRole('link', { name: /Inbound API partners/i })).not.toBeInTheDocument();
    // Other technical items stay
    expect(screen.getByRole('link', { name: /External platforms/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Credit Commons/i })).toBeInTheDocument();
  });

  it('hides everything federation-backed when only partner_api is enabled', () => {
    mockTenant.hasFeature = vi.fn((f: string) => f === 'partner_api');
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.queryByText('Partner network')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Network settings/i })).not.toBeInTheDocument();
    // The technical group survives with just the inbound item
    fireEvent.click(technicalToggle());
    expect(screen.getByRole('link', { name: /Inbound API partners/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Credit Commons/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /API keys/i })).not.toBeInTheDocument();
  });

  it('shows a NORMAL admin only the read-mostly pages — setup and the technical group are super-admin-only', () => {
    mockAuth.user = { id: 2, role: 'admin', is_admin: true };
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);

    expect(visibleLinks()).toEqual([
      'Partner Timebanks',
      'Overview',
      'Partnerships',
      'Partner directory',
      'Our listing',
      'Neighbourhoods',
      'Credit agreements',
      'Activity feed',
      'Analytics',
      'Full Admin Panel',
    ]);
    // No technical group at all, open or closed.
    expect(screen.queryByRole('button', { name: 'Technical setup' })).not.toBeInTheDocument();
  });

  it('renders the Full Admin Panel footer link', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    const link = screen.getByRole('link', { name: /Full Admin Panel/i });
    expect(link).toHaveAttribute('href', '/test/admin');
  });

  it('links nav items through tenantPath', () => {
    render(<PartnersSidebar collapsed={false} onToggle={mockOnToggle} />);
    expect(screen.getByRole('link', { name: /Partnerships/i })).toHaveAttribute(
      'href',
      '/test/partner-timebanks/partnerships'
    );
  });
});
