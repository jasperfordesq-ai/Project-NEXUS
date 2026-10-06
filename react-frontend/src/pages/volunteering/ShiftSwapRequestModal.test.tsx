// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ShiftSwapRequestModal — the website's "ask to swap" flow, which
 * mirrors the phone app: the member picks a SHIFT, never a person.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'swaps.ask_title': 'Ask to swap this shift',
        'swaps.ask_body': 'Pick the shift you would rather do.',
        'swaps.ask_empty': 'There is nobody to swap with yet.',
        'swaps.options_error': 'Could not load the other shifts.',
        'swaps.request_sent': 'Swap request sent.',
        'swaps.request_error': 'Could not send that swap request.',
        'swaps.your_shift': 'Your Shift',
        'cancel': 'Cancel',
      };
      if (key === 'swaps.ask_option_label') return `Ask to swap for the shift on ${String(opts?.date ?? '')}`;
      return translations[key] ?? key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { ShiftSwapRequestModal } from './ShiftSwapRequestModal';
import { api } from '@/lib/api';

const ownShift = {
  id: 10,
  opportunity_id: 5,
  opportunity_title: 'Food Bank',
  start_time: '2099-03-15T10:00:00Z',
  end_time: '2099-03-15T14:00:00Z',
};

const candidates = [
  // The member's own shift: never offered.
  { id: 10, start_time: '2099-03-15T10:00:00Z', end_time: '2099-03-15T14:00:00Z', signup_count: 1 },
  // Nobody on it: nobody to swap with, so not offered.
  { id: 11, start_time: '2099-03-16T10:00:00Z', end_time: '2099-03-16T14:00:00Z', signup_count: 0 },
  // Already happened: not offered.
  { id: 12, start_time: '2020-03-16T10:00:00Z', end_time: '2020-03-16T14:00:00Z', signup_count: 2 },
  // The one genuine option.
  { id: 13, start_time: '2099-03-17T09:00:00Z', end_time: '2099-03-17T12:00:00Z', signup_count: 1 },
];

describe('ShiftSwapRequestModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no shift is being swapped', () => {
    render(<ShiftSwapRequestModal shift={null} onClose={vi.fn()} />);
    expect(screen.queryByText('Ask to swap this shift')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('loads the opportunity shifts and offers only future shifts with someone on them', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: candidates });
    render(<ShiftSwapRequestModal shift={ownShift} onClose={vi.fn()} />);

    expect(await screen.findByText('Ask to swap this shift')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/opportunities/5/shifts');

    const options = await screen.findAllByTestId(/^shift-swap-option-/);
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute('data-testid', 'shift-swap-option-13');
    expect(screen.queryByText('There is nobody to swap with yet.')).not.toBeInTheDocument();
  });

  it('explains when there is nobody to swap with', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [candidates[0], candidates[1]] });
    render(<ShiftSwapRequestModal shift={ownShift} onClose={vi.fn()} />);

    expect(await screen.findByText('There is nobody to swap with yet.')).toBeInTheDocument();
    expect(screen.queryByTestId(/^shift-swap-option-/)).not.toBeInTheDocument();
  });

  it('shows a load error when the shifts cannot be fetched', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network'));
    render(<ShiftSwapRequestModal shift={ownShift} onClose={vi.fn()} />);

    expect(await screen.findByText('Could not load the other shifts.')).toBeInTheDocument();
  });

  it('asks for the chosen shift by id only and never names a person', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: candidates });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 99 } });
    const onClose = vi.fn();
    const onSent = vi.fn();
    render(<ShiftSwapRequestModal shift={ownShift} onClose={onClose} onSent={onSent} />);

    fireEvent.click(await screen.findByTestId('shift-swap-option-13'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [endpoint, body] = vi.mocked(api.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/v2/volunteering/swaps');
    expect(body.from_shift_id).toBe(10);
    expect(body.to_shift_id).toBe(13);
    expect(body).not.toHaveProperty('to_user_id');
    expect(typeof body.idempotency_key).toBe('string');
    expect((body.idempotency_key as string).length).toBeGreaterThanOrEqual(8);

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Swap request sent.');
  });

  it('shows the server reason when the request is refused and stays open', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: candidates });
    vi.mocked(api.post).mockResolvedValue({
      success: false,
      errors: [{ code: 'VALIDATION_ERROR', message: 'That shift has already started.' }],
    });
    const onClose = vi.fn();
    render(<ShiftSwapRequestModal shift={ownShift} onClose={onClose} />);

    fireEvent.click(await screen.findByTestId('shift-swap-option-13'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That shift has already started.'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('shift-swap-option-13')).toBeInTheDocument();
  });

  it('retries once with the same key when the first attempt never got a response', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: candidates });
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ success: true, data: { id: 99 } });
    render(<ShiftSwapRequestModal shift={ownShift} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('shift-swap-option-13'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const first = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    const second = vi.mocked(api.post).mock.calls[1]?.[1] as Record<string, unknown>;
    expect(second.idempotency_key).toBe(first.idempotency_key);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
  });
});
