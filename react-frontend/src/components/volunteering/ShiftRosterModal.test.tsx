// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ShiftRosterModal — who is on a shift and who turned up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${String(v)}`).join(',')}`;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { ShiftRosterModal, type ShiftRoster } from './ShiftRosterModal';
import { api } from '@/lib/api';

const roster: ShiftRoster = {
  summary: { signed_up: 3, checked_in: 1, no_show: 1, group_places: 4, waiting: 1 },
  volunteers: [
    { user: { id: 11, name: 'Ada Arrived' }, check_in_status: 'checked_in', checked_in_at: '2026-10-05 10:02:00', checked_out_at: null },
    { user: { id: 12, name: 'Bo Absent' }, check_in_status: 'no_show', checked_in_at: null, checked_out_at: null },
    { user: { id: 13, name: 'Cy Coming' }, check_in_status: null, checked_in_at: null, checked_out_at: null },
  ],
  groups: [{ id: 5, group_name: 'Roster Rovers', reserved_slots: 4, leader: { id: 20, name: 'Gina Leader' }, members: [{ id: 21, name: 'Gus Member' }] }],
  waitlist: [{ user: { id: 30, name: 'Wes Waiting' }, position: 1 }],
};

describe('ShiftRosterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names everyone on a started shift with whether they checked in', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: roster });
    render(<ShiftRosterModal shiftId={7} shiftLabel="Sun 5 Oct" hasStarted onClose={vi.fn()} />);

    expect(await screen.findByText('Ada Arrived')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/shifts/7/roster');
    expect(screen.getByText(/shift_manager\.roster_checked_in_at:time=/)).toBeInTheDocument();
    expect(screen.getByText('shift_manager.roster_no_show')).toBeInTheDocument();
    // Started, no check-in row: shown as not checked in, not as "coming".
    expect(screen.getByText('shift_manager.roster_not_checked_in')).toBeInTheDocument();
    expect(screen.getByText('shift_manager.roster_summary_checked_in:count=1')).toBeInTheDocument();

    expect(screen.getByText('shift_manager.roster_group_line:name=Roster Rovers,count=4')).toBeInTheDocument();
    expect(screen.getByText('shift_manager.roster_group_leader:name=Gina Leader')).toBeInTheDocument();
    expect(screen.getByText('Gus Member')).toBeInTheDocument();
    expect(screen.getByText('Wes Waiting')).toBeInTheDocument();
  });

  it('before the shift starts, nobody is shown as missing', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: roster });
    render(<ShiftRosterModal shiftId={7} shiftLabel="Sun 5 Oct" hasStarted={false} onClose={vi.fn()} />);

    expect(await screen.findByText('Cy Coming')).toBeInTheDocument();
    expect(screen.getByText('shift_manager.roster_not_yet')).toBeInTheDocument();
    expect(screen.queryByText('shift_manager.roster_not_checked_in')).not.toBeInTheDocument();
    expect(screen.queryByText('shift_manager.roster_summary_checked_in:count=1')).not.toBeInTheDocument();
  });

  it('says so when nobody has signed up', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { summary: { signed_up: 0, checked_in: 0, no_show: 0, group_places: 0, waiting: 0 }, volunteers: [], groups: [], waitlist: [] },
    });
    render(<ShiftRosterModal shiftId={7} shiftLabel="Sun 5 Oct" hasStarted={false} onClose={vi.fn()} />);

    expect(await screen.findByText('shift_manager.roster_empty')).toBeInTheDocument();
  });

  it('shows an error when the list cannot be loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<ShiftRosterModal shiftId={7} shiftLabel="Sun 5 Oct" hasStarted={false} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('shift_manager.roster_load_error');
  });

  it('loads nothing while closed', () => {
    render(<ShiftRosterModal shiftId={null} shiftLabel="" hasStarted={false} onClose={vi.fn()} />);
    expect(api.get).not.toHaveBeenCalled();
  });
});
