// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import { createUser } from '@/test/factories';
import React from 'react';

const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getOrgMembers: vi.fn(),
    addOrgMember: vi.fn(),
    updateOrgMemberRole: vi.fn(),
    removeOrgMember: vi.fn(),
  },
}));
vi.mock('../../api/adminApi', () => ({ adminVolunteering: mockAdminVolunteering }));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: createUser({ id: 99, name: 'Admin User' }),
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

// The member search has its own tests; a plain box stands in for it here.
vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ label, value, onValueChange }: { label: string; value: string; onValueChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)} />
  ),
}));

const ok = (data: unknown = { ok: true }) => ({ success: true, data });
const team = [
  { id: 1, user_id: 10, first_name: 'Cara', last_name: 'Creator', role: 'owner', total_hours: 5, is_creator: true },
  { id: 2, user_id: 11, first_name: 'Bob', last_name: 'Helper', role: 'admin', total_hours: 2, is_creator: false },
  { id: 3, user_id: 99, first_name: 'Admin', last_name: 'User', role: 'member', total_hours: 0, is_creator: false },
];

async function renderModal(onChanged = vi.fn()) {
  const { OrgTeamModal } = await import('./OrgTeamModal');
  render(<OrgTeamModal isOpen onClose={vi.fn()} org={{ id: 7, name: 'Food Bank' }} onChanged={onChanged} />);
  await screen.findByText('Bob Helper');
  return onChanged;
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('OrgTeamModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminVolunteering.getOrgMembers.mockResolvedValue(ok(team));
    mockAdminVolunteering.addOrgMember.mockResolvedValue(ok());
    mockAdminVolunteering.updateOrgMemberRole.mockResolvedValue(ok());
    mockAdminVolunteering.removeOrgMember.mockResolvedValue(ok());
  });

  it('locks the creator and the admin’s own row, and leaves the rest editable', async () => {
    await renderModal();

    expect(mockAdminVolunteering.getOrgMembers).toHaveBeenCalledWith(7);
    expect(within(rowOf('Cara Creator')).getByText('Registered the organisation')).toBeInTheDocument();
    expect(within(rowOf('Cara Creator')).getByRole('button', { name: 'Remove Cara Creator' })).toBeDisabled();
    expect(within(rowOf('Admin User')).getByText('You')).toBeInTheDocument();
    expect(within(rowOf('Admin User')).getByRole('button', { name: 'Remove Admin User' })).toBeDisabled();
    expect(within(rowOf('Bob Helper')).getByRole('button', { name: 'Remove Bob Helper' })).toBeEnabled();
  });

  it('adds the chosen member in the chosen role, then reloads and tells the page', async () => {
    const onChanged = await renderModal();

    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Member' }), '42');
    await userEvent.click(add);

    await waitFor(() => expect(mockAdminVolunteering.addOrgMember).toHaveBeenCalledWith(7, 42, 'member'));
    expect(mockToast.success).toHaveBeenCalledWith('Added to the team.');
    expect(mockAdminVolunteering.getOrgMembers).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalled();
  });

  it('removes a member after confirmation', async () => {
    await renderModal();

    await userEvent.click(within(rowOf('Bob Helper')).getByRole('button', { name: 'Remove Bob Helper' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove from the team?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mockAdminVolunteering.removeOrgMember).toHaveBeenCalledWith(7, 11));
    expect(mockToast.success).toHaveBeenCalledWith('Removed from the team.');
  });

  it('shows the server’s reason when a change is refused', async () => {
    mockAdminVolunteering.removeOrgMember.mockResolvedValue({
      success: false, code: 'LAST_OWNER', error: 'An organisation must keep at least one owner.',
    });
    const onChanged = await renderModal();

    await userEvent.click(within(rowOf('Bob Helper')).getByRole('button', { name: 'Remove Bob Helper' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove from the team?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('An organisation must keep at least one owner.'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('changes a member’s role', async () => {
    await renderModal();

    const row = rowOf('Bob Helper');
    const trigger = within(row).getAllByRole('button').find((b) => b.getAttribute('aria-haspopup')) as HTMLElement;
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole('option', { name: 'Owner' }));

    await waitFor(() => expect(mockAdminVolunteering.updateOrgMemberRole).toHaveBeenCalledWith(7, 11, 'owner'));
    expect(mockToast.success).toHaveBeenCalledWith('Role changed.');
  });
});
