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

// ─── Helpers mock (resolveAvatarUrl) ─────────────────────────────────────────
vi.mock('@/lib/helpers', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...orig,
    resolveAvatarUrl: (url: string | undefined) => url || '',
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

// ─── GlassCard: NOT stubbed ───────────────────────────────────────────────────
// FriendsWidget imports it from the DIRECT path '@/components/ui/GlassCard', so a
// '@/components/ui' barrel override would be dead. The real one renders
//   <div class="card card--default glass-card p-4 …" data-slot="card">
const CARD = '.glass-card';

// ─── Avatar: narrow DIRECT-PATH mock ─────────────────────────────────────────
// Mocked on the path the widget actually imports, and only because the real
// HeroUI v3 Avatar is Radix-backed: <Avatar.Image> is committed to the DOM only
// once the image has loaded, and jsdom never loads images — so the real component
// renders nothing but its initials fallback and the resolved `src` is
// unobservable. "passes avatar src to the Avatar component" below asserts exactly
// that wiring, so the prop has to stay inspectable.
vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name, src }: { name?: string; src?: string }) => (
    <div data-testid="avatar" data-name={name} data-src={src} />
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
import type { Friend } from './FriendsWidget';

const makeFriend = (overrides: Partial<Friend> = {}): Friend => ({
  id: 1,
  name: 'Carol Brennan',
  avatar_url: undefined,
  location: undefined,
  is_online: false,
  is_recent: false,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FriendsWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when friends array is empty', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    const { container } = render(<FriendsWidget friends={[]} />);
    expect(container.querySelector(CARD)).toBeNull();
    // …and none of the copy it would otherwise render.
    expect(screen.queryByText('Friends')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the widget heading when friends are provided', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    const { container } = render(<FriendsWidget friends={[makeFriend()]} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Friends');
    // The heading lives inside the real GlassCard, not beside it.
    expect(container.querySelector(CARD)).toContainElement(heading);
  });

  it('renders a "See All" link pointing to the tenant connections path', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend()]} />);
    const link = screen.getByRole('link', { name: /see all/i });
    expect(link).toHaveAttribute('href', '/test/connections');
  });

  it('renders the friend name', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ name: 'Dave Murphy' })]} />);
    // Exactly one rendering of the name — getByText throws on 0 or 2+.
    expect(screen.getByText('Dave Murphy')).toBeInTheDocument();
  });

  it('links each friend to their profile page', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ id: 7 }), makeFriend({ id: 12, name: 'Eve' })]} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/profile/7');
    expect(hrefs).toContain('/test/profile/12');
  });

  it('renders friend location when provided', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ location: 'Cork, Ireland' })]} />);
    expect(screen.getByText('Cork, Ireland')).toBeInTheDocument();
  });

  it('does not render location paragraph when location is absent', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ location: undefined })]} />);
    // Positive precondition: the row DID render, so the absence below is not vacuous.
    const name = screen.getByText('Carol Brennan');
    expect(name).toBeInTheDocument();
    expect(screen.queryByText('Cork, Ireland')).toBeNull();
    // The name <p> is the only child of the text column — no sibling location <p>.
    expect(name.parentElement!.children).toHaveLength(1);
  });

  it('renders an online indicator with aria-label for online friends', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ is_online: true })]} />);
    const indicator = screen.getByLabelText(/online now/i);
    expect(indicator).toBeInTheDocument();
  });

  it('renders an active-today indicator for recently-active friends', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ is_recent: true, is_online: false })]} />);
    const indicator = screen.getByLabelText(/active today/i);
    expect(indicator).toBeInTheDocument();
  });

  it('does not render any status indicator for offline, non-recent friends', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ is_online: false, is_recent: false })]} />);
    // Positive precondition: the friend row rendered, so the absences below cannot pass vacuously.
    expect(screen.getByText('Carol Brennan')).toBeInTheDocument();
    expect(screen.queryByLabelText(/online now/i)).toBeNull();
    expect(screen.queryByLabelText(/active today/i)).toBeNull();
  });

  it('renders multiple friends', async () => {
    const friends = [
      makeFriend({ id: 1, name: 'Alice' }),
      makeFriend({ id: 2, name: 'Bob' }),
      makeFriend({ id: 3, name: 'Carol' }),
    ];
    const { FriendsWidget } = await import('./FriendsWidget');
    const { container } = render(<FriendsWidget friends={friends} />);
    // Exactly one row per friend, each naming its friend once.
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="avatar"]')).toHaveLength(3);
  });

  it('passes avatar src to the Avatar component', async () => {
    const { FriendsWidget } = await import('./FriendsWidget');
    render(<FriendsWidget friends={[makeFriend({ avatar_url: 'https://example.com/avatar.jpg' })]} />);
    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveAttribute('data-src', 'https://example.com/avatar.jpg');
    expect(avatar).toHaveAttribute('data-name', 'Carol Brennan');
  });
});
