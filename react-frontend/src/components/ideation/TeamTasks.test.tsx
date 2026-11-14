// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, resolveAvatarUrl: (url: string | null) => url ?? '' };
});

// ─── Context / hooks ──────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
const mockConfirm = vi.fn(() => Promise.resolve(true));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice', role: 'member' },
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
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Component dependencies ───────────────────────────────────────────────────
vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/ConfirmDialog')>();
  return { ...actual, useConfirm: () => mockConfirm };
});

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeTask = (overrides = {}) => ({
  id: 1,
  group_id: 10,
  title: 'Fix the bug',
  description: 'A description',
  status: 'todo' as const,
  priority: 'medium' as const,
  assigned_to: null,
  created_by: 1,
  due_date: null,
  created_at: '2025-06-01T10:00:00Z',
  can_update_status: true,
  can_edit: true,
  can_delete: true,
  assignee: null,
  ...overrides,
});

const makeStats = (overrides = {}) => ({
  total: 3,
  todo: 1,
  in_progress: 1,
  done: 1,
  overdue: 0,
  ...overrides,
});

const taskResponse = (tasks = [] as object[]) => ({ success: true, data: tasks });
const statsResponse = (stats = makeStats()) => ({ success: true, data: stats });

// ─────────────────────────────────────────────────────────────────────────────
describe('TeamTasks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse());
    });
    mockApi.post.mockResolvedValue({ success: true });
    mockApi.put.mockResolvedValue({ success: true });
    mockApi.delete.mockResolvedValue({ success: true });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no tasks are returned', async () => {
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders task title when tasks are returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask()]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Fix the bug')).toBeInTheDocument();
    });
  });

  it('renders stats bar when stats are loaded', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse({ total: 5, done: 2, in_progress: 1, overdue: 0, todo: 2 }));
      return Promise.resolve(taskResponse([makeTask()]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('5 tasks')).toBeInTheDocument();
    });
  });

  it('shows overdue count in stats when overdue > 0', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse({ total: 3, done: 0, in_progress: 1, overdue: 2, todo: 2 }));
      return Promise.resolve(taskResponse([makeTask()]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('2 Overdue')).toBeInTheDocument();
    });
  });

  it('renders filter buttons (All, todo, in_progress, done)', async () => {
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await screen.findByTestId('empty-state');
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'To Do' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In Progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('renders Create task button', async () => {
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await screen.findByTestId('empty-state');
    expect(screen.getByRole('button', { name: 'Add Task' })).toBeInTheDocument();
  });

  it('opens create modal when create button is pressed', async () => {
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows delete button when the server grants can_delete and calls API on confirm', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask({ id: 42 })]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => screen.getByText('Fix the bug'));

    await userEvent.click(screen.getByRole('button', { name: 'Delete: Fix the bug' }));
    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/team-tasks/42');
    });
  });

  it('hides delete when the server denies can_delete even for a group admin prop', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask({ id: 99, can_delete: false })]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={true} />);
    await waitFor(() => screen.getByText('Fix the bug'));
    expect(
      screen.queryByRole('button', { name: 'Delete: Fix the bug' }),
    ).not.toBeInTheDocument();
  });

  it('calls PUT endpoint when task status toggle button is pressed', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask({ id: 7, status: 'todo' })]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => screen.getByText('Fix the bug'));

    const taskCard = screen.getByText('Fix the bug').closest('[data-slot="card"]');
    expect(taskCard).not.toBeNull();
    expect(within(taskCard!).getByTestId('task-row')).toHaveClass(
      'grid',
      'grid-cols-[auto_minmax(0,1fr)_auto]',
    );
    const statusButton = within(taskCard!).getByRole('button', { name: 'Status: In Progress' });
    expect(statusButton).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    await userEvent.click(statusButton);
    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/team-tasks/7', { status: 'in_progress' });
    });
  });

  it('renders a non-interactive status indicator when can_update_status is false', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask({ can_update_status: false })]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={true} />);

    const taskCard = (await screen.findByText('Fix the bug')).closest('[data-slot="card"]');
    expect(taskCard).not.toBeNull();
    expect(within(taskCard!).getByRole('img', { name: 'Status: To Do' })).toBeInTheDocument();
    expect(within(taskCard!).queryByRole('button', { name: /Status:/ })).not.toBeInTheDocument();
  });

  it('uses a two-column mobile filter grid and full-width mobile create action', async () => {
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await screen.findByTestId('empty-state');

    expect(screen.getByRole('group', { name: 'Status' })).toHaveClass('grid', 'grid-cols-2', 'sm:flex');
    expect(screen.getByRole('button', { name: 'Add Task' })).toHaveClass('w-full', 'sm:w-auto');
  });

  it('shows task description when present', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask({ description: 'My task description' })]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('My task description')).toBeInTheDocument();
    });
  });

  it('renders the low, medium, and high priority chips', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([
        makeTask({ id: 1, title: 'Low priority', priority: 'low' }),
        makeTask({ id: 2, title: 'Medium priority', priority: 'medium' }),
        makeTask({ id: 3, title: 'High priority', priority: 'high' }),
      ]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);

    expect(await screen.findByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows the assigned member name', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([
        makeTask({
          assigned_to: 2,
          assignee: { id: 2, name: 'Aisha Patel', avatar_url: null },
        }),
      ]));
    });
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={false} />);

    expect(await screen.findByText('Aisha Patel')).toBeInTheDocument();
  });

  it('shows error toast when task deletion fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('task-stats')) return Promise.resolve(statsResponse());
      return Promise.resolve(taskResponse([makeTask({ id: 55 })]));
    });
    mockApi.delete.mockRejectedValue(new Error('server error'));
    const { TeamTasks } = await import('./TeamTasks');
    render(<TeamTasks groupId={10} isGroupAdmin={true} />);
    await waitFor(() => screen.getByText('Fix the bug'));

    await userEvent.click(screen.getByRole('button', { name: 'Delete: Fix the bug' }));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("That didn't work. Please try again.");
    });
  });
});
