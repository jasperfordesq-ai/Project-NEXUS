// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Gap C10: the Hours tab lists each logged entry with its status, and the shifts
 * the member holds, from GET /v2/volunteering/hours and /v2/volunteering/shifts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (path: string) => `/test${path}`, hasFeature: () => true, hasModule: () => true }),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { api } from '@/lib/api';
import { MyHoursAndShiftsLists } from './MyHoursAndShiftsLists';

const hourPage = (items: unknown[], hasMore = false, cursor: string | null = null) => ({
  success: true, data: { items, cursor, has_more: hasMore },
});

const HOURS = [
  { id: 3, date_logged: '2026-10-06T00:00:00.000000Z', hours: '2.00', description: 'Weeding', status: 'pending', organization: { id: 7, name: 'Riverside Garden' }, opportunity: { id: 501, title: 'Garden clean-up' } },
  { id: 2, date_logged: '2026-10-01T00:00:00.000000Z', hours: '1.50', description: null, status: 'declined', organization: { id: 7, name: 'Riverside Garden' }, opportunity: null },
];
const SHIFTS = [
  { id: 71, start_time: '2099-10-13T10:00:00Z', end_time: '2099-10-13T12:00:00Z', opportunity_id: 501, opportunity_title: 'Garden clean-up', location: 'Park' },
  { id: 40, start_time: '2020-01-01T10:00:00Z', end_time: '2020-01-01T12:00:00Z', opportunity_id: 502, opportunity_title: 'Seed swap stall', location: null },
];

function mockLists({ hours = HOURS, shifts = SHIFTS, hoursMore = false } = {}) {
  vi.mocked(api.get).mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/v2/volunteering/hours')) {
      return Promise.resolve(endpoint.includes('cursor=')
        ? hourPage([{ id: 1, date_logged: '2026-09-01T00:00:00.000000Z', hours: '3.00', description: null, status: 'approved', organization: { id: 7, name: 'Riverside Garden' }, opportunity: null }])
        : hourPage(hours, hoursMore, hoursMore ? 'Mg==' : null));
    }
    return Promise.resolve(hourPage(endpoint.startsWith('/v2/volunteering/shifts') ? shifts : []));
  });
}

describe('MyHoursAndShiftsLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists each logged entry with its status', async () => {
    mockLists();
    render(<MyHoursAndShiftsLists />);
    expect(await screen.findByText('Weeding')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/hours?per_page=10');
    const list = screen.getByTestId('my-hours-list');
    expect(list).toHaveTextContent('Garden clean-up');
    expect(list).toHaveTextContent('Pending');
    expect(list).toHaveTextContent('Declined');
    expect(list).toHaveTextContent('6 Oct 2026');
  });

  it('lists the shifts held, upcoming and past, each linking to its opportunity', async () => {
    mockLists();
    render(<MyHoursAndShiftsLists />);
    const link = await screen.findByRole('link', { name: 'Seed swap stall' });
    expect(link).toHaveAttribute('href', '/test/volunteering/opportunities/502');
    const list = screen.getByTestId('my-shifts-list');
    expect(list).toHaveTextContent('Upcoming');
    expect(list).toHaveTextContent('Past');
  });

  it('loads the next page of hours on request', async () => {
    mockLists({ hoursMore: true });
    render(<MyHoursAndShiftsLists />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v2/volunteering/hours?per_page=10&cursor=Mg%3D%3D'));
    expect(await screen.findByText(/3h/)).toBeInTheDocument();
    expect(screen.getByText('Weeding')).toBeInTheDocument();
  });

  it('says what will appear when there is nothing yet, and can leave the hours list out', async () => {
    mockLists({ hours: [], shifts: [] });
    const { unmount } = render(<MyHoursAndShiftsLists />);
    expect(await screen.findByText('Shifts you sign up for will appear here.')).toBeInTheDocument();
    expect(screen.getByText(/Hours you log will appear here/)).toBeInTheDocument();
    unmount();

    render(<MyHoursAndShiftsLists showHours={false} />);
    expect(await screen.findByTestId('my-shifts-list')).toBeInTheDocument();
    expect(screen.queryByTestId('my-hours-list')).not.toBeInTheDocument();
  });
});
