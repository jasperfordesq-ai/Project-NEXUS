// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupMembersModal — list, add, remove and leave, against
 * GroupConversationController (participants / addParticipant /
 * removeParticipant). Admin-only add and remove; anyone may leave.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockAuth = vi.hoisted(() => ({ user: { id: 1, name: 'Ada Admin' } as { id: number; name: string } }));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: mockAuth.user, isAuthenticated: true }),
  useToast: () => mockToast,
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useTenant: () => ({ tenantPath: (p: string) => `/t${p}`, hasFeature: () => true, hasModule: () => true }),
}));

import { GroupMembersModal } from './GroupMembersModal';

const PARTICIPANTS = [
  { id: 1, name: 'Ada Admin', role: 'admin', avatar_url: null, is_online: true },
  { id: 2, name: 'Ben Member', role: 'member', avatar_url: null, is_online: false },
  { id: 3, name: 'Cara Member', role: 'member', avatar_url: null, is_online: false },
];

function routeGets(participants: Array<{ id: number; name: string; role: string }> = PARTICIPANTS, search: unknown[] = []) {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/v2/conversations/42/participants') return Promise.resolve({ success: true, data: participants });
    if (url.startsWith('/v2/users?q=')) return Promise.resolve({ success: true, data: search });
    return Promise.resolve({ success: false });
  });
}

function renderModal(props: Partial<Parameters<typeof GroupMembersModal>[0]> = {}) {
  const onLeft = vi.fn();
  render(<GroupMembersModal isOpen conversationId={42} onClose={vi.fn()} onLeft={onLeft} {...props} />);
  return { onLeft };
}

describe('GroupMembersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 1, name: 'Ada Admin' };
    routeGets();
  });

  it('lists the members with their roles', async () => {
    renderModal();
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText('Ben Member')).toBeInTheDocument();
    expect(within(dialog).getByText('Cara Member')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Admin').length).toBeGreaterThan(0);
    expect(mockApi.get).toHaveBeenCalledWith('/v2/conversations/42/participants');
  });

  it('lets an admin search for and add a member, excluding people already in the group', async () => {
    routeGets(PARTICIPANTS, [
      { id: 2, name: 'Ben Member' },
      { id: 9, name: 'Dev Newcomer' },
    ]);
    mockApi.post.mockResolvedValue({ success: true, data: { id: 42 } });
    const user = userEvent.setup();
    renderModal();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ben Member');

    await user.type(within(dialog).getByRole('textbox', { name: 'Search for a member...' }), 'de');

    const add = await within(dialog).findByRole('button', { name: 'Add Dev Newcomer to the group' });
    expect(within(dialog).queryByRole('button', { name: 'Add Ben Member to the group' })).not.toBeInTheDocument();
    await user.click(add);

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/conversations/42/participants', { user_id: 9 }));
    expect(mockToast.success).toHaveBeenCalledWith('Member added to group');
  });

  it('shows the server reason when adding is refused', async () => {
    routeGets(PARTICIPANTS, [{ id: 9, name: 'Dev Newcomer' }]);
    mockApi.post.mockResolvedValue({ success: false, code: 'BLOCKED', error: 'You cannot contact this member.' });
    const user = userEvent.setup();
    renderModal();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ben Member');

    await user.type(within(dialog).getByRole('textbox', { name: 'Search for a member...' }), 'de');
    await user.click(await within(dialog).findByRole('button', { name: 'Add Dev Newcomer to the group' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('You cannot contact this member.'));
  });

  it('lets an admin remove a member after confirming', async () => {
    mockApi.delete.mockResolvedValue({ success: true, data: { success: true } });
    const user = userEvent.setup();
    renderModal();
    const dialog = await screen.findByRole('dialog');

    await user.click(await within(dialog).findByRole('button', { name: 'Remove Ben Member from the group' }));
    expect(mockApi.delete).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Remove Ben Member from this group?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove' }));

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/conversations/42/participants/2'));
    expect(mockToast.success).toHaveBeenCalledWith('Member removed from group');
  });

  it('gives an ordinary member no add or remove controls, only leave', async () => {
    mockAuth.user = { id: 2, name: 'Ben Member' };
    renderModal();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Cara Member');

    expect(within(dialog).queryByRole('textbox', { name: 'Search for a member...' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Remove .* from the group/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Only group admins can add or remove members.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Leave Group' })).toBeInTheDocument();
  });

  it('lets a member leave after confirming', async () => {
    mockAuth.user = { id: 2, name: 'Ben Member' };
    mockApi.delete.mockResolvedValue({ success: true, data: { success: true } });
    const user = userEvent.setup();
    const { onLeft } = renderModal();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Cara Member');

    await user.click(within(dialog).getByRole('button', { name: 'Leave Group' }));
    expect(within(dialog).getByText("Are you sure you want to leave this group? You won't receive new messages.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Yes, leave' }));

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/conversations/42/participants/2'));
    expect(onLeft).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith('You left the group');
  });

  it('stops offering to add once the group has 50 members', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, role: i === 0 ? 'admin' : 'member' }));
    routeGets(full);
    renderModal();
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Person 50');

    expect(within(dialog).queryByRole('textbox', { name: 'Search for a member...' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('This group has the maximum of 50 members.')).toBeInTheDocument();
  });

  it('shows an error when the members cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false, code: 'FORBIDDEN' });
    renderModal();
    const dialog = await screen.findByRole('dialog');

    expect(await within(dialog).findByText('Could not load the group members. Please try again.')).toBeInTheDocument();
  });
});
