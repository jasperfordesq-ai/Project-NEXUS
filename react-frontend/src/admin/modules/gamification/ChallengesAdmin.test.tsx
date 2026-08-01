// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { AdminChallenge } from '../../api/adminApi';

const { mockGamification } = vi.hoisted(() => ({
  mockGamification: {
    listChallenges: vi.fn(),
    createChallenge: vi.fn(),
    updateChallenge: vi.fn(),
    deleteChallenge: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminGamification: mockGamification,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <span>{title}</span>
        {actions}
      </div>
    ),
  };
}
vi.mock('../../components/PageHeader', adminComponentsMock);

import ChallengesAdmin from './ChallengesAdmin';

const makeChallenge = (overrides: Partial<AdminChallenge> = {}): AdminChallenge => ({
  id: 7,
  title: 'Visit five partner venues',
  description: null,
  challenge_type: 'monthly',
  action_type: 'venue_visit',
  target_count: 5,
  xp_reward: 100,
  badge_reward: null,
  start_date: '2026-08-01',
  end_date: '2026-08-31',
  is_active: true,
  ...overrides,
});

const listResponse = (challenges: AdminChallenge[]) => ({
  success: true as const,
  data: {
    challenges,
    total: challenges.length,
    supported_action_types: ['venue_visit', 'event_attendance_verified', 'attend_event'],
    challenge_types: ['daily', 'weekly', 'monthly', 'special'] as AdminChallenge['challenge_type'][],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGamification.listChallenges.mockResolvedValue(listResponse([]));
});

describe('ChallengesAdmin', () => {
  it('lists challenges with action, target, and status', async () => {
    mockGamification.listChallenges.mockResolvedValue(listResponse([makeChallenge()]));

    render(<ChallengesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('Visit five partner venues')).toBeInTheDocument();
    });
    expect(screen.getByText('Partner venue visits')).toBeInTheDocument();
    expect(screen.getByText('100 XP')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('creates a challenge with only server-supported action types offered', async () => {
    mockGamification.createChallenge.mockResolvedValue({ success: true, data: makeChallenge() });

    render(<ChallengesAdmin />);

    const createButton = await screen.findByRole('button', { name: 'Create challenge' });
    fireEvent.click(createButton);

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Attend three events' } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-08-31' } });

    // Save stays disabled until an action type is chosen — the vocabulary is
    // server-supplied, so the form cannot offer a stuck-at-zero action.
    expect(screen.getByTestId('save-challenge')).toBeDisabled();
  });

  it('deletes through the confirm modal, which warns about progress loss', async () => {
    mockGamification.listChallenges.mockResolvedValue(listResponse([makeChallenge()]));
    mockGamification.deleteChallenge.mockResolvedValue({ success: true, data: { deleted: true } });

    render(<ChallengesAdmin />);

    await screen.findByText('Visit five partner venues');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Visit five partner venues' }));
    fireEvent.click(await screen.findByText('Delete'));

    // The cascade warning names the challenge.
    await screen.findByText(/Every member's progress on it/);

    const confirmButton = screen.getByTestId('confirm-modal-confirm');
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockGamification.deleteChallenge).toHaveBeenCalledWith(7);
    });
  });

  it('shows the empty state with a create call-to-action', async () => {
    render(<ChallengesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('No challenges yet')).toBeInTheDocument();
    });
  });
});
