// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';
import type { CrmDashboardStats } from '../../api/types';

// ── Stable hoisted refs ───────────────────────────────────────────────────────
const { mockToast, mockGetDashboard, mockExports } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockGetDashboard: vi.fn(),
  mockExports: {
    exportDashboard: vi.fn(),
    exportNotes: vi.fn(),
    exportTasks: vi.fn(),
    exportTags: vi.fn(),
    exportTimeline: vi.fn(),
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 7, name: 'Coordinator Casey' } as unknown as User,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

vi.mock('../../api/adminApi', () => ({
  adminCrm: {
    getDashboard: mockGetDashboard,
    ...mockExports,
  },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

import { CrmDashboard } from './CrmDashboard';

// ── Test data ─────────────────────────────────────────────────────────────────
const todayKey = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const shiftDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const DASHBOARD_DATA: CrmDashboardStats = {
  total_members: 1500,
  active_members: 800,
  new_this_month: 45,
  pending_approvals: 12,
  open_tasks: 9,
  overdue_tasks: 3,
  tasks_due_today: 2,
  my_tasks: { open: 7, overdue: 1, due_today: 1 },
  next_tasks: [
    { id: 1, title: 'Call Priya about the garden swap', priority: 'urgent', status: 'pending', due_date: shiftDays(-2), user_id: 31, user_name: 'Priya Nair' },
    { id: 2, title: 'Welcome pack for new joiners', priority: 'medium', status: 'in_progress', due_date: todayKey, user_id: null, user_name: null },
    { id: 3, title: 'Chase the hall booking', priority: 'low', status: 'pending', due_date: null, user_id: null, user_name: null },
  ],
  total_notes: 234,
  notes_last_30_days: 18,
  recent_notes: [
    { id: 11, user_id: 31, user_name: 'Priya Nair', user_avatar: null, author_name: 'Sam Okafor', category: 'concern', is_pinned: true, created_at: minutesAgo(5), excerpt: 'Missed two swaps in a row, worth a gentle check-in…' },
    { id: 12, user_id: 32, user_name: 'Tomás Reyes', user_avatar: null, author_name: 'Coordinator Casey', category: 'onboarding', is_pinned: false, created_at: minutesAgo(60 * 30), excerpt: 'Finished the welcome call, keen on gardening.' },
  ],
  tags_in_use: 14,
  tagged_members: 96,
  never_logged_in: 150,
  retention_rate: 53.3,
};

const QUIET_DATA: CrmDashboardStats = {
  ...DASHBOARD_DATA,
  pending_approvals: 0,
  overdue_tasks: 0,
  tasks_due_today: 0,
  my_tasks: { open: 0, overdue: 0, due_today: 0 },
  next_tasks: [],
  recent_notes: [],
};

const renderLoaded = async (data: CrmDashboardStats = DASHBOARD_DATA) => {
  mockGetDashboard.mockResolvedValue({ success: true, data });
  const view = render(<CrmDashboard />);
  await screen.findByText('1,500');
  return view;
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('CrmDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(mockExports)) fn.mockResolvedValue(undefined);
  });

  it('shows a loading spinner while fetching', () => {
    mockGetDashboard.mockReturnValue(new Promise(() => {}));
    render(<CrmDashboard />);
    const busy = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeTruthy();
  });

  it('renders the eight figures with their hints', async () => {
    await renderLoaded();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('234')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    // Never signed in, active share, my open tasks, recent notes and tagged members sit under the figures.
    expect(screen.getByText(/never signed in: 150/i)).toBeInTheDocument();
    expect(screen.getByText(/53% of members/i)).toBeInTheDocument();
    expect(screen.getByText(/assigned to you: 7/i)).toBeInTheDocument();
    expect(screen.getByText(/added in the last 30 days: 18/i)).toBeInTheDocument();
    expect(screen.getByText(/members with a tag: 96/i)).toBeInTheDocument();
  });

  it('links each figure to the page it comes from', async () => {
    await renderLoaded();
    expect(screen.getByRole('link', { name: /^members$/i })).toHaveAttribute('href', '/test/admin/users');
    expect(screen.getByRole('link', { name: /^waiting for approval$/i })).toHaveAttribute('href', '/test/admin/users?filter=pending');
    expect(screen.getByRole('link', { name: /^open tasks$/i })).toHaveAttribute('href', '/test/admin/crm/tasks');
    expect(screen.getByRole('link', { name: /^overdue tasks$/i })).toHaveAttribute('href', '/test/admin/crm/tasks?status=overdue');
    expect(screen.getByRole('link', { name: /^member notes$/i })).toHaveAttribute('href', '/test/admin/crm/notes');
    expect(screen.getByRole('link', { name: /^tags in use$/i })).toHaveAttribute('href', '/test/admin/crm/tags');
  });

  it('lists what is waiting on a coordinator, most urgent first, as links with the filter applied', async () => {
    await renderLoaded();
    const strip = screen.getByTestId('crm-attention');
    expect(within(strip).getByText(/waiting on a coordinator right now: 17/i)).toBeInTheDocument();
    const links = within(strip).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual(['Overdue tasks: 3', 'Due today: 2', 'Waiting for approval: 12']);
    expect(links[0]!).toHaveAttribute('href', '/test/admin/crm/tasks?status=overdue');
    expect(links[1]!).toHaveAttribute('href', '/test/admin/crm/tasks?status=open');
    expect(links[2]!).toHaveAttribute('href', '/test/admin/users?filter=pending');
  });

  it('says nothing is waiting when every queue is empty', async () => {
    await renderLoaded(QUIET_DATA);
    expect(screen.getByTestId('crm-attention-clear')).toHaveTextContent(/nothing is waiting on you/i);
    expect(screen.queryByTestId('crm-attention')).not.toBeInTheDocument();
    expect(screen.getByText(/nothing is overdue/i)).toBeInTheDocument();
  });

  it('lists the next tasks assigned to me with their due state and the member they are about', async () => {
    await renderLoaded();
    const list = screen.getByTestId('crm-next-tasks');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('Call Priya about the garden swap')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/about priya nair/i)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Overdue')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Urgent')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Due today')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('No due date')).toBeInTheDocument();
    // Every row and the footer open the tasks page filtered to me.
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/test/admin/crm/tasks?assigned_to=7');
    expect(screen.getByRole('link', { name: /all your tasks/i })).toHaveAttribute('href', '/test/admin/crm/tasks?assigned_to=7');
    expect(screen.getByText(/more open tasks assigned to you: 4/i)).toBeInTheDocument();
  });

  it('offers the task list when nothing is assigned to me', async () => {
    await renderLoaded(QUIET_DATA);
    expect(screen.getByText(/nothing is assigned to you/i)).toBeInTheDocument();
    expect(screen.getByText(/open tasks across the community: 9/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse all tasks/i })).toHaveAttribute('href', '/test/admin/crm/tasks');
    expect(screen.queryByTestId('crm-next-tasks')).not.toBeInTheDocument();
  });

  it('lists the recent notes with the member, category, pin and author, linking to that member’s notes', async () => {
    await renderLoaded();
    const list = screen.getByTestId('crm-recent-notes');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: /notes about priya nair/i })).toHaveAttribute('href', '/test/admin/crm/notes?user_id=31');
    expect(within(rows[0]!).getByText('Concern')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Pinned')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/missed two swaps/i)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/sam okafor/i)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/5 minutes ago/i)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Onboarding')).toBeInTheDocument();
    expect(within(rows[1]!).queryByText('Pinned')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all notes/i })).toHaveAttribute('href', '/test/admin/crm/notes');
  });

  it('explains when there are no notes yet', async () => {
    await renderLoaded(QUIET_DATA);
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
    expect(screen.getByText(/members never see them/i)).toBeInTheDocument();
  });

  it('offers every CRM tool as a card', async () => {
    await renderLoaded();
    const expected: Array<[RegExp, string]> = [
      [/member notes/i, '/test/admin/crm/notes'],
      [/coordinator tasks/i, '/test/admin/crm/tasks'],
      [/member tags/i, '/test/admin/crm/tags'],
      [/activity timeline/i, '/test/admin/crm/timeline'],
      [/onboarding funnel/i, '/test/admin/crm/funnel'],
      [/all members/i, '/test/admin/users'],
    ];
    for (const [name, href] of expected) {
      const matches = screen.getAllByRole('link', { name }).filter((l) => l.getAttribute('href') === href);
      expect(matches.length, `${name} -> ${href}`).toBeGreaterThan(0);
    }
  });

  it('shows when the figures were loaded', async () => {
    await renderLoaded();
    expect(screen.getByText(/figures as of/i)).toBeInTheDocument();
  });

  it('refreshes on demand and keeps the figures on screen while it does', async () => {
    await renderLoaded();
    mockGetDashboard.mockReturnValue(new Promise(() => {}));
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(mockGetDashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled();
  });

  it('exports the overview figures from the Export menu', async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /export overview figures/i }));
    await waitFor(() => expect(mockExports.exportDashboard).toHaveBeenCalledTimes(1));
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('offers the notes, tasks, tags and activity exports from the same menu', async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /export activity/i }));
    await waitFor(() => expect(mockExports.exportTimeline).toHaveBeenCalledTimes(1));
    expect(mockExports.exportDashboard).not.toHaveBeenCalled();
  });

  it('shows an error toast when an export fails', async () => {
    mockExports.exportTasks.mockRejectedValue(new Error('Download failed'));
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /export tasks/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows an error with Retry instead of zeros when the load fails', async () => {
    mockGetDashboard.mockRejectedValueOnce(new Error('Network error'));
    render(<CrmDashboard />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(mockToast.error).toHaveBeenCalled();
    expect(screen.queryByText(/never signed in/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-attention-clear')).not.toBeInTheDocument();

    mockGetDashboard.mockResolvedValue({ success: true, data: DASHBOARD_DATA });
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('1,500')).toBeInTheDocument();
  });

  it('treats an unsuccessful response as a failed load', async () => {
    mockGetDashboard.mockResolvedValue({ success: false, data: null });
    render(<CrmDashboard />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});
