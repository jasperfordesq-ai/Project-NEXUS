// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { getFormattingLocale } from '@/lib/helpers';
import { colourForSeed, paletteFor } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import { createCanonicalEventFixture, renderEventRoute } from '@/test/events-test-harness';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (path: string) => `/test${path}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/proximity/ProximityFilter', () => ({
  ProximityFilter: () => null,
}));
vi.mock('./components/CalendarSubscriptionPanel', () => ({
  CalendarSubscriptionPanel: () => null,
}));

// The calendar views own their own date range and fetch; stub them so the
// month/agenda assertions below are about EventsPage's sticky bar, not HeroUI's
// Calendar. List view (every other test) never renders this.
vi.mock('./components/EventCalendarViews', () => ({
  EventCalendarViews: ({ view }: { view: string }) => <div data-testid={`calendar-${view}`} />,
}));

/**
 * Toggle the phone layout. `src/test/setup.ts` stubs matchMedia to answer
 * `matches: false` for EVERY query, so without this mock `isPhone` is always
 * false and the phone branch would get zero coverage. EventsPage only asks a
 * max-width query; min-width answers are negated so no impossible viewport can
 * be produced if one is ever added.
 */
let isPhoneViewport = false;
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn((query: string) =>
    query.includes('min-width') ? !isPhoneViewport : isPhoneViewport,
  ),
}));

import { EventsPage } from './EventsPage';

async function renderLoadedEventsPage() {
  renderEventRoute(<EventsPage />);

  await waitFor(() => {
    expect(mockApi.get).toHaveBeenCalledWith(
      expect.stringContaining('/v2/events?'),
      expect.objectContaining({ headers: expect.any(Headers), signal: expect.any(AbortSignal) }),
    );
  });
  await screen.findByRole('heading', { name: 'No events found' });
}

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPhoneViewport = false;
    mockApi.get.mockResolvedValue({
      success: true,
      data: [],
      meta: { has_more: false, total_items: 0 },
    });
  });

  it('renders the Events page heading', async () => {
    await renderLoadedEventsPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
  });

  it('shows the page description', async () => {
    await renderLoadedEventsPage();

    expect(screen.getAllByText(/Find local workshops, gatherings, and community events near you/i).length)
      .toBeGreaterThan(0);
  });

  it('exposes an accessible event search field', async () => {
    await renderLoadedEventsPage();

    expect(screen.getByRole('searchbox', { name: 'Search events' })).toBeInTheDocument();
  });

  it('loads the structured step-free venue filter from the URL', async () => {
    renderEventRoute(<EventsPage />, { route: '/test/events?step_free=yes' });

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('step_free=yes'),
        expect.objectContaining({ headers: expect.any(Headers), signal: expect.any(AbortSignal) }),
      );
    });

    expect(screen.getByRole('button', { name: /Step-free venue access/ })).toBeInTheDocument();
    expect(screen.getAllByText('Step-free access confirmed').length).toBeGreaterThan(0);
  });

  it('shows tenant-aware Create Event links for authenticated users', async () => {
    await renderLoadedEventsPage();

    const createLinks = screen.getAllByRole('link', { name: 'Create Event' });
    expect(createLinks.length).toBeGreaterThan(0);
    expect(createLinks[0]).toHaveAttribute('href', '/test/events/create');
  });

  it('keeps card day and time aligned to the event timezone', async () => {
    const event = createCanonicalEventFixture({
      schedule: {
        ...createCanonicalEventFixture().schedule,
        start_at: '2026-07-11T00:30:00+00:00',
        end_at: '2026-07-11T01:30:00+00:00',
        timezone: 'America/Los_Angeles',
        all_day: false,
      },
    });
    mockApi.get.mockResolvedValue({
      success: true,
      data: [event],
      meta: { has_more: false, total_items: 1 },
    });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    const locale = getFormattingLocale();
    const start = new Date('2026-07-11T00:30:00+00:00');
    const expectedTime = start.toLocaleString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'short',
    });
    const expectedDay = start.toLocaleDateString(locale, {
      day: 'numeric',
      timeZone: 'America/Los_Angeles',
    });

    expect(screen.getByText(expectedTime)).toBeInTheDocument();
    expect(screen.getByText(expectedDay)).toBeInTheDocument();
  });

  // Unpublished events reach the list only for their own organiser (and tenant
  // admins). Without a state chip a freshly created draft is indistinguishable
  // from a live event, which is how drafts came to look lost.
  it('shows the faces of a few members going, and names them for screen readers', async () => {
    const event = createCanonicalEventFixture({
      going_preview: [
        { id: 31, name: 'Maeve', avatar_url: null },
        { id: 32, name: 'Tom', avatar_url: null },
      ],
      metrics: { ...createCanonicalEventFixture().metrics, confirmed_count: 12 },
    });
    mockApi.get.mockResolvedValue({ success: true, data: [event], meta: { has_more: false, total_items: 1 } });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    expect(screen.getAllByTestId('event-going-face')).toHaveLength(2);
    expect(screen.getByText('12 going')).toBeInTheDocument();
    expect(screen.getByText(/including Maeve and Tom/)).toHaveClass('sr-only');
  });

  it('colours the date tile by the kind of event, from the community palette, not always amber', async () => {
    const withCategory = createCanonicalEventFixture({
      id: 41,
      title: 'Repair Cafe',
      category: { id: 7, name: 'Skills', slug: 'skills', colour: null },
    });
    const sameCategory = createCanonicalEventFixture({
      id: 42,
      title: 'Bike Clinic',
      category: { id: 7, name: 'Skills', slug: 'skills', colour: null },
    });
    mockApi.get.mockResolvedValue({ success: true, data: [withCategory, sameCategory], meta: { has_more: false, total_items: 2 } });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Repair Cafe' });

    const tiles = screen.getAllByTestId('event-date-tile');
    expect(tiles).toHaveLength(2);
    // The same seed Explore uses, so an event wears one colour on both (W2).
    expect(tiles[0]).toHaveAttribute('data-colour', colourForSeed(coverSeed.event(41, 7), paletteFor(null)));
    // Events of the same kind share a colour.
    expect(tiles[1]).toHaveAttribute('data-colour', tiles[0]!.getAttribute('data-colour'));
    expect(tiles[0]!.className).not.toContain('amber');
  });

  // Warmth plan W3 (10 Nov 2026): two kinds of event could share a colour by
  // chance. The community's event categories now share the palette out in id
  // order, so kinds side by side never match until the palette runs out.
  it('never gives two kinds of event the same colour by chance', async () => {
    const repair = createCanonicalEventFixture({ id: 41, title: 'Repair Cafe', category: { id: 7, name: 'Skills', slug: 'skills', colour: null } });
    const choir = createCanonicalEventFixture({ id: 42, title: 'Choir', category: { id: 8, name: 'Music', slug: 'music', colour: null } });
    mockApi.get.mockImplementation((url: string) => (url.startsWith('/v2/categories')
      ? Promise.resolve({ success: true, data: [{ id: 8, color: 'blue' }, { id: 7, color: 'blue' }] })
      : Promise.resolve({ success: true, data: [repair, choir], meta: { has_more: false, total_items: 2 } })));

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Repair Cafe' });

    const palette = paletteFor(null);
    await waitFor(() => expect(screen.getAllByTestId('event-date-tile')[0]).toHaveAttribute('data-colour', palette[0]));
    expect(screen.getAllByTestId('event-date-tile')[1]).toHaveAttribute('data-colour', palette[1]);
  });

  // Checked in a browser (10 Nov 2026): the date tile had its kind's colour,
  // but the kind's name beside the title and the filter buttons stayed grey.
  it('shows the kind of event in its colour beside the title and on its filter button', async () => {
    const repair = createCanonicalEventFixture({ id: 41, title: 'Repair Cafe', category: { id: 7, name: 'Skills', slug: 'skills', colour: null } });
    const choir = createCanonicalEventFixture({ id: 42, title: 'Choir', category: { id: 8, name: 'Music', slug: 'music', colour: null } });
    mockApi.get.mockImplementation((url: string) => (url.startsWith('/v2/categories')
      ? Promise.resolve({ success: true, data: [{ id: 8, name: 'Music', slug: 'music', color: 'blue' }, { id: 7, name: 'Skills', slug: 'skills', color: 'blue' }] })
      : Promise.resolve({ success: true, data: [repair, choir], meta: { has_more: false, total_items: 2 } })));

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Repair Cafe' });

    const palette = paletteFor(null);
    await waitFor(() => expect(screen.getAllByTestId('event-category-label')[0]).toHaveAttribute('data-colour', palette[0]));
    const labels = screen.getAllByTestId('event-category-label');
    expect(labels[0]).toHaveTextContent('Skills');
    expect(labels[1]).toHaveAttribute('data-colour', palette[1]);
    expect(labels[0]!.className).toMatch(/bg-[a-z]+-100/);
    // The filter buttons, in the order the community lists its kinds.
    const marks = screen.getAllByTestId('event-category-filter-mark');
    expect(marks.map((mark) => mark.getAttribute('data-colour'))).toEqual([palette[1], palette[0]]);
    for (const mark of marks) expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  // The card shows the organiser as the event's own page does: the list sends
  // the same `organizer` object it sends that page, so nothing new is shown.
  it("shows the organiser's face on the card, and never their name", async () => {
    const event = createCanonicalEventFixture({ going_preview: [{ id: 31, name: 'Maeve', avatar_url: null }] });
    mockApi.get.mockResolvedValue({ success: true, data: [event], meta: { has_more: false, total_items: 1 } });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    const organiser = screen.getByTestId('event-organiser');
    expect(screen.getAllByTestId('event-organiser-face')).toHaveLength(1);
    // The face is decoration. 🔴 Surnames are private to non-admins (F-084,
    // E-122): the fixture's organiser is "Morgan Organiser", and neither the
    // surname nor its initial may reach the card.
    expect(screen.getByTestId('event-organiser-face').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(organiser.textContent ?? '').not.toContain('Organiser');
    expect(organiser.textContent ?? '').not.toMatch(/MO/);
    expect(document.body.textContent ?? '').not.toContain('Morgan Organiser');
    // The going faces are still only the people going.
    expect(screen.getAllByTestId('event-going-face')).toHaveLength(1);
  });

  it('shows no organiser on the card when the event has no organiser name', async () => {
    const base = createCanonicalEventFixture();
    const event = createCanonicalEventFixture({ organizer: { ...base.organizer, display_name: null } });
    mockApi.get.mockResolvedValue({ success: true, data: [event], meta: { has_more: false, total_items: 1 } });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    expect(screen.queryByTestId('event-organiser')).not.toBeInTheDocument();
  });

  it('shows no faces when nobody the member may see is going', async () => {
    const event = createCanonicalEventFixture({ going_preview: [] });
    mockApi.get.mockResolvedValue({ success: true, data: [event], meta: { has_more: false, total_items: 1 } });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    expect(screen.queryByTestId('event-going-face')).not.toBeInTheDocument();
    expect(screen.queryByText(/including/)).not.toBeInTheDocument();
  });

  it('badges a draft event card', async () => {
    const event = createCanonicalEventFixture({
      schedule: {
        ...createCanonicalEventFixture().schedule,
        publication_state: 'draft',
        state: 'draft',
      },
    });
    mockApi.get.mockResolvedValue({
      success: true,
      data: [event],
      meta: { has_more: false, total_items: 1 },
    });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    expect(screen.getByText('Draft event')).toBeInTheDocument();
  });

  it('badges a pending-review event card', async () => {
    const event = createCanonicalEventFixture({
      schedule: {
        ...createCanonicalEventFixture().schedule,
        publication_state: 'pending_review',
        state: 'pending_review',
      },
    });
    mockApi.get.mockResolvedValue({
      success: true,
      data: [event],
      meta: { has_more: false, total_items: 1 },
    });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Community Garden Day' });

    expect(screen.getByText('Pending review')).toBeInTheDocument();
  });

  it('formats a nearby event distance in the reader locale, not hard-coded English units', async () => {
    const near = { ...createCanonicalEventFixture(), distance_km: 0.35 };
    const far = { ...createCanonicalEventFixture({ id: 102, title: 'Riverside Walk' }), distance_km: 2.44 };
    mockApi.get.mockResolvedValue({
      success: true,
      data: [near, far],
      meta: { has_more: false, total_items: 2 },
    });

    renderEventRoute(<EventsPage />);
    await screen.findByRole('heading', { name: 'Riverside Walk' });

    const locale = getFormattingLocale();
    const metres = new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter', unitDisplay: 'short' }).format(350);
    const kilometres = new Intl.NumberFormat(locale, {
      style: 'unit', unit: 'kilometer', unitDisplay: 'short', minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(2.4);
    expect(screen.getByText(metres)).toBeInTheDocument();
    expect(screen.getByText(kilometres)).toBeInTheDocument();
  });

  describe('phone layout', () => {
    beforeEach(() => {
      isPhoneViewport = true;
    });

    it('replaces the hero and filter cards with one sticky bar', async () => {
      await renderLoadedEventsPage();

      // Sticky bar: search pill + Filters button + the three view switches.
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();
      expect(screen.getByText('Search events')).toBeInTheDocument();
      expect(screen.getByLabelText('List')).toBeInTheDocument();
      expect(screen.getByLabelText('Month')).toBeInTheDocument();
      expect(screen.getByLabelText('Agenda')).toBeInTheDocument();

      // Desktop chrome is gone: hero, "choose a view" card, inline search field,
      // step-free HeroSelect trigger and the category chip wall.
      // The VISIBLE hero is gone, but an <h1> deliberately remains and is
      // screen-reader-only: on phones the title moves into the app bar as plain
      // text, which is not a heading, so without this a phone user has nothing
      // to orient by. Asserted as sr-only rather than absent.
      expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toHaveClass('sr-only');
      expect(screen.queryByText('Choose a calendar view')).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox', { name: 'Search events' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Step-free venue access/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('radiogroup', { name: 'Filter by category' })).not.toBeInTheDocument();
    });

    it('keeps Create Event reachable once the hero is hidden', async () => {
      // A NON-EMPTY list is load-bearing here. PublicEmptyState renders its own
      // `Create Event` link with the same accessible name and the same href, so
      // against an empty list this assertion would still pass with the whole
      // phone action row deleted — and Create Event would silently vanish for
      // every phone user the moment one event exists. With events rendered the
      // action row is the ONLY source of the link, so the exact count pins it.
      mockApi.get.mockResolvedValue({
        success: true,
        data: [createCanonicalEventFixture()],
        meta: { has_more: false, total_items: 1 },
      });

      renderEventRoute(<EventsPage />);
      await screen.findByRole('heading', { name: 'Community Garden Day' });
      expect(screen.queryByRole('heading', { name: 'No events found' })).not.toBeInTheDocument();

      const createLinks = screen.getAllByRole('link', { name: 'Create Event' });
      expect(createLinks).toHaveLength(1);
      expect(createLinks[0]).toHaveAttribute('href', '/test/events/create');
    });

    it('opens the filter sheet with every filter section', async () => {
      await renderLoadedEventsPage();
      fireEvent.click(screen.getByLabelText('More filters'));

      await waitFor(() => {
        expect(screen.getByRole('radiogroup', { name: 'When' })).toBeInTheDocument();
      });
      expect(screen.getByRole('radiogroup', { name: 'Category' })).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Step-free venue access' })).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Radius' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Past' })).toBeInTheDocument();
      // /v2/events reports no total, so the footer must not claim a count.
      expect(screen.getByText('Show results')).toBeInTheDocument();
    });

    it('applies draft filters only when the footer button is pressed', async () => {
      await renderLoadedEventsPage();
      mockApi.get.mockClear();

      fireEvent.click(screen.getByLabelText('More filters'));
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'Past' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('radio', { name: 'Past' }));
      // Draft-only: no list refetch, and no count probe either.
      expect(mockApi.get).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('Show results'));
      await waitFor(() => {
        expect(mockApi.get).toHaveBeenCalledWith(
          expect.stringContaining('when=past'),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });
    });

    it('surfaces an applied filter as a removable chip in the bar', async () => {
      renderEventRoute(<EventsPage />, { route: '/test/events?step_free=yes' });

      const chip = await screen.findByLabelText('Remove filter: Step-free access confirmed');
      fireEvent.click(chip);

      await waitFor(() => {
        expect(screen.queryByLabelText('Remove filter: Step-free access confirmed')).not.toBeInTheDocument();
      });
    });

    it('collapses the bar to the view switcher in month view', async () => {
      await renderLoadedEventsPage();
      expect(screen.getByLabelText('More filters')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Month'));

      // EventCalendarViews reads only month/date/from/to, so a search pill and a
      // Filters button there would be dead controls.
      await waitFor(() => {
        expect(screen.getByTestId('calendar-month')).toBeInTheDocument();
      });
      expect(screen.queryByLabelText('More filters')).not.toBeInTheDocument();
      expect(screen.queryByText('Search events')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Month')).toBeInTheDocument();
    });
  });
});
