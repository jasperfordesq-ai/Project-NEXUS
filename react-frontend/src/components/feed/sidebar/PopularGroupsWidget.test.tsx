// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── API mock ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(), post: vi.fn(), put: vi.fn(),
    patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Helpers mock (resolveAssetUrl) ──────────────────────────────────────────
vi.mock('@/lib/helpers', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...orig,
    resolveAssetUrl: (url: string | null | undefined) => url || '',
  };
});

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
// The widget imports GlassCard from its DIRECT module path
// ('@/components/ui/GlassCard'), so an override on the '@/components/ui' barrel
// never applies — the real GlassCard loads either way and renders
//   <div class="card card--default glass-card p-4 …" data-slot="card">
const CARD = '.glass-card';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
import type { PopularGroup } from './PopularGroupsWidget';

const makeGroup = (overrides: Partial<PopularGroup> = {}): PopularGroup => ({
  id: 1,
  name: 'Gardening Club',
  image_url: undefined,
  member_count: 42,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PopularGroupsWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when groups array is empty', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    const { container } = render(<PopularGroupsWidget groups={[]} />);
    expect(container.querySelector(CARD)).toBeNull();
    // …and none of the copy it would otherwise render.
    expect(screen.queryByText('Popular Groups')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the widget heading when groups are provided', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup()]} />);
    expect(screen.getByText('Popular Groups')).toBeInTheDocument();
  });

  it('renders a "See All" link pointing to the tenant groups path', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup()]} />);
    const link = screen.getByRole('link', { name: /see all/i });
    expect(link).toHaveAttribute('href', '/test/groups');
  });

  it('renders each group name', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup({ name: 'Knitting Circle' }), makeGroup({ id: 2, name: 'Chess Club' })]} />);
    expect(screen.getByText('Knitting Circle')).toBeInTheDocument();
    expect(screen.getByText('Chess Club')).toBeInTheDocument();
  });

  it('renders the member count', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup({ member_count: 128 })]} />);
    // Translation: "{{count}} members" → "128 members"
    expect(screen.getByText(/128/)).toBeInTheDocument();
  });

  it('links each group to its tenant-scoped detail page', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup({ id: 5 }), makeGroup({ id: 20, name: 'Yoga' })]} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/groups/5');
    expect(hrefs).toContain('/test/groups/20');
  });

  it('renders a group image when image_url is provided', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup({ image_url: 'https://example.com/group.jpg' })]} />);
    const img = screen.getByRole('img', { name: 'Gardening Club' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/group.jpg');
  });

  it('does not render an img element when image_url is absent', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={[makeGroup({ image_url: undefined })]} />);
    // Positive precondition: the group row rendered, so the absence below is not vacuous.
    expect(screen.getByText('Gardening Club')).toBeInTheDocument();
    // No img element — fallback lucide icon renders instead
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders inside a GlassCard container', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    const { container } = render(<PopularGroupsWidget groups={[makeGroup()]} />);
    const card = container.querySelector(CARD);
    expect(card).not.toBeNull();
    expect(card).toHaveClass('glass-card', 'p-4');
    // Heading and group row are nested INSIDE the card, not siblings of it.
    expect(card).toContainElement(screen.getByText('Popular Groups'));
    expect(card).toContainElement(screen.getByText('Gardening Club'));
  });

  it('renders multiple groups with correct links and names', async () => {
    const groups = [
      makeGroup({ id: 1, name: 'Book Club', member_count: 10 }),
      makeGroup({ id: 2, name: 'Runners', member_count: 55 }),
      makeGroup({ id: 3, name: 'Art Circle', member_count: 23 }),
    ];
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    render(<PopularGroupsWidget groups={groups} />);
    expect(screen.getByText('Book Club')).toBeInTheDocument();
    expect(screen.getByText('Runners')).toBeInTheDocument();
    expect(screen.getByText('Art Circle')).toBeInTheDocument();
    expect(screen.getByText(/55/)).toBeInTheDocument();
  });

  it('does not render the "See All" link when groups is empty', async () => {
    const { PopularGroupsWidget } = await import('./PopularGroupsWidget');
    const { container } = render(<PopularGroupsWidget groups={[]} />);
    // Nothing rendered at all, so the absence below is not vacuous.
    expect(container.querySelector(CARD)).toBeNull();
    expect(screen.queryByRole('link', { name: /see all/i })).toBeNull();
  });
});
