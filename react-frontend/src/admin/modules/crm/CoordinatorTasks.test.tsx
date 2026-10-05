// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { createUser } from '@/test/factories';
import React from 'react';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminCrm } = vi.hoisted(() => ({
  mockAdminCrm: {
    getTasks: vi.fn(),
    getAdmins: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    exportTasks: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminCrm: mockAdminCrm,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stub heavy children ─────────────────────────────────────────────────────
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: createUser({ id: 1, name: 'Admin User' }),
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
  }),
);

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));

vi.mock('../../components/PageHeader', () => ({
  PageHeader: ({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
      {actions}
    </div>
  ),
}));

vi.mock('../../components/ConfirmModal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, title, message }: { isOpen: boolean; onConfirm: () => void; title: string; message: string }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{message}</p>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}));

vi.mock('../../components/MemberSearchPicker', () => ({
  MemberSearchPicker: ({ label, value, onValueChange }: { label: string; value: string; onValueChange: (v: string) => void }) => (
    <div data-testid="member-search-picker" data-value={value}>
      {label}
      <button onClick={() => onValueChange('42')}>pick-member-42</button>
    </div>
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const localKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const TODAY = localKey(new Date());
const YESTERDAY = localKey(new Date(Date.now() - 86_400_000));

const makeTask = (id: number, overrides = {}) => ({
  id,
  tenant_id: 2,
  assigned_to: 1,
  user_id: null,
  title: `Task ${id}`,
  description: `Description for task ${id}`,
  priority: 'medium' as const,
  status: 'pending' as const,
  due_date: null,
  completed_at: null,
  created_by: 1,
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-01T10:00:00Z',
  assigned_to_name: 'Admin User',
  created_by_name: 'Admin User',
  user_name: null,
  user_avatar: null,
  ...overrides,
});

const okTasks = (items = [makeTask(1)], meta = {}) => ({
  success: true,
  data: items,
  meta: { total: items.length, total_pages: 1, current_page: 1, per_page: 20, ...meta },
});

const okAdmins = () => ({
  success: true,
  data: [
    { id: 1, name: 'Admin User', email: 'admin@test.ie', avatar_url: '', role: 'admin' },
    { id: 7, name: 'Colleague', email: 'colleague@test.ie', avatar_url: '', role: 'coordinator' },
  ],
});

const DEFAULT_PARAMS = { page: 1, limit: 20, status: 'open' };

const waitForLoaded = () =>
  waitFor(() => {
    const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeUndefined();
  });

const quickToggle = (pressed: boolean) =>
  screen.getByRole('button', { name: /mark_task_as_status|Task 1/i, pressed });

const openActionsMenu = async () => {
  const trigger = screen.getAllByRole('button').find((b) =>
    /task actions|crm\.label_task_actions/i.test(b.getAttribute('aria-label') ?? ''),
  );
  expect(trigger).toBeDefined();
  fireEvent.click(trigger!);
  await waitFor(() => {
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
  });
  return screen.getAllByRole('menuitem');
};

async function renderPage() {
  const mod = await import('./CoordinatorTasks');
  const Component = mod.default;
  render(<Component />);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('CoordinatorTasks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.pushState({}, '', '/admin/crm/tasks');
    mockAdminCrm.getTasks.mockResolvedValue(okTasks());
    mockAdminCrm.getAdmins.mockResolvedValue(okAdmins());
    mockAdminCrm.createTask.mockResolvedValue({ success: true, data: makeTask(99) });
    mockAdminCrm.updateTask.mockResolvedValue({ success: true });
    mockAdminCrm.deleteTask.mockResolvedValue({ success: true });
    mockAdminCrm.exportTasks.mockResolvedValue(new Blob());
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  // ── loading / empty ────────────────────────────────────────────────────────
  it('shows a loading spinner while tasks load', async () => {
    mockAdminCrm.getTasks.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    const busy = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('opens on the open tasks and says all caught up when there are none', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([]));
    await renderPage();
    await waitForLoaded();

    expect(mockAdminCrm.getTasks).toHaveBeenCalledWith(DEFAULT_PARAMS);
    expect(screen.getByText(/all caught up|crm\.no_open_tasks$/i)).toBeInTheDocument();
    // Header button + empty-state button both offer to create a task.
    expect(screen.getAllByRole('button', { name: /create task|crm\.create_task/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('offers Clear filters in the empty state when a filter is active, and clearing resets the address', async () => {
    window.history.pushState({}, '', '/admin/crm/tasks?status=completed&priority=high');
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([]));
    await renderPage();
    await waitForLoaded();

    expect(mockAdminCrm.getTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', priority: 'high' }));
    expect(screen.getByText(/no tasks found|crm\.no_tasks_found/i)).toBeInTheDocument();

    const clearButtons = screen.getAllByRole('button', { name: /clear filters|crm\.clear_filters/i });
    fireEvent.click(clearButtons[clearButtons.length - 1]!);

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenLastCalledWith(DEFAULT_PARAMS);
    });
  });

  // ── filters in the address ─────────────────────────────────────────────────
  it('reads ?status=overdue so the CRM dashboard link lands on the overdue view', async () => {
    window.history.pushState({}, '', '/admin/crm/tasks?status=overdue');
    await renderPage();
    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'overdue' }));
    });
  });

  it('sends no status for ?status=all and ignores an unknown status', async () => {
    window.history.pushState({}, '', '/admin/crm/tasks?status=all');
    await renderPage();
    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });

    window.history.pushState({}, '', '/admin/crm/tasks?status=bogus&priority=nope&assigned_to=abc');
    mockAdminCrm.getTasks.mockClear();
    await renderPage();
    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenCalledWith(DEFAULT_PARAMS);
    });
  });

  it('passes priority, assignee, search and page from the address to the API', async () => {
    window.history.pushState({}, '', '/admin/crm/tasks?priority=urgent&assigned_to=7&q=call&page=3');
    await renderPage();
    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenCalledWith({
        page: 3, limit: 20, status: 'open', priority: 'urgent', assigned_to: 7, search: 'call',
      });
    });
  });

  it('puts the chosen status into the address when a status toggle is pressed', async () => {
    await renderPage();
    await waitForLoaded();

    fireEvent.click(screen.getByText(/^completed$|crm\.status_completed/i));

    await waitFor(() => {
      expect(window.location.search).toContain('status=completed');
    });
    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' }));
    });
  });

  it('waits for a pause in typing before searching, then puts the search in the address', async () => {
    await renderPage();
    await waitForLoaded();
    expect(mockAdminCrm.getTasks).toHaveBeenCalledTimes(1);

    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'c' } });
    fireEvent.change(search, { target: { value: 'ca' } });
    fireEvent.change(search, { target: { value: 'cal' } });

    expect(mockAdminCrm.getTasks).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockAdminCrm.getTasks).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'cal' }));
    });
    expect(mockAdminCrm.getTasks).toHaveBeenCalledTimes(2);
    expect(window.location.search).toContain('q=cal');
  });

  // ── card content ───────────────────────────────────────────────────────────
  it('renders the title, description, assignee, related member link and author line', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([
      makeTask(1, { user_id: 10, user_name: 'Alice Member', assigned_to: 7, assigned_to_name: 'Colleague' }),
    ]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    expect(screen.getByText('Description for task 1')).toBeInTheDocument();
    expect(screen.getByText(/assigned to colleague|crm\.task_assigned_to_name/i)).toBeInTheDocument();
    const memberLink = screen.getByRole('link', { name: /alice member|crm\.task_about_member/i });
    expect(memberLink).toHaveAttribute('href', '/test/admin/users/10/edit');
    expect(screen.getByText(/created by admin user|crm\.task_created_by/i)).toBeInTheDocument();
  });

  it('says "assigned to you" for the signed-in admin', async () => {
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));
    expect(screen.getByText(/assigned to you|crm\.task_assigned_to_you/i)).toBeInTheDocument();
  });

  it('shows a results summary with the total from the API', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([makeTask(1)], { total: 37 }));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));
    expect(screen.getByText(/37/)).toBeInTheDocument();
  });

  // ── due dates ──────────────────────────────────────────────────────────────
  it('marks an open task past its due date as overdue', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([makeTask(1, { due_date: YESTERDAY, status: 'pending' })]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    expect(document.querySelectorAll('.border-l-danger').length).toBeGreaterThan(0);
    expect(screen.getByText(/^overdue$|crm\.status_overdue/i, { selector: 'span, div' })).toBeInTheDocument();
  });

  it('does not mark a task due today as overdue, and says it is due today', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([makeTask(1, { due_date: TODAY, status: 'pending' })]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    expect(document.querySelectorAll('.border-l-danger')).toHaveLength(0);
    expect(screen.getByText(/due today|crm\.due_today/i)).toBeInTheDocument();
  });

  it('does not mark a completed task past its due date as overdue', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([
      makeTask(1, { due_date: YESTERDAY, status: 'completed', completed_at: '2026-06-02T09:00:00Z' }),
    ]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    expect(document.querySelectorAll('.border-l-danger')).toHaveLength(0);
    expect(screen.getByText('Task 1').className).toMatch(/line-through/);
    expect(screen.getByText(/completed .*2026|crm\.task_completed_on/i)).toBeInTheDocument();
  });

  // ── quick complete ─────────────────────────────────────────────────────────
  it('renders the quick-complete control as a labelled button and completes the task', async () => {
    mockAdminCrm.getTasks
      .mockResolvedValueOnce(okTasks())
      .mockResolvedValue(okTasks([makeTask(1, { status: 'completed' })]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const toggle = quickToggle(false);
    expect(toggle.className).toMatch(/border-2/);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockAdminCrm.updateTask).toHaveBeenCalledWith(1, { status: 'completed' });
    });
    await waitFor(() => {
      expect(quickToggle(true)).toBeInTheDocument();
    });
  });

  it('reopens a completed task from the quick-complete button', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([makeTask(1, { status: 'completed' })]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    fireEvent.click(quickToggle(true));

    await waitFor(() => {
      expect(mockAdminCrm.updateTask).toHaveBeenCalledWith(1, { status: 'pending' });
    });
  });

  // ── actions menu ───────────────────────────────────────────────────────────
  it('offers Mark in progress and Cancel task for a pending task', async () => {
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const labels = (await openActionsMenu()).map((i) => i.textContent ?? '');
    expect(labels.some((l) => /mark in progress|crm\.action_mark_in_progress/i.test(l))).toBe(true);
    expect(labels.some((l) => /cancel task|crm\.action_cancel_task/i.test(l))).toBe(true);
    expect(labels.some((l) => /reopen task|crm\.action_reopen_task/i.test(l))).toBe(false);
  });

  it('offers only Reopen (not Mark in progress or Cancel task) for a completed task', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([makeTask(1, { status: 'completed' })]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const labels = (await openActionsMenu()).map((i) => i.textContent ?? '');
    expect(labels.some((l) => /reopen task|crm\.action_reopen_task/i.test(l))).toBe(true);
    expect(labels.some((l) => /mark in progress|crm\.action_mark_in_progress/i.test(l))).toBe(false);
    expect(labels.some((l) => /cancel task|crm\.action_cancel_task/i.test(l))).toBe(false);
  });

  it('does not offer Mark in progress for a task already in progress', async () => {
    mockAdminCrm.getTasks.mockResolvedValue(okTasks([makeTask(1, { status: 'in_progress' })]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const labels = (await openActionsMenu()).map((i) => i.textContent ?? '');
    expect(labels.some((l) => /mark in progress|crm\.action_mark_in_progress/i.test(l))).toBe(false);
    expect(labels.some((l) => /cancel task|crm\.action_cancel_task/i.test(l))).toBe(true);
  });

  it('cancels a task from the actions menu', async () => {
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const items = await openActionsMenu();
    fireEvent.click(items.find((i) => /cancel task|crm\.action_cancel_task/i.test(i.textContent ?? ''))!);

    await waitFor(() => {
      expect(mockAdminCrm.updateTask).toHaveBeenCalledWith(1, { status: 'cancelled' });
    });
  });

  it('asks for confirmation naming the task, then deletes it', async () => {
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const items = await openActionsMenu();
    fireEvent.click(items.find((i) => /^delete$|crm\.action_delete/i.test(i.textContent ?? ''))!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Task 1|crm\.delete_task_confirm_named/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Confirm'));

    await waitFor(() => {
      expect(mockAdminCrm.deleteTask).toHaveBeenCalledWith(1);
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  // ── create ─────────────────────────────────────────────────────────────────
  it('assigns a new task to the signed-in admin by default and reports success', async () => {
    mockAdminCrm.getTasks
      .mockResolvedValueOnce(okTasks())
      .mockResolvedValue(okTasks([makeTask(1), makeTask(99)]));
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const createBtn = screen.getAllByRole('button').find((b) => /create task|crm\.create_task/i.test(b.textContent ?? ''));
    fireEvent.click(createBtn!);
    const dialog = await screen.findByRole('dialog');

    const titleInput = Array.from(dialog.querySelectorAll('input')).find(
      (el) => !el.getAttribute('type') || el.getAttribute('type') === 'text',
    )!;
    fireEvent.change(titleInput, { target: { value: 'Call Mary' } });

    const saveBtn = Array.from(dialog.querySelectorAll('button')).find((b) => /create task|crm\.create_task/i.test(b.textContent ?? ''))!;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminCrm.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Call Mary', assigned_to: 1, priority: 'medium' }),
      );
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('refuses to save a task without a title', async () => {
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    const createBtn = screen.getAllByRole('button').find((b) => /create task|crm\.create_task/i.test(b.textContent ?? ''));
    fireEvent.click(createBtn!);
    const dialog = await screen.findByRole('dialog');
    const saveBtn = Array.from(dialog.querySelectorAll('button')).find((b) => /create task|crm\.create_task/i.test(b.textContent ?? ''))!;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockAdminCrm.createTask).not.toHaveBeenCalled();
  });

  // ── export / errors ────────────────────────────────────────────────────────
  it('downloads the CSV from the Export tasks button', async () => {
    await renderPage();
    await waitFor(() => screen.getByText('Task 1'));

    fireEvent.click(screen.getByRole('button', { name: /export tasks|crm\.export_tasks/i }));

    await waitFor(() => {
      expect(mockAdminCrm.exportTasks).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows an error toast when the task list fails to load', async () => {
    mockAdminCrm.getTasks.mockRejectedValue(new Error('network'));
    await renderPage();
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
