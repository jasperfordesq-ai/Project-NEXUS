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

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockTenantPath = vi.fn((p: string) => `/test${p}`);

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: mockTenantPath,
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
const makeStats = (overrides = {}) => ({
  members: 120,
  listings: 45,
  events: 8,
  groups: 3,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CommunityPulseWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the Community Pulse heading', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    expect(screen.getByText('Community Pulse')).toBeInTheDocument();
  });

  it('renders all four stat labels', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Listings')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('renders the member count', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats({ members: 250 })} />);
    expect(screen.getByText('250')).toBeInTheDocument();
  });

  it('renders the listings count', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats({ listings: 77 })} />);
    expect(screen.getByText('77')).toBeInTheDocument();
  });

  it('renders the events count', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats({ events: 12 })} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders the groups count', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats({ groups: 5 })} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders four navigation links', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    const links = screen.getAllByRole('link');
    expect(links.length).toBe(4);
  });

  it('members link navigates to /members via tenantPath', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    const links = screen.getAllByRole('link');
    const membersLink = links.find((l) => l.getAttribute('href') === '/test/members');
    expect(membersLink).toBeInTheDocument();
  });

  it('listings link navigates to /listings', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    const links = screen.getAllByRole('link');
    const listingsLink = links.find((l) => l.getAttribute('href') === '/test/listings');
    expect(listingsLink).toBeInTheDocument();
  });

  it('events link navigates to /events', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    const links = screen.getAllByRole('link');
    const eventsLink = links.find((l) => l.getAttribute('href') === '/test/events');
    expect(eventsLink).toBeInTheDocument();
  });

  it('groups link navigates to /groups', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={makeStats()} />);
    const links = screen.getAllByRole('link');
    const groupsLink = links.find((l) => l.getAttribute('href') === '/test/groups');
    expect(groupsLink).toBeInTheDocument();
  });

  it('handles zero counts without crashing', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    render(<CommunityPulseWidget stats={{ members: 0, listings: 0, events: 0, groups: 0 }} />);
    // toLocaleString of 0 is "0"
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(4);
  });

  it('wraps content in the GlassCard', async () => {
    const { CommunityPulseWidget } = await import('./CommunityPulseWidget');
    const { container } = render(<CommunityPulseWidget stats={makeStats()} />);
    const card = container.querySelector(CARD);
    expect(card).not.toBeNull();
    expect(card).toHaveClass('glass-card', 'p-4');
    // Heading and all four stat tiles are nested INSIDE the card, not siblings of it.
    expect(card).toContainElement(screen.getByText('Community Pulse'));
    screen.getAllByRole('link').forEach((link) => expect(card).toContainElement(link));
  });
});
