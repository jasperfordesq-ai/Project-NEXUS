// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Coordinator-approved contacts for a member whose contact goes through a
 * coordinator (owner decision, 25 Oct 2026): the list, the empty state that
 * says only coordinators can reach them, and withdrawing an approval.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, formatRelativeTime: (s: string) => s };
});
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));
// The picker searches the admin user API; a stub keeps this test about the list.
vi.mock('@/admin/components/MemberSearchPicker', () => ({
  MemberSearchPicker: () => <div data-testid="member-picker" />,
}));

import { ApprovedContactsSection } from './ApprovedContactsSection';

describe('ApprovedContactsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says only coordinators can reach the member when nobody is approved', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    render(<ApprovedContactsSection userId={7} userName="Mary" />);

    expect(await screen.findByText('Nobody is approved yet, so only coordinators can contact them.')).toBeInTheDocument();
    expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/safeguarding/members/7/approved-contacts');
  });

  it('lists approved members and withdraws an approval', async () => {
    mockApi.get.mockResolvedValueOnce({
      success: true,
      data: [{ id: 3, contact_user_id: 9, contact_name: 'Sean Example', approved_at: '2026-10-25T10:00:00Z' }],
    }).mockResolvedValue({ success: true, data: [] });
    mockApi.delete.mockResolvedValue({ success: true, data: { revoked: true } });
    render(<ApprovedContactsSection userId={7} userName="Mary" />);

    expect(await screen.findByText('Sean Example')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw approval for Sean Example' }));

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/admin/safeguarding/members/7/approved-contacts/3'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Approval withdrawn.'));
  });
});
