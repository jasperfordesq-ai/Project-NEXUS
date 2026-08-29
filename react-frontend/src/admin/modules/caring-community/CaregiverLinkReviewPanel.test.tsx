// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi }));

import CaregiverLinkReviewPanel from './CaregiverLinkReviewPanel';

const pendingLink = {
  id: 41,
  caregiver_id: 10,
  caregiver_name: 'Cara Helper',
  cared_for_id: 20,
  cared_for_name: 'Pat Member',
  relationship_type: 'friend',
  status: 'pending',
  recipient_confirmed_at: '2026-08-29T10:00:00Z',
  created_at: '2026-08-29T09:00:00Z',
};

describe('CaregiverLinkReviewPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [pendingLink] });
    mockApi.post.mockResolvedValue({ success: true, data: { ...pendingLink, status: 'active' } });
  });

  it('loads and identifies pending caregiver consent work', async () => {
    render(<CaregiverLinkReviewPanel />);

    expect(await screen.findByText('Cara Helper')).toBeInTheDocument();
    expect(screen.getByText(/Pat Member/)).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/caring-community/caregiver-links?status=pending');
  });

  it('requires consent evidence and sends an explicit approval attestation', async () => {
    render(<CaregiverLinkReviewPanel />);
    await screen.findByText('Cara Helper');

    const approve = screen.getByRole('button', { name: /approve/i });
    expect(approve).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/consent evidence/i), {
      target: { value: 'Recipient confirmed during a recorded telephone call.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm consent/i }));
    fireEvent.click(approve);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/caring-community/caregiver-links/41/approve',
        {
          consent_verified: true,
          consent_evidence: 'Recipient confirmed during a recorded telephone call.',
        },
      );
    });
    expect((await screen.findAllByText('Caregiver link approved')).length).toBeGreaterThan(0);
  });

  it('does not allow approval before the care recipient confirms', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [{ ...pendingLink, recipient_confirmed_at: null }],
    });
    render(<CaregiverLinkReviewPanel />);
    await screen.findByText('Cara Helper');

    fireEvent.change(screen.getByLabelText(/consent evidence/i), {
      target: { value: 'Staff note cannot replace the recipient confirmation.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /confirm consent/i }));

    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByText('Recipient confirmation not recorded')).toBeInTheDocument();
  });

  it('records a staff rejection reason', async () => {
    render(<CaregiverLinkReviewPanel />);
    await screen.findByText('Cara Helper');

    fireEvent.change(screen.getByLabelText(/rejection reason/i), {
      target: { value: 'Consent could not be verified.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/caring-community/caregiver-links/41/reject',
        { reason: 'Consent could not be verified.' },
      );
    });
    expect((await screen.findAllByText('Caregiver link rejected')).length).toBeGreaterThan(0);
  });
});
