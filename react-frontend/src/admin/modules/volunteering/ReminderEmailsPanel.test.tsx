// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';
import type { User } from '@/types';

// ─── Mock adminVolunteering API ───────────────────────────────────────────────
const { mockAdminVolunteering } = vi.hoisted(() => ({
  mockAdminVolunteering: {
    getReminderLogs: vi.fn(),
    sendShiftReminders: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// Stub HeroUI Select/Switch to avoid jsdom loops
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: { label?: string; children?: React.ReactNode; onSelectionChange?: (keys: Set<string>) => void }) => (
      <select aria-label={label ?? 'select'} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id ?? ''}>{children}</option>
    ),
  };
});

// ─── Mock contexts (the signed-in user is swappable per test) ─────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const superAdmin = { id: 1, name: 'Admin', is_super_admin: true, role: 'super_admin' } as unknown as User;
const ordinaryAdmin = { id: 2, name: 'Admin', role: 'admin' } as unknown as User;
const { authState } = vi.hoisted(() => ({
  authState: { user: { id: 1, name: 'Admin', is_super_admin: true, role: 'super_admin' } as unknown as User },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: authState.user,
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(),
      updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const, error: null,
    }),
    useToast: () => mockToast,
  })
);

const logRow = (id: number, type: string, name: string) => ({
  id,
  user_name: name,
  user_avatar: null,
  reminder_type: type,
  channel: 'email',
  sent_at: '2026-10-18T09:00:00Z',
});

async function renderPanel() {
  const { ReminderEmailsPanel } = await import('./ReminderEmailsPanel');
  render(<ReminderEmailsPanel />);
  await waitFor(() => expect(mockAdminVolunteering.getReminderLogs).toHaveBeenCalled());
}

describe('ReminderEmailsPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authState.user = superAdmin;
    mockAdminVolunteering.getReminderLogs.mockResolvedValue({
      success: true,
      data: [logRow(1, 'pre_shift', 'Maya Rivers'), logRow(2, 'lapsed_volunteer', 'Sam Okafor')],
      meta: { stats: { total_sent: 2, by_channel: { email: 2 }, by_type: { pre_shift: 1, lapsed_volunteer: 1 } } },
    });
    mockAdminVolunteering.sendShiftReminders.mockResolvedValue({ success: true, data: { reminders_sent: 3 } });
  });

  it('lists the recent reminder emails with the total sent', async () => {
    await renderPanel();

    expect(screen.getByText('Maya Rivers')).toBeInTheDocument();
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument();
    expect(screen.getByText(/2 (reminders? )?sent/i)).toBeInTheDocument();
  });

  it('reloads the list for the chosen reminder type', async () => {
    const user = userEvent.setup();
    await renderPanel();

    await user.selectOptions(screen.getByRole('combobox'), 'lapsed_volunteer');

    await waitFor(() =>
      expect(mockAdminVolunteering.getReminderLogs).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'lapsed_volunteer' })),
    );
  });

  it('lets a super admin run the due reminders now, after confirming', async () => {
    const user = userEvent.setup();
    await renderPanel();

    await user.click(screen.getByRole('button', { name: /run due reminders/i }));
    await user.click(screen.getByRole('button', { name: /^run reminders$/i }));

    await waitFor(() => expect(mockAdminVolunteering.sendShiftReminders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    // The list is refreshed so the admin sees what just went out.
    expect(mockAdminVolunteering.getReminderLogs.mock.calls.length).toBeGreaterThan(1);
  });

  it('does not offer the run-now button to an ordinary admin', async () => {
    authState.user = ordinaryAdmin;
    await renderPanel();

    expect(screen.queryByRole('button', { name: /run due reminders/i })).not.toBeInTheDocument();
  });

  it('says so when nothing has been sent yet', async () => {
    mockAdminVolunteering.getReminderLogs.mockResolvedValue({ success: true, data: [], meta: { stats: { total_sent: 0, by_channel: {}, by_type: {} } } });
    await renderPanel();

    await waitFor(() => expect(screen.getByText(/no delivery logs/i)).toBeInTheDocument());
  });
});
