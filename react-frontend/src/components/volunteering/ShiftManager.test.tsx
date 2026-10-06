// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ShiftManager — the organiser's and admin's shift control panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const toastSuccess = vi.fn();
const toastError = vi.fn();

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

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { ShiftManager } from './ShiftManager';
import { api } from '@/lib/api';

const shifts = [
  { id: 1, start_time: '2099-03-15 10:00:00', end_time: '2099-03-15 13:00:00', capacity: 4, signup_count: 1, reserved_count: 0, spots_available: 3, recurring_pattern_id: null },
  { id: 2, start_time: '2099-03-22 10:00:00', end_time: '2099-03-22 13:00:00', capacity: null, signup_count: 0, reserved_count: 0, spots_available: null, recurring_pattern_id: 7 },
  { id: 3, start_time: '2020-01-05 10:00:00', end_time: '2020-01-05 12:00:00', capacity: 2, signup_count: 2, reserved_count: 0, spots_available: 0, recurring_pattern_id: null },
];

const patterns = [
  { id: 7, title: null, frequency: 'weekly', days_of_week: [6], start_time: '10:00:00', end_time: '13:00:00', capacity: 3, start_date: '2099-03-01', end_date: null, max_occurrences: null, occurrences_generated: 2, is_active: true },
];

function mockLists(options: { patternsStatus?: 'ok' | 'disabled' } = {}) {
  vi.mocked(api.get).mockImplementation((async (endpoint: string) => {
    if (endpoint === '/v2/volunteering/opportunities/5/shifts') return { success: true, data: shifts };
    if (endpoint === '/v2/volunteering/opportunities/5/recurring-patterns') {
      return options.patternsStatus === 'disabled'
        ? { success: false, code: 'FEATURE_DISABLED', error: 'off' }
        : { success: true, data: { patterns } };
    }
    return { success: true, data: [] };
  }) as unknown as typeof api.get);
}

describe('ShiftManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists upcoming shifts with their places, marks repeating ones, and keeps past shifts behind a toggle', async () => {
    mockLists();
    render(<ShiftManager opportunityId={5} />);

    expect(await screen.findByTestId('managed-shift-1')).toBeInTheDocument();
    expect(screen.getByTestId('managed-shift-1')).toHaveTextContent('shift_manager.places_of:taken=1,capacity=4');
    expect(screen.getByTestId('managed-shift-2')).toHaveTextContent('shift_manager.signed_up:count=0');
    expect(screen.getByTestId('managed-shift-2')).toHaveTextContent('shift_manager.repeating_chip');
    expect(screen.queryByTestId('managed-shift-3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('shift-manager-toggle-past'));
    expect(screen.getByTestId('managed-shift-3')).toBeInTheDocument();
    expect(screen.getByTestId('managed-shift-3')).toHaveTextContent('shift_manager.started_chip');
    // A started shift carries no edit or remove control.
    expect(screen.queryByTestId('managed-shift-edit-3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('managed-shift-remove-3')).not.toBeInTheDocument();

    expect(screen.getByTestId('managed-pattern-7')).toHaveTextContent('shift_manager.frequency_weekly');
  });

  it('hides the repeating-shift controls when the community has them switched off', async () => {
    mockLists({ patternsStatus: 'disabled' });
    render(<ShiftManager opportunityId={5} />);

    expect(await screen.findByTestId('managed-shift-1')).toBeInTheDocument();
    expect(screen.queryByTestId('shift-manager-add-repeating')).not.toBeInTheDocument();
    expect(screen.queryByTestId('managed-pattern-7')).not.toBeInTheDocument();
  });

  it('adds a one-off shift as local wall-clock time and refreshes', async () => {
    mockLists();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 9 } });
    const onChanged = vi.fn();
    render(<ShiftManager opportunityId={5} onChanged={onChanged} />);
    await screen.findByTestId('managed-shift-1');

    fireEvent.click(screen.getByTestId('shift-manager-add'));
    expect(await screen.findByTestId('shift-form')).toBeInTheDocument();

    // No date yet: the form refuses locally and nothing is sent.
    fireEvent.click(screen.getByTestId('shift-form-save'));
    expect(await screen.findByTestId('shift-form-error')).toHaveTextContent('shift_manager.required');
    expect(api.post).not.toHaveBeenCalled();

    // The date picker is a HeroUI composite; drive it through the hidden input it renders.
    const dateInput = document.querySelector<HTMLInputElement>('input[type="hidden"][name], input[type="date"]');
    if (dateInput) fireEvent.change(dateInput, { target: { value: '2099-04-01' } });

    fireEvent.change(screen.getByTestId('shift-form-start'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByTestId('shift-form-end'), { target: { value: '08:00' } });
    fireEvent.change(screen.getByTestId('shift-form-capacity'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('shift-form-save'));
    await waitFor(() => {
      const err = screen.getByTestId('shift-form-error');
      expect(['shift_manager.end_before_start', 'shift_manager.required']).toContain(err.textContent);
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('edits an upcoming shift through PUT with the shift id', async () => {
    mockLists();
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { id: 1 } });
    const onChanged = vi.fn();
    render(<ShiftManager opportunityId={5} onChanged={onChanged} />);
    await screen.findByTestId('managed-shift-1');

    fireEvent.click(screen.getByTestId('managed-shift-edit-1'));
    expect(await screen.findByTestId('shift-form')).toBeInTheDocument();
    // Pre-filled from the shift: a 10:00–13:00 slot with 4 places.
    expect(screen.getByTestId('shift-form-start')).toHaveValue('10:00');
    expect(screen.getByTestId('shift-form-end')).toHaveValue('13:00');
    expect(screen.getByTestId('shift-form-capacity')).toHaveValue(3 + 1);

    fireEvent.change(screen.getByTestId('shift-form-capacity'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('shift-form-save'));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [endpoint, body] = vi.mocked(api.put).mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/v2/volunteering/shifts/1');
    expect(body).toMatchObject({ start_time: '2099-03-15 10:00:00', end_time: '2099-03-15 13:00:00', capacity: 6 });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('shift_manager.shift_updated');
  });

  it('removes a shift after confirming, telling the organiser how many volunteers are affected', async () => {
    mockLists();
    vi.mocked(api.delete).mockResolvedValue({ success: true, data: { deleted: true, affected_volunteers: 1 } });
    const onChanged = vi.fn();
    render(<ShiftManager opportunityId={5} onChanged={onChanged} />);
    await screen.findByTestId('managed-shift-1');

    fireEvent.click(screen.getByTestId('managed-shift-remove-1'));
    expect(await screen.findByText('shift_manager.remove_body:count=1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('shift-manager-remove-confirm'));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/volunteering/shifts/1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('shift_manager.shift_removed');
  });

  it('shows the server reason when a change is refused', async () => {
    mockLists();
    vi.mocked(api.put).mockResolvedValue({
      success: false,
      errors: [{ code: 'VALIDATION_ERROR', message: 'This shift already has 1 volunteers on it, so it cannot have fewer places than that.', field: 'capacity' }],
    });
    render(<ShiftManager opportunityId={5} />);
    await screen.findByTestId('managed-shift-1');

    fireEvent.click(screen.getByTestId('managed-shift-edit-1'));
    await screen.findByTestId('shift-form');
    fireEvent.change(screen.getByTestId('shift-form-capacity'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('shift-form-save'));

    expect(await screen.findByTestId('shift-form-error')).toHaveTextContent('cannot have fewer places');
    expect(screen.getByTestId('shift-form')).toBeInTheDocument();
  });

  it('stops a repeating pattern after confirming', async () => {
    mockLists();
    vi.mocked(api.delete).mockResolvedValue({ success: true, data: { future_shifts_removed: 2 } });
    render(<ShiftManager opportunityId={5} />);
    await screen.findByTestId('managed-pattern-7');

    fireEvent.click(screen.getByTestId('managed-pattern-stop-7'));
    fireEvent.click(await screen.findByTestId('shift-manager-stop-confirm'));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/volunteering/recurring-patterns/7'));
    expect(toastSuccess).toHaveBeenCalledWith('shift_manager.pattern_stopped:count=2');
  });

  it('sets up repeating shifts with the chosen days and reports how many were created', async () => {
    mockLists();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 8, shifts_generated: 2 } });
    render(<ShiftManager opportunityId={5} />);
    await screen.findByTestId('managed-shift-1');

    fireEvent.click(screen.getByTestId('shift-manager-add-repeating'));
    expect(await screen.findByTestId('pattern-form')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('pattern-form-start'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByTestId('pattern-form-end'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByTestId('pattern-form-capacity'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('pattern-form-max'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('pattern-form-day-6'));
    fireEvent.click(screen.getByTestId('pattern-form-save'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [endpoint, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/v2/volunteering/opportunities/5/recurring-patterns');
    expect(body).toMatchObject({ frequency: 'weekly', start_time: '10:00:00', end_time: '13:00:00', capacity: 3, max_occurrences: 4 });
    expect(typeof body.start_date).toBe('string');
    expect(body).not.toHaveProperty('end_date');
    expect(body.days_of_week).toEqual([6]);
    expect(toastSuccess).toHaveBeenCalledWith('shift_manager.pattern_created:count=2');
  });

  it('opens who is on a shift from any row, past or upcoming', async () => {
    mockLists();
    const base = vi.mocked(api.get).getMockImplementation();
    vi.mocked(api.get).mockImplementation((async (endpoint: string) => {
      if (endpoint === '/v2/volunteering/shifts/3/roster') {
        return {
          success: true,
          data: {
            summary: { signed_up: 1, checked_in: 1, no_show: 0, group_places: 0, waiting: 0 },
            volunteers: [{ user: { id: 9, name: 'Ada Arrived' }, check_in_status: 'checked_in', checked_in_at: null, checked_out_at: null }],
            groups: [],
            waitlist: [],
          },
        };
      }
      return base?.(endpoint);
    }) as unknown as typeof api.get);
    render(<ShiftManager opportunityId={5} />);

    expect(await screen.findByTestId('managed-shift-roster-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('shift-manager-toggle-past'));
    fireEvent.click(screen.getByTestId('managed-shift-roster-3'));

    expect(await screen.findByText('Ada Arrived')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/shifts/3/roster');
    expect(screen.getByText('shift_manager.roster_checked_in')).toBeInTheDocument();
  });

  it('will not set up weekly shifts until at least one day is chosen', async () => {
    mockLists();
    render(<ShiftManager opportunityId={5} />);
    await screen.findByTestId('managed-shift-1');

    fireEvent.click(screen.getByTestId('shift-manager-add-repeating'));
    expect(await screen.findByTestId('pattern-form')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('pattern-form-start'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByTestId('pattern-form-end'), { target: { value: '13:00' } });
    fireEvent.click(screen.getByTestId('pattern-form-save'));

    expect(await screen.findByText('shift_manager.days_required')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
