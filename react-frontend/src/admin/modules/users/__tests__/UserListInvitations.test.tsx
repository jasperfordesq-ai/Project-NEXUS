// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Send invitation" (bulk action) and "Invite everyone who has never signed in"
 * (the Never logged in tab) on the admin member list. Both only queue welcome
 * emails; the toasts must report the server's counts in the admin's language
 * and never the server's own text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminUsers, mockInvitations, searchState } = vi.hoisted(() => ({
  mockAdminUsers: {
    list: vi.fn(),
    exportAllMembers: vi.fn(),
    bulkApprove: vi.fn(),
    bulkSuspend: vi.fn(),
  },
  mockInvitations: {
    sendSelected: vi.fn(),
    neverSignedInCount: vi.fn(),
    inviteEveryone: vi.fn(),
  },
  searchState: { params: new URLSearchParams() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: mockAdminUsers,
  adminMemberInvitations: mockInvitations,
  adminMemberImport: { downloadTemplate: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [searchState.params, vi.fn()],
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/admin/AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

// The table stub offers one control: select members 42 and 43.
vi.mock('@/admin/components/DataTable', () => ({
  DataTable: ({ onSelectionChange }: { onSelectionChange?: (keys: Set<string>) => void }) => (
    <button type="button" onClick={() => onSelectionChange?.(new Set(['42', '43']))}>select two</button>
  ),
  StatusBadge: () => null,
}));

vi.mock('@/admin/components/PageHeader', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div><h1>{title}</h1>{actions}</div>
  ),
}));

vi.mock('@/admin/components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onClose, title, message, confirmLabel }: {
    isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string; message: string; confirmLabel?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p data-testid="confirm-message">{message}</p>
        <button type="button" onClick={onConfirm}>{confirmLabel ?? 'Confirm'}</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

// The toolbar stub shows each action and runs it straight away (the real one confirms first).
vi.mock('@/admin/components/BulkActionToolbar', () => ({
  BulkActionToolbar: ({ selectedCount, actions }: {
    selectedCount: number;
    actions: Array<{ key: string; label: string; confirmMessage?: string; onConfirm: () => Promise<void> | void }>;
  }) =>
    selectedCount > 0 ? (
      <div data-testid="bulk-toolbar">
        {actions.map((a) => (
          <button key={a.key} type="button" data-confirm={a.confirmMessage} onClick={() => void a.onConfirm()}>{a.label}</button>
        ))}
      </div>
    ) : null,
}));

import { UserList } from '../UserList';

const skipped = (over: Record<string, number> = {}) => ({
  not_found: 0, not_member: 0, not_active: 0, signed_in: 0, suppressed: 0,
  undeliverable: 0, already_queued: 0, recently_invited: 0, ...over,
});

describe('UserList — welcome invitations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    searchState.params = new URLSearchParams();
    mockAdminUsers.list.mockResolvedValue({ success: true, data: [] });
  });

  describe('Send invitation (selected members)', () => {
    it('queues the selected members and reports the counts, never the server text', async () => {
      mockInvitations.sendSelected.mockResolvedValue({
        success: true,
        message: 'SERVER TEXT',
        data: { queued: 1, skipped: skipped({ signed_in: 1, not_member: 1 }), eta_minutes: 3 },
      });
      render(<UserList />);

      fireEvent.click(await screen.findByText('select two'));
      const action = await screen.findByRole('button', { name: 'Send invitation' });
      expect(action.getAttribute('data-confirm')).toBe(
        'Send the welcome email with a set-password link to the selected members who have never signed in?',
      );
      fireEvent.click(action);

      await waitFor(() => expect(mockInvitations.sendSelected).toHaveBeenCalledWith([42, 43]));
      await waitFor(() => expect(mockToast.success).toHaveBeenCalledTimes(1));
      const text = mockToast.success.mock.calls[0]?.[0] as string;
      expect(text).toBe(
        '1 welcome email is queued and will go out over about 3 minutes. '
        + '2 members were skipped (already signed in, already invited, or not eligible).',
      );
      expect(text).not.toContain('SERVER TEXT');
    });

    it('says nothing was queued when every selected member was skipped', async () => {
      mockInvitations.sendSelected.mockResolvedValue({
        success: true,
        data: { queued: 0, skipped: skipped({ already_queued: 1234 }), eta_minutes: 0 },
      });
      render(<UserList />);

      fireEvent.click(await screen.findByText('select two'));
      fireEvent.click(await screen.findByRole('button', { name: 'Send invitation' }));

      await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith(
        'No welcome emails were queued. 1,234 members were skipped (already signed in, already invited, or not eligible).',
      ));
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('shows a translated error when the request fails', async () => {
      mockInvitations.sendSelected.mockResolvedValue({ success: false, error: 'SERVER TEXT', code: 'RATE_LIMIT_EXCEEDED' });
      render(<UserList />);

      fireEvent.click(await screen.findByText('select two'));
      fireEvent.click(await screen.findByRole('button', { name: 'Send invitation' }));

      await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Too many requests in a row. Wait a minute and try again.'));
    });
  });

  describe('Invite everyone who has never signed in', () => {
    beforeEach(() => {
      searchState.params = new URLSearchParams('filter=never_logged_in');
    });

    it('is not offered on other tabs', async () => {
      searchState.params = new URLSearchParams();
      render(<UserList />);
      await waitFor(() => expect(mockAdminUsers.list).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Invite everyone who has never signed in' })).not.toBeInTheDocument();
      expect(mockInvitations.neverSignedInCount).not.toHaveBeenCalled();
    });

    it('says everyone is already invited when nobody is left', async () => {
      mockInvitations.neverSignedInCount.mockResolvedValue({ success: true, data: { eligible: 0, pending: 4, eta_minutes: 1 } });
      render(<UserList />);

      expect(await screen.findByText('No one on this list can be invited right now.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Invite everyone who has never signed in' })).not.toBeInTheDocument();
    });

    it('confirms the fresh count, queues them, and reports the result', async () => {
      mockInvitations.neverSignedInCount
        .mockResolvedValueOnce({ success: true, data: { eligible: 120, pending: 0, eta_minutes: 3 } })
        .mockResolvedValueOnce({ success: true, data: { eligible: 1500, pending: 0, eta_minutes: 30 } })
        .mockResolvedValue({ success: true, data: { eligible: 0, pending: 1500, eta_minutes: 30 } });
      mockInvitations.inviteEveryone.mockResolvedValue({
        success: true,
        data: { queued: 1500, skipped: skipped({ signed_in: 0 }), eta_minutes: 30 },
      });
      render(<UserList />);

      fireEvent.click(await screen.findByRole('button', { name: 'Invite everyone who has never signed in' }));

      const dialog = await screen.findByRole('dialog', { name: 'Invite everyone who has never signed in' });
      expect(dialog).toHaveTextContent('Email 1,500 members? The emails go out over about 30 minutes.');
      fireEvent.click(screen.getByRole('button', { name: 'Send the emails' }));

      await waitFor(() => expect(mockInvitations.inviteEveryone).toHaveBeenCalledWith(1500));
      await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(
        '1,500 welcome emails are queued and will go out over about 30 minutes.',
      ));
      expect(await screen.findByText('No one on this list can be invited right now.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('asks again with the new number when the count changed', async () => {
      mockInvitations.neverSignedInCount
        .mockResolvedValueOnce({ success: true, data: { eligible: 5, pending: 0, eta_minutes: 1 } })
        .mockResolvedValueOnce({ success: true, data: { eligible: 5, pending: 0, eta_minutes: 1 } })
        .mockResolvedValueOnce({ success: true, data: { eligible: 7, pending: 0, eta_minutes: 1 } })
        .mockResolvedValue({ success: true, data: { eligible: 0, pending: 7, eta_minutes: 1 } });
      mockInvitations.inviteEveryone
        .mockResolvedValueOnce({ success: false, code: 'COUNT_CHANGED', error: 'SERVER TEXT' })
        .mockResolvedValueOnce({ success: true, data: { queued: 7, skipped: skipped(), eta_minutes: 1 } });
      render(<UserList />);

      fireEvent.click(await screen.findByRole('button', { name: 'Invite everyone who has never signed in' }));
      await screen.findByRole('dialog');
      expect(screen.getByTestId('confirm-message')).toHaveTextContent('Email 5 members?');
      fireEvent.click(screen.getByRole('button', { name: 'Send the emails' }));

      await waitFor(() => expect(screen.getByTestId('confirm-message')).toHaveTextContent(
        'The number has changed since you last looked. Check it and confirm again. Email 7 members? The emails go out over about 1 minute.',
      ));
      expect(mockInvitations.inviteEveryone).toHaveBeenNthCalledWith(1, 5);
      expect(mockToast.error).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Send the emails' }));
      await waitFor(() => expect(mockInvitations.inviteEveryone).toHaveBeenNthCalledWith(2, 7));
      await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(
        '7 welcome emails are queued and will go out over about 1 minute.',
      ));
    });

    it('closes and says so when nobody is left after the count changed', async () => {
      mockInvitations.neverSignedInCount
        .mockResolvedValueOnce({ success: true, data: { eligible: 2, pending: 0, eta_minutes: 1 } })
        .mockResolvedValueOnce({ success: true, data: { eligible: 2, pending: 0, eta_minutes: 1 } })
        .mockResolvedValue({ success: true, data: { eligible: 0, pending: 2, eta_minutes: 1 } });
      mockInvitations.inviteEveryone.mockResolvedValue({ success: false, code: 'COUNT_CHANGED' });
      render(<UserList />);

      fireEvent.click(await screen.findByRole('button', { name: 'Invite everyone who has never signed in' }));
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Send the emails' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mockToast.info).toHaveBeenCalledWith('No one on this list can be invited right now.');
      expect(mockInvitations.inviteEveryone).toHaveBeenCalledTimes(1);
    });

    it('does not reopen a window the admin closed while the request was running', async () => {
      let answer: (value: unknown) => void = () => {};
      mockInvitations.neverSignedInCount
        .mockResolvedValueOnce({ success: true, data: { eligible: 5, pending: 0, eta_minutes: 1 } })
        .mockResolvedValueOnce({ success: true, data: { eligible: 5, pending: 0, eta_minutes: 1 } })
        .mockResolvedValue({ success: true, data: { eligible: 7, pending: 0, eta_minutes: 1 } });
      mockInvitations.inviteEveryone.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      render(<UserList />);

      fireEvent.click(await screen.findByRole('button', { name: 'Invite everyone who has never signed in' }));
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Send the emails' }));
      await waitFor(() => expect(mockInvitations.inviteEveryone).toHaveBeenCalledWith(5));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      answer({ success: false, code: 'COUNT_CHANGED' });

      // The number on the tab is brought up to date, but nothing pops up unasked.
      await waitFor(() => expect(mockInvitations.neverSignedInCount).toHaveBeenCalledTimes(3));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.info).not.toHaveBeenCalled();
    });

    it('says the count could not be checked and offers to try again', async () => {
      mockInvitations.neverSignedInCount
        .mockResolvedValueOnce({ success: false, code: 'SERVER_ERROR', error: 'SERVER TEXT' })
        .mockResolvedValue({ success: true, data: { eligible: 3, pending: 0, eta_minutes: 1 } });
      render(<UserList />);

      expect(await screen.findByText('Could not check who can be invited. Try again.')).toBeInTheDocument();
      expect(screen.queryByText('SERVER TEXT')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByRole('button', { name: 'Invite everyone who has never signed in' })).toBeInTheDocument();
      expect(screen.queryByText('Could not check who can be invited. Try again.')).not.toBeInTheDocument();
    });
  });
});
