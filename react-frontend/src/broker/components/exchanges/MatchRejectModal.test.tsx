// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminMatching, mockToast } = vi.hoisted(() => ({
  mockAdminMatching: { rejectMatch: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminMatching: mockAdminMatching }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

import { MatchRejectModal } from './MatchRejectModal';

const MATCH = { id: 11, user_1_name: 'Alice Member', user_2_name: 'Bob Owner' };

describe('MatchRejectModal', () => {
  const onClose = vi.fn();
  const onRejected = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names both parties and keeps Reject disabled until a reason is typed', async () => {
    mockAdminMatching.rejectMatch.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<MatchRejectModal match={MATCH} onClose={onClose} onRejected={onRejected} />);

    expect(screen.getByText('Rejecting the match between Alice Member and Bob Owner.')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Reject Match' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/rejection reason/i), 'Too far apart');
    expect(submit).not.toBeDisabled();

    await user.click(submit);
    await waitFor(() => expect(mockAdminMatching.rejectMatch).toHaveBeenCalledWith(11, 'Too far apart'));
    expect(mockToast.success).toHaveBeenCalledWith('Match rejected');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal and the typed reason when the server refuses', async () => {
    mockAdminMatching.rejectMatch.mockResolvedValue({ success: false, error: 'Server said no' });
    const user = userEvent.setup();
    render(<MatchRejectModal match={MATCH} onClose={onClose} onRejected={onRejected} />);

    await user.type(screen.getByLabelText(/rejection reason/i), 'Too far apart');
    await user.click(screen.getByRole('button', { name: 'Reject Match' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Server said no'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onRejected).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/rejection reason/i)).toHaveValue('Too far apart');
  });

  it('shows the generic failure when the request throws', async () => {
    mockAdminMatching.rejectMatch.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    render(<MatchRejectModal match={MATCH} onClose={onClose} onRejected={onRejected} />);

    await user.type(screen.getByLabelText(/rejection reason/i), 'Too far apart');
    await user.click(screen.getByRole('button', { name: 'Reject Match' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Failed to reject match'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel closes without rejecting', async () => {
    const user = userEvent.setup();
    render(<MatchRejectModal match={MATCH} onClose={onClose} onRejected={onRejected} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockAdminMatching.rejectMatch).not.toHaveBeenCalled();
  });
});
