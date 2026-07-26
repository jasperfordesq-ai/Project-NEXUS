// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── API mock (required by test-utils chain; widget doesn't call API directly) ─
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(), post: vi.fn(), put: vi.fn(),
    patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── NO barrel mock of '@/components/ui' ──────────────────────────────────────
// The widget imports GlassCard and Chip from their DIRECT module paths
// ('@/components/ui/GlassCard', '@/components/ui/Chip'), so an override on the
// '@/components/ui' barrel never applies — the real components load either way.
// Real DOM those emit:
//   GlassCard -> <div class="card card--default glass-card p-4 …" data-slot="card">
//   Chip      -> <span class="chip chip--… " data-slot="chip">
//                  <span class="chip__label" data-slot="chip-label">Offer</span>
//                </span>
const CARD = '.glass-card';
const CHIP = '.chip';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
import type { SuggestedListing } from './SuggestedListingsWidget';

const makeOffer = (overrides: Partial<SuggestedListing> = {}): SuggestedListing => ({
  id: 1,
  title: 'Guitar Lessons',
  type: 'offer',
  owner_name: 'Alice Smith',
  ...overrides,
});

const makeRequest = (overrides: Partial<SuggestedListing> = {}): SuggestedListing => ({
  id: 2,
  title: 'Need a Plumber',
  type: 'request',
  owner_name: 'Bob Jones',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SuggestedListingsWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when listings array is empty', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    const { container } = render(<SuggestedListingsWidget listings={[]} />);
    // The widget returns null: no card, and none of the copy it would otherwise render.
    expect(container.querySelector(CARD)).toBeNull();
    expect(screen.queryByText('Suggested For You')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the widget heading when listings are provided', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    render(<SuggestedListingsWidget listings={[makeOffer()]} />);
    expect(screen.getByText('Suggested For You')).toBeInTheDocument();
  });

  it('renders a "See All" link pointing to the tenant listings path', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    render(<SuggestedListingsWidget listings={[makeOffer()]} />);
    const link = screen.getByRole('link', { name: /see all/i });
    expect(link).toHaveAttribute('href', '/test/listings');
  });

  it('renders each listing title', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    render(<SuggestedListingsWidget listings={[makeOffer(), makeRequest()]} />);
    expect(screen.getByText('Guitar Lessons')).toBeInTheDocument();
    expect(screen.getByText('Need a Plumber')).toBeInTheDocument();
  });

  it('renders owner name via by_owner translation', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    render(<SuggestedListingsWidget listings={[makeOffer()]} />);
    expect(screen.getByText(/Alice Smith/)).toBeInTheDocument();
  });

  it('links each listing to its tenant-scoped detail page', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    render(<SuggestedListingsWidget listings={[makeOffer({ id: 42 }), makeRequest({ id: 99 })]} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/listings/42');
    expect(hrefs).toContain('/test/listings/99');
  });

  it('shows an Offer chip for offer-type listings', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    const { container } = render(<SuggestedListingsWidget listings={[makeOffer()]} />);
    const chips = Array.from(container.querySelectorAll(CHIP));
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent(/^Offer$/);
  });

  it('shows a Request chip for request-type listings', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    const { container } = render(<SuggestedListingsWidget listings={[makeRequest()]} />);
    const chips = Array.from(container.querySelectorAll(CHIP));
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent(/^Request$/);
  });

  it('renders multiple listings correctly', async () => {
    const listings = [makeOffer({ id: 1 }), makeRequest({ id: 2 }), makeOffer({ id: 3, title: 'Yoga Classes' })];
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    render(<SuggestedListingsWidget listings={listings} />);
    expect(screen.getByText('Guitar Lessons')).toBeInTheDocument();
    expect(screen.getByText('Need a Plumber')).toBeInTheDocument();
    expect(screen.getByText('Yoga Classes')).toBeInTheDocument();
  });

  it('renders inside a GlassCard container', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    const { container } = render(<SuggestedListingsWidget listings={[makeOffer()]} />);
    const card = container.querySelector(CARD);
    expect(card).not.toBeNull();
    expect(card).toHaveClass('glass-card', 'p-4');
    // The heading and the listing row are nested INSIDE the card, not siblings of it.
    expect(card).toContainElement(screen.getByText('Suggested For You'));
    expect(card).toContainElement(screen.getByText('Guitar Lessons'));
  });

  it('does not render See All link when listings are empty', async () => {
    const { SuggestedListingsWidget } = await import('./SuggestedListingsWidget');
    const { container } = render(<SuggestedListingsWidget listings={[]} />);
    // Positive precondition: nothing rendered at all, so the absence below is not vacuous.
    expect(container.querySelector(CARD)).toBeNull();
    expect(screen.queryByRole('link', { name: /see all/i })).toBeNull();
  });
});
