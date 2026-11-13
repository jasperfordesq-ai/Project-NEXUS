// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminSettings } = vi.hoisted(() => ({
  mockAdminSettings: {
    getNativeAppMembers: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts({}));

vi.mock('../../api/adminApi', () => ({
  adminSettings: mockAdminSettings,
}));

import { NativeAppMembersTable } from './NativeAppMembersTable';

const aoife = {
  user_id: 41,
  display_name: 'Aoife Brennan',
  username: 'aoife',
  email: 'aoife@example.test',
  phones: ['android'],
  notifications_on: true,
  first_seen_at: '2026-09-04T20:25:28+00:00',
  last_opened_at: '2026-11-12T09:00:00+00:00',
};

const conor = {
  user_id: 42,
  display_name: 'Conor Walsh',
  username: 'cwalsh',
  email: 'conor@example.test',
  phones: [],
  notifications_on: false,
  first_seen_at: '2026-11-01T10:00:00+00:00',
  last_opened_at: '2026-11-10T18:30:00+00:00',
};

const page = (rows: unknown[], total = rows.length) => ({ success: true, data: rows, meta: { total } });

describe('NativeAppMembersTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([aoife, conor]));
  });

  it('lists each member with their name and email', async () => {
    render(<NativeAppMembersTable />);

    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());
    expect(screen.getByText('aoife@example.test')).toBeInTheDocument();
    expect(screen.getByText('Conor Walsh')).toBeInTheDocument();
  });

  it('links a member to their admin page', async () => {
    render(<NativeAppMembersTable />);

    const link = await screen.findByRole('link', { name: 'Aoife Brennan' });
    expect(link).toHaveAttribute('href', '/test/admin/users/41/edit');
  });

  it('says Android or iPhone in plain words, and "Not known yet" when notifications are off', async () => {
    render(<NativeAppMembersTable />);

    await waitFor(() => expect(screen.getByText('Android')).toBeInTheDocument());
    expect(screen.getByText('Not known yet')).toBeInTheDocument();
    // The raw values the server sends are never shown.
    expect(screen.queryByText('android')).not.toBeInTheDocument();
    expect(screen.queryByText('ios')).not.toBeInTheDocument();
  });

  it('shows whether each member has notifications turned on', async () => {
    render(<NativeAppMembersTable />);

    await waitFor(() => expect(screen.getByText('On')).toBeInTheDocument());
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('shows an iPhone and an Android together for a member with both', async () => {
    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([{ ...aoife, phones: ['android', 'ios'] }]));
    render(<NativeAppMembersTable />);

    await waitFor(() => expect(screen.getByText('iPhone')).toBeInTheDocument());
    expect(screen.getByText('Android')).toBeInTheDocument();
  });

  it('falls back to the username when a member has no name', async () => {
    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([{ ...aoife, display_name: null, username: 'quietone' }]));
    render(<NativeAppMembersTable />);

    await waitFor(() => expect(screen.getByText('@quietone')).toBeInTheDocument());
  });

  it('asks the server for the first page on arrival', async () => {
    render(<NativeAppMembersTable />);

    await waitFor(() => expect(mockAdminSettings.getNativeAppMembers).toHaveBeenCalledTimes(1));
    expect(mockAdminSettings.getNativeAppMembers).toHaveBeenCalledWith({ q: undefined, page: 1, per_page: 25 });
  });

  it('searches on the server as the admin types', async () => {
    const user = userEvent.setup();
    render(<NativeAppMembersTable />);
    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());

    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([conor]));
    await user.type(screen.getByPlaceholderText('Search by name or email'), 'conor');

    await waitFor(() =>
      expect(mockAdminSettings.getNativeAppMembers).toHaveBeenLastCalledWith({ q: 'conor', page: 1, per_page: 25 }),
    );
    await waitFor(() => expect(screen.queryByText('Aoife Brennan')).not.toBeInTheDocument());
    expect(screen.getByText('Conor Walsh')).toBeInTheDocument();
  });

  it('asks for the next page when there are more members than fit on one', async () => {
    const user = userEvent.setup();
    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([aoife, conor], 60));
    render(<NativeAppMembersTable />);
    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^(go to page )?2$/i }));

    await waitFor(() =>
      expect(mockAdminSettings.getNativeAppMembers).toHaveBeenLastCalledWith({ q: undefined, page: 2, per_page: 25 }),
    );
  });

  it('steps back to the last page that still has members, instead of looking empty', async () => {
    // Admin is on page 2 of 26 members; one signs out; Refresh. The server now
    // has a single page. Showing "nobody has the app" here would be untrue.
    const user = userEvent.setup();
    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([aoife, conor], 26));
    render(<NativeAppMembersTable />);
    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());

    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([conor], 26));
    await user.click(screen.getByRole('button', { name: /^(go to page )?2$/i }));
    await waitFor(() =>
      expect(mockAdminSettings.getNativeAppMembers).toHaveBeenLastCalledWith({ q: undefined, page: 2, per_page: 25 }),
    );

    mockAdminSettings.getNativeAppMembers.mockImplementation(({ page: asked }: { page: number }) =>
      Promise.resolve(asked === 1 ? page([aoife], 25) : page([], 25)),
    );
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() =>
      expect(mockAdminSettings.getNativeAppMembers).toHaveBeenLastCalledWith({ q: undefined, page: 1, per_page: 25 }),
    );
    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());
    expect(screen.queryByText('No members are signed in on the app yet.')).not.toBeInTheDocument();
  });

  it('says so plainly when nobody has the app yet', async () => {
    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([]));
    render(<NativeAppMembersTable />);

    await waitFor(() =>
      expect(screen.getByText('No members are signed in on the app yet.')).toBeInTheDocument(),
    );
  });

  it('says nobody matches when a search finds no one', async () => {
    const user = userEvent.setup();
    render(<NativeAppMembersTable />);
    await waitFor(() => expect(screen.getByText('Aoife Brennan')).toBeInTheDocument());

    mockAdminSettings.getNativeAppMembers.mockResolvedValue(page([]));
    await user.type(screen.getByPlaceholderText('Search by name or email'), 'zzz');

    await waitFor(() => expect(screen.getByText('No members match your search.')).toBeInTheDocument());
    expect(screen.queryByText('No members are signed in on the app yet.')).not.toBeInTheDocument();
  });

  it('reports a failed load instead of looking empty', async () => {
    mockAdminSettings.getNativeAppMembers.mockRejectedValue(new Error('network'));
    render(<NativeAppMembersTable />);

    await waitFor(() =>
      expect(screen.getByText("We couldn't load this list. Please try again.")).toBeInTheDocument(),
    );
    expect(screen.queryByText('No members are signed in on the app yet.')).not.toBeInTheDocument();
  });
});
