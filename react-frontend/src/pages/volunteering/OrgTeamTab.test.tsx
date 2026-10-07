// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Gap D7: the organisation's team on its dashboard. Owners add, move and
 * remove people; organisation admins only see the team.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { api } from '@/lib/api';
import { createMockContexts } from '@/test/mock-contexts';
import { createUser } from '@/test/factories';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: createUser({ id: 10, name: 'Cara Creator' }),
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
}));

import OrgTeamTab from './OrgTeamTab';

const TEAM = [
  { user_id: 10, name: 'Cara Creator', avatar_url: null, role: 'owner', is_creator: true },
  { user_id: 11, name: 'Bob Helper', avatar_url: null, role: 'admin', is_creator: false },
];

const teamResponse = (canManage: boolean) => ({ success: true, data: { items: TEAM, can_manage: canManage } });

function routeGets(canManage: boolean) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/v2/users/search')) {
      // The real endpoint answers { items: [...] } after the client unwraps `data`.
      return { success: true, data: { items: [{ id: 11, name: 'Bob Helper' }, { id: 42, name: 'Dee New', avatar_url: null }] } };
    }
    return teamResponse(canManage);
  });
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('OrgTeamTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { ok: true } });
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { ok: true } });
    vi.mocked(api.delete).mockResolvedValue({ success: true, data: { ok: true } });
  });

  it('shows an org admin the team with roles, and no way to change it', async () => {
    routeGets(false);
    render(<OrgTeamTab orgId={5} />);
    await screen.findByText('Bob Helper');

    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/organisations/5/members');
    expect(within(rowOf('Bob Helper')).getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Add someone to the team')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('lets an owner find someone not yet on the team and add them', async () => {
    routeGets(true);
    render(<OrgTeamTab orgId={5} />);
    await screen.findByText('Bob Helper');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a member of the community' }), 'de');
    // Bob is already on the team, so only Dee is offered.
    const choose = await screen.findByRole('button', { name: 'Choose Dee New' });
    expect(screen.queryByRole('button', { name: 'Choose Bob Helper' })).not.toBeInTheDocument();
    await userEvent.click(choose);
    await userEvent.click(screen.getByRole('button', { name: 'Add to team' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v2/volunteering/organisations/5/members', { user_id: 42, role: 'member' }));
    expect(mockToast.success).toHaveBeenCalledWith('Dee New has been added to the team.');
  });

  it('keeps the creator (here also yourself) locked and removes others after a confirm', async () => {
    routeGets(true);
    render(<OrgTeamTab orgId={5} />);
    await screen.findByText('Bob Helper');

    expect(within(rowOf('Cara Creator')).getByRole('button', { name: 'Remove Cara Creator' })).toBeDisabled();

    await userEvent.click(within(rowOf('Bob Helper')).getByRole('button', { name: 'Remove Bob Helper' }));
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(within(rowOf('Bob Helper')).getByRole('button', { name: 'Yes, remove' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/v2/volunteering/organisations/5/members/11'));
    expect(mockToast.success).toHaveBeenCalledWith('Bob Helper has been removed from the team.');
  });

  it('shows the server’s reason when a change is refused', async () => {
    routeGets(true);
    vi.mocked(api.delete).mockResolvedValue({ success: false, code: 'LAST_OWNER', error: 'An organisation must keep at least one owner.' });
    render(<OrgTeamTab orgId={5} />);
    await screen.findByText('Bob Helper');

    await userEvent.click(within(rowOf('Bob Helper')).getByRole('button', { name: 'Remove Bob Helper' }));
    await userEvent.click(within(rowOf('Bob Helper')).getByRole('button', { name: 'Yes, remove' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('An organisation must keep at least one owner.'));
  });

  it('says so when the team cannot be loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    render(<OrgTeamTab orgId={5} />);

    expect(await screen.findByText('The team could not be loaded.')).toBeInTheDocument();
  });
});
