// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContexts } from '@/test/mock-contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { renderEventRoute } from '@/test/events-test-harness';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    showToast: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (path: string) => `/test${path}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

import { EventsAdmin } from './EventsAdmin';

const MOCK_EVENT = {
  id: 1,
  title: 'Community Swap Meet',
  start_date: '2030-07-01T10:00:00Z',
  location: 'Town Hall',
  organizer_name: 'Alice Admin',
  status: 'published',
  publication_state: 'published' as const,
  operational_state: 'scheduled' as const,
  lifecycle_version: 2,
  attendees_count: 20,
  max_attendees: 50,
  created_at: '2026-06-01T00:00:00Z',
};

const MOCK_EVENT_2 = {
  id: 2,
  title: 'Gardening Club',
  start_date: '2030-08-01T09:00:00Z',
  location: null,
  organizer_name: null,
  status: 'cancelled',
  publication_state: 'published' as const,
  operational_state: 'cancelled' as const,
  lifecycle_version: 4,
  attendees_count: 5,
  max_attendees: null,
  created_at: '2026-06-02T00:00:00Z',
};

const MOCK_RECURRING_EVENT = {
  ...MOCK_EVENT,
  id: 3,
  title: 'Weekly Repair Café',
  is_recurring_template: true,
  series: {
    root_event_id: 3,
    is_recurring: true,
    occurrence_count: 12,
    future_occurrence_count: 7,
  },
};

function eventListResponse(events = [MOCK_EVENT]) {
  return {
    success: true,
    data: events,
    meta: { total: events.length },
  };
}

async function renderLoadedAdmin(events = [MOCK_EVENT]) {
  mockApi.get.mockResolvedValue(eventListResponse(events));
  renderEventRoute(<EventsAdmin />, { route: '/admin/events', path: '/admin/events' });

  if (events.length > 0) {
    await screen.findByText(events[0].title);
  } else {
    await screen.findByRole('heading', { name: 'No events found' });
  }
}

describe('EventsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an accessible loading status while fetching', async () => {
    let resolveRequest!: (value: ReturnType<typeof eventListResponse>) => void;
    const request = new Promise<ReturnType<typeof eventListResponse>>((resolve) => {
      resolveRequest = resolve;
    });
    mockApi.get.mockReturnValue(request);

    renderEventRoute(<EventsAdmin />, { route: '/admin/events', path: '/admin/events' });

    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      resolveRequest(eventListResponse([]));
    });
    await screen.findByRole('heading', { name: 'No events found' });
  });

  it('renders event rows after data loads', async () => {
    await renderLoadedAdmin([MOCK_EVENT, MOCK_EVENT_2]);

    const firstRowHeader = screen.getByRole('rowheader', { name: 'Community Swap Meet' });
    expect(firstRowHeader).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Gardening Club' })).toBeInTheDocument();
    const firstRow = firstRowHeader.closest('[role="row"]');
    expect(firstRow).not.toBeNull();
    expect(within(firstRow!).getByRole('link', { name: 'View Event' })).toHaveAttribute(
      'href',
      '/test/events/1',
    );
  });

  it('honours a pending-review deep link from moderation notifications', async () => {
    mockApi.get.mockResolvedValue(eventListResponse([]));

    renderEventRoute(<EventsAdmin />, {
      route: '/admin/events?publication_state=pending_review',
      path: '/admin/events',
    });

    await screen.findByRole('heading', { name: 'No events found' });
    expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('publication_state=pending_review'));
  });

  it('refreshes the moderation filter when a same-page notification changes the query', async () => {
    mockApi.get.mockResolvedValue(eventListResponse([]));
    const rendered = renderEventRoute(<EventsAdmin />, {
      route: '/admin/events',
      path: '/admin/events',
    });

    await screen.findByRole('heading', { name: 'No events found' });
    expect(mockApi.get).toHaveBeenCalledWith(expect.not.stringContaining('publication_state='));
    mockApi.get.mockClear();

    await rendered.router.navigate('/admin/events?publication_state=pending_review');

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('publication_state=pending_review'));
    });
  });

  it('ignores an older list response after the moderation query changes', async () => {
    let resolveInitial!: (value: ReturnType<typeof eventListResponse>) => void;
    let resolvePending!: (value: ReturnType<typeof eventListResponse>) => void;
    const initialRequest = new Promise<ReturnType<typeof eventListResponse>>((resolve) => {
      resolveInitial = resolve;
    });
    const pendingRequest = new Promise<ReturnType<typeof eventListResponse>>((resolve) => {
      resolvePending = resolve;
    });
    mockApi.get
      .mockReturnValueOnce(initialRequest)
      .mockReturnValueOnce(pendingRequest);
    const rendered = renderEventRoute(<EventsAdmin />, {
      route: '/admin/events',
      path: '/admin/events',
    });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

    await rendered.router.navigate('/admin/events?publication_state=pending_review');
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolvePending(eventListResponse([{
        ...MOCK_EVENT,
        id: 9,
        title: 'Awaiting moderation',
        publication_state: 'pending_review',
        status: 'draft',
      }]));
    });
    expect(await screen.findByText('Awaiting moderation')).toBeInTheDocument();

    await act(async () => {
      resolveInitial(eventListResponse([MOCK_EVENT]));
    });
    await waitFor(() => {
      expect(screen.getByText('Awaiting moderation')).toBeInTheDocument();
      expect(screen.queryByText('Community Swap Meet')).not.toBeInTheDocument();
    });
  });

  it('renders an all-day event on the date defined by its event timezone', async () => {
    const start = '2030-07-01T00:30:00Z';
    await renderLoadedAdmin([{
      ...MOCK_EVENT,
      start_date: start,
      timezone: 'America/Los_Angeles',
      all_day: true,
    }]);

    const expectedDate = new Date(start).toLocaleDateString(getFormattingLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Los_Angeles',
    });
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
    expect(screen.getByText('All day')).toBeInTheDocument();
  });

  it('shows an accessible empty state when no events are returned', async () => {
    await renderLoadedAdmin([]);

    expect(screen.getByRole('heading', { name: 'No events found' })).toBeInTheDocument();
    expect(screen.getByText('No events match your current filters')).toBeInTheDocument();
  });

  // E-104: a failed load is shown as a failure with Retry, never as "No events found".
  it('shows a load error with retry when the fetch rejects', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));
    renderEventRoute(<EventsAdmin />, { route: '/admin/events', path: '/admin/events' });

    expect((await screen.findAllByText('Failed to load events')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No events found' })).not.toBeInTheDocument();
  });

  it('archives an event instead of presenting destructive deletion', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true });
    await renderLoadedAdmin();

    await user.click(screen.getByRole('button', { name: 'Actions for Community Swap Meet' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive: Community Swap Meet' });

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/events/1/archive', {});
    });
    expect(mockToast.success).toHaveBeenCalledWith('Archive completed successfully');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('requires and submits a cancellation reason', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true });
    await renderLoadedAdmin();

    await user.click(screen.getByRole('button', { name: 'Actions for Community Swap Meet' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel event: Community Swap Meet' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel event' });

    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Venue unavailable');

    await user.click(confirm);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/events/1/cancel', {
        reason: 'Venue unavailable',
      });
    });
    expect(mockToast.success).toHaveBeenCalledWith('Cancel event completed successfully');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('requires explicit series acknowledgement before cancelling a recurring template', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true });
    await renderLoadedAdmin([MOCK_RECURRING_EVENT]);

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Repair Café' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel event: Weekly Repair Café' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel event' });
    const acknowledgement = within(dialog).getByRole('checkbox', {
      name: 'I understand this change applies to the recurring series and the occurrences listed above.',
    });

    expect(within(dialog).getByRole('note')).toHaveTextContent(
      'This applies to the recurring template. Future occurrences affected: 7.',
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Venue unavailable');
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(mockApi.post).not.toHaveBeenCalled();

    await user.click(acknowledgement);
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/events/3/cancel', {
        reason: 'Venue unavailable',
      });
    });
  });

  it('requires and resets series acknowledgement before archiving a recurring template', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true });
    await renderLoadedAdmin([MOCK_RECURRING_EVENT]);

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Repair Café' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    let dialog = await screen.findByRole('dialog', { name: 'Archive: Weekly Repair Café' });
    let confirm = within(dialog).getByRole('button', { name: 'Archive' });
    let acknowledgement = within(dialog).getByRole('checkbox', {
      name: 'I understand this change applies to the recurring series and the occurrences listed above.',
    });

    expect(within(dialog).getByRole('note')).toHaveTextContent(
      'This applies to the recurring template. Future occurrences affected: 7.',
    );
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(mockApi.post).not.toHaveBeenCalled();

    await user.click(acknowledgement);
    expect(confirm).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Repair Café' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    dialog = await screen.findByRole('dialog', { name: 'Archive: Weekly Repair Café' });
    confirm = within(dialog).getByRole('button', { name: 'Archive' });
    acknowledgement = within(dialog).getByRole('checkbox', {
      name: 'I understand this change applies to the recurring series and the occurrences listed above.',
    });
    expect(acknowledgement).not.toBeChecked();
    expect(confirm).toBeDisabled();

    await user.click(acknowledgement);
    await user.click(confirm);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/events/3/archive', {});
    });
  });

  it('uses the total generated count and acknowledgement for a recurring publication rejection', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValue({ success: true });
    await renderLoadedAdmin([{
      ...MOCK_RECURRING_EVENT,
      status: 'draft',
      publication_state: 'pending_review' as const,
    }]);

    await user.click(screen.getByRole('button', { name: 'Actions for Weekly Repair Café' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject: Weekly Repair Café' });
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });

    expect(within(dialog).getByRole('note')).toHaveTextContent(
      'This applies to the recurring template and every generated occurrence. '
      + 'Generated occurrences affected: 12.',
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Policy conflict');
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox', {
      name: 'I understand this change applies to the recurring series and the occurrences listed above.',
    }));
    await user.click(confirm);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/events/3/reject', {
        reason: 'Policy conflict',
      });
    });
  });

  it('finishes loading and reports the server error for success:false responses', async () => {
    mockApi.get.mockResolvedValue({ success: false, data: null, error: 'Server error' });
    renderEventRoute(<EventsAdmin />, { route: '/admin/events', path: '/admin/events' });

    expect(await screen.findByText('Server error')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No events found' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });
});
