// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEventComponent } from '@/test/events-test-harness';
import { eventOfflineCheckinApi } from '@/lib/event-offline-checkin-api';
import { EventCheckinCredentialCard } from './EventCheckinCredentialCard';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/ui/ConfirmDialog', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/ConfirmDialog')>('@/components/ui/ConfirmDialog');
  return { ...actual, useConfirm: () => vi.fn().mockResolvedValue(false) };
});
vi.mock('@/lib/event-offline-checkin-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/event-offline-checkin-api')>('@/lib/event-offline-checkin-api');
  return {
    ...actual,
    eventOfflineCheckinApi: {
      myCredential: vi.fn(),
      issueCredential: vi.fn(),
      rotateCredential: vi.fn(),
      revokeCredential: vi.fn(),
    },
  };
});

describe('EventCheckinCredentialCard (E-105 attendee check-in code)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says the code is optional and how to use it before anything is created', async () => {
    vi.mocked(eventOfflineCheckinApi.myCredential).mockResolvedValue({
      success: true,
      data: { contract_version: 1, event_id: 182, credential: null },
    });

    renderEventComponent(<EventCheckinCredentialCard eventId={182} />);

    expect(await screen.findByRole('heading', { name: 'Your check-in code (optional)' })).toBeInTheDocument();
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText(/It is shown only once/)).toBeInTheDocument();
    expect(screen.getByText(/contains no name, email address or phone number/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create check-in code' })).toBeInTheDocument();
    expect(screen.queryByText(/PII|payload|credential/i)).not.toBeInTheDocument();
  });

  it('offers Replace and Cancel for an active code and refuses to cancel without a reason', async () => {
    const user = userEvent.setup();
    vi.mocked(eventOfflineCheckinApi.myCredential).mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 182,
        credential: { id: 9, version: 1, status: 'active', expires_at: '2026-10-15T00:27:06+00:00' },
      },
    });

    renderEventComponent(<EventCheckinCredentialCard eventId={182} />);

    expect(await screen.findByRole('button', { name: 'Replace code' })).toBeInTheDocument();
    expect(screen.getByText(/Works until/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel code' }));

    await waitFor(() => expect(mockToast.warning).toHaveBeenCalledWith('Enter a reason before cancelling the code.'));
    expect(eventOfflineCheckinApi.revokeCredential).not.toHaveBeenCalled();
  });

  it('shows "Cancelled" and a fresh Create button after a code was cancelled', async () => {
    vi.mocked(eventOfflineCheckinApi.myCredential).mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 182,
        credential: { id: 9, version: 2, status: 'revoked' },
      },
    });

    renderEventComponent(<EventCheckinCredentialCard eventId={182} />);

    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create check-in code' })).toBeInTheDocument();
  });
});
