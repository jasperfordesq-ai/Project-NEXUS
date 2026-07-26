// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── API mock (not used directly by this component, but required by the module graph) ──
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
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockTenantPath = vi.fn((p: string) => `/test${p}`);

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: mockTenantPath,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── NO barrel mock of '@/components/ui' ──────────────────────────────────────
// The widget imports GlassCard, Avatar and Button from their DIRECT module paths
// ('@/components/ui/GlassCard' etc.), so overrides on the '@/components/ui' barrel
// never apply — the real components load either way. Real DOM they emit:
//   GlassCard      -> <div class="card card--default glass-card p-4 …" data-slot="card">
//   Avatar         -> <span class="avatar avatar--sm">
//                       <span class="avatar__fallback …" data-slot="avatar-fallback">D</span>
//                     </span>
//                     (jsdom never loads images, so the Radix-backed Avatar shows
//                      its initials fallback rather than an <img>)
//   Button as={Link}-> <a class="button button--tertiary button--sm …" href="…">View</a>
//                     (a plain anchor — it carries NO explicit role="link" attribute)
const CARD = '.glass-card';
const AVATAR = '.avatar';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeMember = (overrides = {}) => ({
  id: 10,
  name: 'Bob Builder',
  avatar_url: undefined,
  location: 'Dublin',
  is_online: false,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PeopleYouMayKnowWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing when members array is empty', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    const { container } = render(<PeopleYouMayKnowWidget members={[]} />);
    // The component returns null — no GlassCard is mounted
    expect(container.querySelector(CARD)).toBeNull();
    expect(screen.queryByText('People You May Know')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the widget heading when members are provided', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember()]} />);
    expect(screen.getByText('People You May Know')).toBeInTheDocument();
  });

  it('renders a "See All" link pointing to the members page', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember()]} />);
    const seeAll = screen.getByText('See All');
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/members');
  });

  it('renders a row for each member', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    const members = [
      makeMember({ id: 1, name: 'Alice' }),
      makeMember({ id: 2, name: 'Charlie' }),
    ];
    render(<PeopleYouMayKnowWidget members={members} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('renders an avatar for each member', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    const { container } = render(
      <PeopleYouMayKnowWidget members={[makeMember({ id: 1, name: 'Dana' }), makeMember({ id: 2, name: 'Eve Ryan' })]} />
    );
    const avatars = Array.from(container.querySelectorAll(AVATAR));
    // Exactly one avatar per member, each showing that member's initials.
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveTextContent(/^D$/);
    expect(avatars[1]).toHaveTextContent(/^ER$/);
  });

  it('shows the member location when provided', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember({ location: 'Cork' })]} />);
    expect(screen.getByText('Cork')).toBeInTheDocument();
  });

  it('does not show a location paragraph when location is absent', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember({ location: undefined })]} />);
    // Only the "People You May Know" heading + "See All" + "View" text — no location text
    expect(screen.queryByText('Dublin')).not.toBeInTheDocument();
  });

  it('renders an online indicator for online members', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember({ is_online: true })]} />);
    // The online dot has aria-label "Online now"
    expect(screen.getByLabelText('Online now')).toBeInTheDocument();
  });

  it('does not render online indicator for offline members', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember({ is_online: false })]} />);
    expect(screen.queryByLabelText('Online now')).not.toBeInTheDocument();
  });

  it('renders a View link pointing to the member profile', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    render(<PeopleYouMayKnowWidget members={[makeMember({ id: 42 })]} />);
    // Multiple links point to /profile/42 (avatar link + name link + View button)
    const links = screen.getAllByRole('link');
    const profileLinks = links.filter((el) =>
      el.getAttribute('href')?.includes('/profile/42') ||
      el.getAttribute('to')?.includes('/profile/42')
    );
    expect(profileLinks.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('renders multiple members from a list of three', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    const members = [
      makeMember({ id: 1, name: 'Alice' }),
      makeMember({ id: 2, name: 'Bob' }),
      makeMember({ id: 3, name: 'Carol' }),
    ];
    render(<PeopleYouMayKnowWidget members={members} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('wraps content in the GlassCard', async () => {
    const { PeopleYouMayKnowWidget } = await import('./PeopleYouMayKnowWidget');
    const { container } = render(<PeopleYouMayKnowWidget members={[makeMember()]} />);
    const card = container.querySelector(CARD);
    expect(card).not.toBeNull();
    expect(card).toHaveClass('glass-card', 'p-4');
    // Heading and member row are nested INSIDE the card, not siblings of it.
    expect(card).toContainElement(screen.getByText('People You May Know'));
    expect(card).toContainElement(screen.getByText('Bob Builder'));
  });
});
