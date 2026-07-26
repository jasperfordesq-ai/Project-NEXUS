// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { Breadcrumbs } from './Breadcrumbs';

// Breadcrumbs imports useTenant from '@/contexts/TenantContext' by its DIRECT
// path, so the override has to live on that specifier — a '@/contexts' barrel
// mock is never consulted and the real provider-backed hook would throw.
// Partial mock so TenantProvider and the sibling hooks stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: vi.fn(() => ({
    tenantPath: vi.fn((p: string) => `/test${p}`),
  })),
}));

describe('Breadcrumbs', () => {
  it('renders nothing when items array is empty', () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container.querySelector('nav')).not.toBeInTheDocument();
  });

  it('renders breadcrumb items', () => {
    render(
      <Breadcrumbs items={[
        { label: 'Listings', href: '/listings' },
        { label: 'My Listing' },
      ]} />
    );
    expect(screen.getByText('Listings')).toBeInTheDocument();
    expect(screen.getByText('My Listing')).toBeInTheDocument();
  });

  it('renders home icon by default', () => {
    render(
      <Breadcrumbs items={[{ label: 'Page' }]} />
    );
    expect(screen.getByLabelText('Home')).toBeInTheDocument();
  });

  it('hides home icon when showHome is false', () => {
    render(
      <Breadcrumbs items={[{ label: 'Page' }]} showHome={false} />
    );
    expect(screen.queryByLabelText('Home')).not.toBeInTheDocument();
  });

  it('marks last item as current page', () => {
    render(
      <Breadcrumbs items={[
        { label: 'Listings', href: '/listings' },
        { label: 'Current' },
      ]} />
    );
    const currentItem = screen.getByText('Current');
    expect(currentItem).toHaveAttribute('aria-current', 'page');
  });

  it('renders links for non-last items with href', () => {
    render(
      <Breadcrumbs items={[
        { label: 'Listings', href: '/listings' },
        { label: 'Detail' },
      ]} />
    );
    const link = screen.getByText('Listings');
    expect(link.tagName).toBe('A');
  });

  it('has nav element with breadcrumb aria-label', () => {
    render(
      <Breadcrumbs items={[{ label: 'Page' }]} />
    );
    expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument();
  });
});
