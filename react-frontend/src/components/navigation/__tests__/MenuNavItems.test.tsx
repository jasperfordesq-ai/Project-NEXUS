// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MenuNavItems (DesktopMenuItems & MobileMenuItems) components.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiMenu } from '@/types/menu';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// MenuNavItems imports useAuth from '@/contexts/AuthContext' (line 18) and
// useTenant from '@/contexts/TenantContext' (line 19) by their DIRECT paths, so
// the overrides must be registered against those specifiers — a '@/contexts'
// barrel mock is never resolved for this component and the real provider-backed
// hooks throw outside their providers. Partial mocks so AuthProvider /
// TenantProvider and the sibling hooks stay real.
vi.mock('@/contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/AuthContext')>()),
  useAuth: () => ({
    user: { id: 1, name: 'Test User', role: 'user' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  }),
}));

// No '@/components/ui' mock: MenuNavItems imports Button, Dropdown and
// DynamicIcon from '@/components/ui/Button', '@/components/ui/Dropdown' and
// '@/components/ui/DynamicIcon', so a barrel mock never applied. The real
// components render fine here — none of these cases open a dropdown popover.

import { DesktopMenuItems, MobileMenuItems } from '../MenuNavItems';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

const sampleMenus: ApiMenu[] = [
  {
    id: 1,
    name: 'Main Nav',
    location: 'header',
    items: [
      {
        id: 101,
        label: 'Dashboard',
        url: '/dashboard',
        icon: 'layout-dashboard',
        type: 'link',
        position: 1,
        is_active: true,
        target: '_self',
        children: [],
      },
      {
        id: 102,
        label: 'Listings',
        url: '/listings',
        icon: 'list',
        type: 'link',
        position: 2,
        is_active: true,
        target: '_self',
        children: [],
      },
    ],
  },
];

describe('DesktopMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><DesktopMenuItems menus={[]} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('renders menu items as links', () => {
    render(
      <W><DesktopMenuItems menus={sampleMenus} /></W>,
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Listings')).toBeInTheDocument();
  });

  it('renders nothing for empty menus', () => {
    const { container } = render(
      <W><DesktopMenuItems menus={[]} /></W>,
    );
    expect(container.querySelectorAll('a').length).toBe(0);
  });

  it('hides inactive items', () => {
    const menus: ApiMenu[] = [{
      id: 1,
      name: 'Test',
      location: 'header',
      items: [{
        id: 101,
        label: 'Hidden',
        url: '/hidden',
        icon: 'eye-off',
        type: 'link',
        position: 1,
        is_active: false,
        target: '_self',
        children: [],
      }],
    }];
    render(<W><DesktopMenuItems menus={menus} /></W>);
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });

  it('renders external links with correct attributes', () => {
    const menus: ApiMenu[] = [{
      id: 1,
      name: 'Test',
      location: 'header',
      items: [{
        id: 101,
        label: 'External Site',
        url: 'https://example.com',
        icon: 'external-link',
        type: 'external',
        position: 1,
        is_active: true,
        target: '_blank',
        children: [],
      }],
    }];
    render(<W><DesktopMenuItems menus={menus} /></W>);
    const link = screen.getByText('External Site').closest('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});

describe('MobileMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><MobileMenuItems menus={[]} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('renders menu items', () => {
    render(
      <W><MobileMenuItems menus={sampleMenus} /></W>,
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Listings')).toBeInTheDocument();
  });

  it('renders divider items', () => {
    const menus: ApiMenu[] = [{
      id: 1,
      name: 'Test',
      location: 'mobile',
      items: [
        { id: 101, label: 'Item', url: '/item', icon: 'star', type: 'link', position: 1, is_active: true, target: '_self', children: [] },
        { id: 102, label: '', url: '', icon: '', type: 'divider', position: 2, is_active: true, target: '_self', children: [] },
      ],
    }];
    const { container } = render(<W><MobileMenuItems menus={menus} /></W>);
    expect(container.querySelector('.border-t')).toBeTruthy();
  });

  it('renders dropdown children flat on mobile', () => {
    const menus: ApiMenu[] = [{
      id: 1,
      name: 'Test',
      location: 'mobile',
      items: [{
        id: 101,
        label: 'More',
        url: '#',
        icon: 'more-horizontal',
        type: 'dropdown',
        position: 1,
        is_active: true,
        target: '_self',
        children: [
          { id: 201, label: 'Child A', url: '/child-a', icon: 'star', type: 'link', position: 1, is_active: true, target: '_self', children: [] },
          { id: 202, label: 'Child B', url: '/child-b', icon: 'heart', type: 'link', position: 2, is_active: true, target: '_self', children: [] },
        ],
      }],
    }];
    render(<W><MobileMenuItems menus={menus} /></W>);
    expect(screen.getByText('Child A')).toBeInTheDocument();
    expect(screen.getByText('Child B')).toBeInTheDocument();
  });
});
