// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { getFormattingLocale } from '@/lib/helpers';
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
