// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GoalProgressHistory
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  formatRelativeTime: (date: string) => `relative-${date}`,
}));

import { GoalProgressHistory } from '../GoalProgressHistory';
import { api } from '@/lib/api';

const makeEvent = (
  id: number,
  type: 'progress_update' | 'checkin' | 'milestone' | 'buddy_joined' | 'completed' | 'created',
  description: string,
  data: Record<string, unknown> = {},
) => ({
  id,
  type,
  description,
  data,
  created_at: '2026-03-01T10:00:00Z',
});

describe('GoalProgressHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no events exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GoalProgressHistory goalId={5} />);
    await waitFor(() => {
      expect(screen.getByText('No activity recorded yet.')).toBeInTheDocument();
    });
  });

  it('shows error state and Retry button when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<GoalProgressHistory goalId={5} />);
    await waitFor(() => {
      expect(screen.getByText("That didn't load. Try again in a moment.")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('renders timeline events with descriptions', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        makeEvent(1, 'created', 'Goal created'),
        makeEvent(2, 'checkin', 'Checked in at 40%', { progress_value: 40 }),
        makeEvent(3, 'completed', 'Goal completed!'),
      ],
    });
    render(<GoalProgressHistory goalId={5} />);
    await waitFor(() => {
      expect(screen.getByText('Goal created')).toBeInTheDocument();
    });
    expect(screen.getByText('Checked in at 40%')).toBeInTheDocument();
    expect(screen.getByText('Goal completed!')).toBeInTheDocument();
  });

  it('renders progress bar for events with progress_value', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        makeEvent(1, 'checkin', 'Progress updated', { progress_value: 75 }),
      ],
    });
    render(<GoalProgressHistory goalId={5} />);
    await waitFor(() => {
      expect(screen.getByText('Progress updated')).toBeInTheDocument();
    });
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders note text in italics for checkin events with notes', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        makeEvent(1, 'checkin', 'Check-in logged', {
          progress_value: 60,
          note: 'Feeling great about this goal',
        }),
      ],
    });
    render(<GoalProgressHistory goalId={5} />);
    await waitFor(() => {
      expect(screen.getByText(/Feeling great about this goal/)).toBeInTheDocument();
    });
  });

  it('retries loading when Retry button is clicked after error', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GoalProgressHistory goalId={5} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  it('calls API with correct goalId', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<GoalProgressHistory goalId={99} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/goals/99/history');
    });
  });
});
