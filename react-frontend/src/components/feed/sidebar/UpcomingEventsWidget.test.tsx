// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock (not used directly by widget but required pattern) ───────────────
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

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeEvent = (overrides = {}) => ({
  id: 101,
  title: 'Community Meetup',
  start_time: '2026-10-04 09:00:00',
  location: 'Dublin City Hall',
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('UpcomingEventsWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing (no heading, no links) when events array is empty', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[]} />);
    // Component returns null — no heading or event links rendered
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the widget heading when events are provided', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent()]} />);
    // i18n key: feed:sidebar.events.title — resolves to English in test env
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('renders event titles', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent()]} />);
    expect(screen.getByText('Community Meetup')).toBeInTheDocument();
  });

  it('renders multiple event titles', async () => {
    const events = [
      makeEvent({ id: 1, title: 'First Event' }),
      makeEvent({ id: 2, title: 'Second Event' }),
    ];
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={events} />);
    expect(screen.getByText('First Event')).toBeInTheDocument();
    expect(screen.getByText('Second Event')).toBeInTheDocument();
  });

  it('renders event location when provided', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent()]} />);
    expect(screen.getByText('Dublin City Hall')).toBeInTheDocument();
  });

  it('does not render location element when location is absent', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent({ location: undefined })]} />);
    expect(screen.queryByText('Dublin City Hall')).not.toBeInTheDocument();
  });

  it('links each event to the correct tenant-scoped path', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent({ id: 101 })]} />);
    const links = screen.getAllByRole('link');
    const eventLink = links.find((l) => l.getAttribute('href')?.includes('/events/101'));
    expect(eventLink).toBeDefined();
  });

  it('renders a "See all" link to the events index', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent()]} />);
    const links = screen.getAllByRole('link');
    const seeAll = links.find((l) => l.getAttribute('href')?.includes('/events') && !l.getAttribute('href')?.includes('/events/'));
    expect(seeAll).toBeDefined();
  });

  it('renders formatted month label for the event date', async () => {
    // start_time = 2026-10-04 => month short label should be "Oct" (or locale equiv)
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent({ start_time: '2026-10-04 09:00:00' })]} />);
    // The month abbreviation is the first line of the date card.
    const monthEl = screen.getByTestId('upcoming-event-date').querySelector('span');
    expect(monthEl).not.toBeNull();
    expect(monthEl!.textContent?.length).toBeGreaterThan(0);
  });

  // Warmth plan W1 (10 Nov 2026): events are one colour everywhere — here too.
  it('shows the date card in the event colour used across the site', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    const { kindColour } = await import('@/components/feed/feedTypeColours');
    render(<UpcomingEventsWidget events={[makeEvent({ start_time: '2026-10-04 09:00:00' })]} />);
    const card = screen.getByTestId('upcoming-event-date');
    for (const cls of kindColour('event').label.split(' ')) expect(card.className).toContain(cls);
  });

  it('renders day of month for the event date', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent({ start_time: '2026-10-04 09:00:00' })]} />);
    // Day "4" should appear inside a bold span within the date card
    const dayEl = document.querySelector('span.text-sm.font-bold');
    expect(dayEl).not.toBeNull();
    expect(dayEl!.textContent).toMatch(/4/);
  });

  it('renders correct number of event link rows', async () => {
    const events = [
      makeEvent({ id: 1, title: 'Alpha' }),
      makeEvent({ id: 2, title: 'Beta' }),
      makeEvent({ id: 3, title: 'Gamma' }),
    ];
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={events} />);
    // Each event renders as a Link — find by event hrefs
    const eventLinks = screen.getAllByRole('link').filter(
      (l) => /\/events\/\d+$/.test(l.getAttribute('href') || ''),
    );
    expect(eventLinks).toHaveLength(3);
  });

  it('applies tenantPath to links correctly', async () => {
    const { UpcomingEventsWidget } = await import('./UpcomingEventsWidget');
    render(<UpcomingEventsWidget events={[makeEvent({ id: 42 })]} />);
    const links = screen.getAllByRole('link');
    const eventLink = links.find((l) => l.getAttribute('href') === '/test/events/42');
    expect(eventLink).toBeDefined();
  });
});
