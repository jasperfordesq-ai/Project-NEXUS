// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '@/test/test-utils';
import type { ApiMenu, ApiMenuItem } from '@/types/menu';

// ─── Context mocks ────────────────────────────────────────────────────────────
// MenuNavItems imports useAuth from '@/contexts/AuthContext' (line 18) and
// useTenant from '@/contexts/TenantContext' (line 19) — both by DIRECT path.
// Overrides therefore have to be registered against those specifiers; a
// '@/contexts' barrel mock is never resolved for this component and the real
// provider-backed hooks throw outside their providers. Both mocks are partial
// so AuthProvider / TenantProvider and the sibling hooks stay real.

// Mutable so a single test can flip the signed-in state without re-mocking.
const authState = {
  user: { id: 1, name: 'Tester', role: 'user' } as { id: number; name: string; role: string } | null,
  isAuthenticated: true,
};

vi.mock('@/contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/AuthContext')>()),
  useAuth: () => ({
    user: authState.user,
    isAuthenticated: authState.isAuthenticated,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
}));

vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeItem(overrides: Partial<ApiMenuItem> = {}): ApiMenuItem {
  return {
    id: Math.random(),
    parent_id: null,
    type: 'link',
    label: 'Test Link',
    url: '/test-link',
    icon: null,
    css_class: null,
    target: '_self',
    sort_order: 0,
    visibility_rules: null,
    is_active: 1,
    children: [],
    ...overrides,
  };
}

function makeMenu(items: ApiMenuItem[]): ApiMenu {
  return {
    id: 1,
    name: 'Main Menu',
    slug: 'header-main',
    location: 'header-main',
    is_active: 1,
    items,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('DesktopMenuItems', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore the default signed-in state (one test flips it).
    authState.user = { id: 1, name: 'Tester', role: 'user' };
    authState.isAuthenticated = true;
  });

  it('renders a nav link for a basic link item', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const items = [makeItem({ label: 'Home', url: '/home' })];
    render(<DesktopMenuItems menus={[makeMenu(items)]} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('renders multiple nav links for multiple items', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const items = [
      makeItem({ id: 1, label: 'Dashboard', url: '/dashboard' }),
      makeItem({ id: 2, label: 'Listings', url: '/listings' }),
    ];
    render(<DesktopMenuItems menus={[makeMenu(items)]} />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Listings')).toBeInTheDocument();
  });

  it('does not render inactive items', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const items = [
      makeItem({ id: 1, label: 'Visible', url: '/visible', is_active: 1 }),
      makeItem({ id: 2, label: 'Hidden', url: '/hidden', is_active: 0 }),
    ];
    render(<DesktopMenuItems menus={[makeMenu(items)]} />);
    expect(screen.getByText('Visible')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('renders external link items as <a> tags', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const items = [makeItem({ id: 1, label: 'External', url: 'https://example.com', type: 'external' })];
    render(<DesktopMenuItems menus={[makeMenu(items)]} />);
    const link = screen.getByRole('link', { name: /External/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides items requiring auth when user is unauthenticated', async () => {
    // Flip the shared auth state the direct-path useAuth mock reads from.
    // (The previous `vi.doMock('@/contexts', ...)` here was inert: MenuNavItems
    // imports useAuth from '@/contexts/AuthContext', and re-mocking after the
    // module graph is loaded cannot swap an already-resolved import anyway —
    // which is why this test only ever asserted the public item.)
    authState.user = null;
    authState.isAuthenticated = false;

    const { DesktopMenuItems } = await import('./MenuNavItems');
    const items = [
      makeItem({ id: 1, label: 'Public', url: '/public', visibility_rules: null }),
      makeItem({ id: 2, label: 'Auth Only', url: '/auth', visibility_rules: { requires_auth: true } }),
    ];
    render(<DesktopMenuItems menus={[makeMenu(items)]} />);
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.queryByText('Auth Only')).not.toBeInTheDocument();
  });

  it('renders dropdown group with children when type=dropdown', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const childItem = makeItem({ id: 10, label: 'Sub Item', url: '/sub' });
    const parent = makeItem({
      id: 5,
      label: 'Parent Dropdown',
      url: null,
      type: 'dropdown',
      children: [childItem],
    });
    render(<DesktopMenuItems menus={[makeMenu([parent])]} />);

    // Dropdown trigger renders the parent label. The real HeroUI v3 Dropdown
    // mounts Dropdown.Menu inside Dropdown.Popover, so the children are not in
    // the document until the trigger is activated — asserting on the collapsed
    // trigger plus the opened menu is strictly stronger than the old stub,
    // which rendered the whole tree eagerly and could never catch broken
    // trigger/popover wiring.
    const trigger = screen.getByRole('button', { name: /Parent Dropdown/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);

    // Child renders inside the opened dropdown menu
    expect(await screen.findByRole('menuitem', { name: 'Sub Item' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders items from multiple merged menus', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const menu1 = makeMenu([makeItem({ id: 1, label: 'First Menu Item', url: '/first' })]);
    const menu2 = makeMenu([makeItem({ id: 2, label: 'Second Menu Item', url: '/second' })]);
    menu2.id = 2;
    render(<DesktopMenuItems menus={[menu1, menu2]} />);
    expect(screen.getByText('First Menu Item')).toBeInTheDocument();
    expect(screen.getByText('Second Menu Item')).toBeInTheDocument();
  });

  it('does not render divider type items in desktop nav', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    const items = [
      makeItem({ id: 1, label: 'Link One', url: '/one' }),
      makeItem({ id: 2, label: '', url: null, type: 'divider' }),
      makeItem({ id: 3, label: 'Link Two', url: '/two' }),
    ];
    render(<DesktopMenuItems menus={[makeMenu(items)]} />);
    expect(screen.getByText('Link One')).toBeInTheDocument();
    expect(screen.getByText('Link Two')).toBeInTheDocument();
  });

  it('renders empty output when menus have no items', async () => {
    const { DesktopMenuItems } = await import('./MenuNavItems');
    render(<DesktopMenuItems menus={[makeMenu([])]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MobileMenuItems', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Restore the default signed-in state (one test flips it).
    authState.user = { id: 1, name: 'Tester', role: 'user' };
    authState.isAuthenticated = true;
  });

  it('renders mobile nav links for active items', async () => {
    const { MobileMenuItems } = await import('./MenuNavItems');
    const items = [makeItem({ id: 1, label: 'Mobile Home', url: '/home' })];
    render(<MobileMenuItems menus={[makeMenu(items)]} />);
    expect(screen.getByText('Mobile Home')).toBeInTheDocument();
  });

  it('renders dropdown section label and children flat on mobile', async () => {
    const { MobileMenuItems } = await import('./MenuNavItems');
    const child1 = makeItem({ id: 11, label: 'Mobile Sub A', url: '/sub-a' });
    const child2 = makeItem({ id: 12, label: 'Mobile Sub B', url: '/sub-b' });
    const parent = makeItem({
      id: 6,
      label: 'Mobile Group',
      url: null,
      type: 'dropdown',
      children: [child1, child2],
    });
    render(<MobileMenuItems menus={[makeMenu([parent])]} />);
    // Section heading
    expect(screen.getByText('Mobile Group')).toBeInTheDocument();
    // Both children rendered flat
    expect(screen.getByText('Mobile Sub A')).toBeInTheDocument();
    expect(screen.getByText('Mobile Sub B')).toBeInTheDocument();
  });

  it('renders a horizontal divider for divider items', async () => {
    const { MobileMenuItems } = await import('./MenuNavItems');
    const items = [
      makeItem({ id: 1, label: 'Above', url: '/above' }),
      makeItem({ id: 2, label: '', url: null, type: 'divider' }),
      makeItem({ id: 3, label: 'Below', url: '/below' }),
    ];
    render(<MobileMenuItems menus={[makeMenu(items)]} />);
    // Check divider element exists (has border-t class)
    const dividers = document.querySelectorAll('.border-t');
    expect(dividers.length).toBeGreaterThan(0);
  });

  it('renders external links as <a> tags in mobile nav', async () => {
    const { MobileMenuItems } = await import('./MenuNavItems');
    const items = [makeItem({ id: 1, label: 'External Mobile', url: 'https://example.com', type: 'external' })];
    render(<MobileMenuItems menus={[makeMenu(items)]} />);
    const link = screen.getByRole('link', { name: /External Mobile/i });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });
});
