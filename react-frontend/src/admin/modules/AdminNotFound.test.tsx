// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock (not used by this component but pattern-standard) ───────────────
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

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Hooks ────────────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub admin layout components (heavy sidebar etc.) ───────────────────────
// 🔴 AdminNotFound.tsx imports PageHeader from '../components/PageHeader' — the
// component's OWN path, not the '@/admin/components' barrel. Vitest keys its mock
// registry per resolved module, so the barrel override alone installed nothing:
// the real PageHeader rendered, without the data-testid this suite asserts, and
// the header test read as a missing header. Mock the direct path too.
const PageHeaderStub = ({ title, description }: { title?: string; description?: string }) => (
  <div data-testid="page-header">
    {title && <h1>{title}</h1>}
    {description && <p>{description}</p>}
  </div>
);

vi.mock('@/admin/components/PageHeader', () => ({
  PageHeader: PageHeaderStub,
  default: PageHeaderStub,
}));

vi.mock('@/admin/components', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/admin/components')>();
  return {
    ...orig,
    PageHeader: PageHeaderStub,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AdminNotFound', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the page header with the correct title', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
    expect(screen.getByText('Not Found')).toBeInTheDocument();
  });

  it('renders the "Page Not Found" heading', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  });

  it('renders the descriptive error message', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    expect(
      screen.getByText('The page you are looking for does not exist')
    ).toBeInTheDocument();
  });

  it('renders a "Back to Dashboard" link', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    const link = screen.getByRole('link', { name: /back to dashboard/i });
    expect(link).toBeInTheDocument();
  });

  it('back link points to the admin path for the current tenant', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    const link = screen.getByRole('link', { name: /back to dashboard/i });
    expect(link).toHaveAttribute('href', '/hour-timebank/admin');
  });

  it('renders a visual icon container (danger-coloured background)', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    const { container } = render(<AdminNotFound />);
    // The icon wrapper has a specific bg-danger/10 class
    const iconWrapper = container.querySelector('.bg-danger\\/10');
    expect(iconWrapper).toBeInTheDocument();
  });

  it('does not render any spinner or loading indicator', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    // The page is fully static — no aria-busy spinners
    const spinners = screen
      .queryAllByRole('status')
      .filter((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinners).toHaveLength(0);
  });

  it('renders only one back-link (no duplicate navigation)', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    const links = screen.getAllByRole('link', { name: /back to dashboard/i });
    expect(links).toHaveLength(1);
  });

  it('renders inside a card wrapper', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    const { container } = render(<AdminNotFound />);
    // HeroUI Card renders with data-slot="base" or at minimum a containing div
    // The component wraps content in a Card > CardBody
    expect(container.firstChild).toBeInTheDocument();
  });

  it('contains "Page Not Found" text in a heading level element', async () => {
    const { AdminNotFound } = await import('./AdminNotFound');
    render(<AdminNotFound />);
    const heading = screen.getByRole('heading', { name: /page not found/i });
    expect(heading).toBeInTheDocument();
  });
});
