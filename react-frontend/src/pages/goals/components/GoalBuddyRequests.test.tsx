// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import React from 'react';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

import { GoalBuddyRequests } from './GoalBuddyRequests';

const OFFERS = [
  { id: 11, status: 'pending', created_at: '2026-09-26T10:00:00Z', requester: { id: 5, name: 'Alex Helper', avatar_url: null } },
  { id: 12, status: 'pending', created_at: '2026-09-26T11:00:00Z', requester: { id: 6, name: 'Sam Supporter', avatar_url: null } },
];

describe('GoalBuddyRequests (F-004: the goal owner decides)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when there are no pending offers', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    const { container } = render(<GoalBuddyRequests goalId={42} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/goals/42/buddy-requests'));
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders nothing when the list cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, code: 'RESOURCE_FORBIDDEN' });
    const { container } = render(<GoalBuddyRequests goalId={42} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('lists each pending offer with accept and decline controls', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: OFFERS });
    render(<GoalBuddyRequests goalId={42} />);

    expect(await screen.findByText('Alex Helper')).toBeInTheDocument();
    expect(screen.getByText('Sam Supporter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept Alex Helper as your buddy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline the buddy offer from Sam Supporter' })).toBeInTheDocument();
  });

  it('accepting posts the decision, reports the new buddy and clears the list', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: OFFERS });
    const accepted = { buddy_id: 5, buddy_name: 'Alex Helper', buddy_avatar: null };
    mockApi.post.mockResolvedValue({ success: true, data: { status: 'accepted', goal: accepted } });
    const onAccepted = vi.fn();
    render(<GoalBuddyRequests goalId={42} onAccepted={onAccepted} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Accept Alex Helper as your buddy' }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(accepted));
    expect(mockApi.post).toHaveBeenCalledWith('/v2/goals/42/buddy-requests/11/accept', {});
    expect(mockToast.success).toHaveBeenCalledWith('Buddy offer accepted');
    await waitFor(() => expect(screen.queryByText('Sam Supporter')).not.toBeInTheDocument());
  });

  it('declining removes only that offer and assigns nobody', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: OFFERS });
    mockApi.post.mockResolvedValue({ success: true, data: { status: 'declined' } });
    const onAccepted = vi.fn();
    render(<GoalBuddyRequests goalId={42} onAccepted={onAccepted} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Decline the buddy offer from Alex Helper' }));

    await waitFor(() => expect(screen.queryByText('Alex Helper')).not.toBeInTheDocument());
    expect(mockApi.post).toHaveBeenCalledWith('/v2/goals/42/buddy-requests/11/decline', {});
    expect(screen.getByText('Sam Supporter')).toBeInTheDocument();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('shows an error toast when the decision fails', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: OFFERS });
    mockApi.post.mockResolvedValue({ success: false, code: 'RESOURCE_CONFLICT' });
    render(<GoalBuddyRequests goalId={42} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Accept Alex Helper as your buddy' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Could not update the buddy offer'));
  });
});
