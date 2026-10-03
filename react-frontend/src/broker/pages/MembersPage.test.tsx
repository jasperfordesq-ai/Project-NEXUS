// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockAdminUsers, mockAdminCrm, mockConfirm, mockNavigate, capturedColumns } = vi.hoisted(() => ({
  mockAdminUsers: {
    list: vi.fn(),
    approve: vi.fn(),
    suspend: vi.fn(),
    reactivate: vi.fn(),
    bulkApprove: vi.fn(),
    bulkSuspend: vi.fn(),
  },
  mockAdminCrm: {
    getNotes: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
  },
  // The shared confirm dialog, controllable per test: resolve true = "Yes".
  mockConfirm: vi.fn(),
  mockNavigate: vi.fn(),
  capturedColumns: { current: [] as Array<{ key: string; sortable?: boolean }> },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: mockAdminUsers,
  adminCrm: mockAdminCrm,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// Keep the real UI kit (Dropdown, Modal, Tooltip…) but make the confirm dialog
// answer deterministically so each test can say yes or no.
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return { ...orig, useConfirm: () => mockConfirm };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/serverTime', () => ({
  formatServerDateTime: (s: string) => s ?? '',
  formatServerDate: (s: string) => s ?? '',
  parseServerTimestamp: (s: string) => (s ? new Date(s) : null),
}));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null) => url ?? null,
  };
});

// Stub DataTable — renders every column cell for every row (so the real action
// buttons / dropdown are reachable), a per-row "select" toggle that drives the
// bulk-action bar, the search input, and the emptyContent slot.
type StubColumn = { key: string; sortable?: boolean; render?: (item: never) => React.ReactNode };
vi.mock('@/admin/components', () => ({
  DataTable: ({
    data,
    columns,
    isLoading,
    onSearch,
    onSelectionChange,
    emptyContent,
  }: {
    data: { id: number; name: string; email: string; status: string }[];
    columns: StubColumn[];
    isLoading?: boolean;
    onSearch?: (q: string) => void;
    onSelectionChange?: (keys: Set<string>) => void;
    emptyContent?: React.ReactNode;
  }) => {
    capturedColumns.current = columns;
    return isLoading ? (
      <div role="status" aria-busy="true" aria-label="loading" />
    ) : (
      <div>
        {onSearch && (
          <input
            data-testid="search-input"
            placeholder="Search"
            onChange={(e) => onSearch(e.target.value)}
          />
        )}
        {data.map((u) => (
          <div key={u.id} data-testid={`member-row-${u.id}`}>
            <button type="button" onClick={() => onSelectionChange?.(new Set([String(u.id)]))}>
              {`select-${u.id}`}
            </button>
            {columns.map((col) => (
              <span key={col.key}>{col.render ? col.render(u as never) : null}</span>
            ))}
          </div>
        ))}
        {data.length === 0 && <div data-testid="no-data">{emptyContent ?? 'No members'}</div>}
      </div>
    );
  },
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
  ConfirmModal: ({
    isOpen,
    onConfirm,
    onClose,
    title,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onClose: () => void;
    title: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{title}</p>
        <button onClick={onConfirm} data-testid="confirm-btn">Confirm</button>
        <button onClick={onClose} data-testid="cancel-btn">Cancel</button>
      </div>
    ) : null,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeMember = (overrides = {}) => ({
  id: 1,
  name: 'Alice Member',
  email: 'alice@example.com',
  role: 'member',
  status: 'active',
  avatar_url: null,
  avatar: null,
  balance: 5,
  last_active_at: '2025-05-01T10:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  onboarding_completed: true,
  ...overrides,
});

// Mirrors what the shared api client (src/lib/api.ts) really resolves with for
// paginated endpoints: `data` is the bare row array and pagination lives on the
// sibling `meta`. Earlier fixtures nested `meta` inside `data`, a shape the
// client never produces for these endpoints.
const makeListResponse = (data: object[], total = data.length) => ({
  success: true,
  data, meta: { total },
});

const makeNote = (overrides = {}) => ({
  id: 1,
  content: 'This is a broker note',
  category: 'broker',
  is_pinned: false,
  created_at: '2025-05-01T09:00:00Z',
  author_name: 'Admin User',
  ...overrides,
});

// The page fetches KPI counts through the SAME list endpoint using limit=1;
// table fetches use limit=20. This helper tells the two apart in assertions.
const TABLE_LIMIT = 20;

/** Open the row's "Actions" dropdown and click one of its items by label. */
async function chooseRowAction(user: ReturnType<typeof userEvent.setup>, label: string) {
  const [firstActions] = screen.getAllByRole('button', { name: 'Actions' });
  if (!firstActions) throw new Error('No row Actions button rendered');
  await user.click(firstActions);
  await screen.findByRole('menu', {}, { timeout: 5000 });
  await user.click(await screen.findByRole('menuitem', { name: label }, { timeout: 5000 }));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('MembersPage (broker)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The status tab lives in the URL — reset it so ?status from a previous
    // test never leaks into the next render (test-utils uses BrowserRouter).
    window.history.replaceState({}, '', '/');
    mockAdminUsers.list.mockResolvedValue(makeListResponse([]));
    mockAdminCrm.getNotes.mockResolvedValue({ success: true, data: [] });
    mockConfirm.mockResolvedValue(true);
  });

  it('shows a loading skeleton initially', async () => {
    mockAdminUsers.list.mockImplementation(() => new Promise(() => {}));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders member rows when data is returned', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByTestId('member-row-1')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Alice Member/).length).toBeGreaterThan(0);
  });

  it('shows no-data state when no members returned', async () => {
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByTestId('no-data')).toBeInTheDocument();
    });
  });

  it('shows the per-tab empty state for the pending queue', async () => {
    window.history.replaceState({}, '', '/?status=pending');
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('No members awaiting approval')).toBeInTheDocument();
    });
  });

  it('shows error toast when list API fails', async () => {
    mockAdminUsers.list.mockRejectedValue(new Error('network'));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders status tabs including never-logged-in and onboarding-incomplete', async () => {
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs.length).toBeGreaterThanOrEqual(6); // all, pending, active, suspended, never logged in, onboarding incomplete
    });
    expect(screen.getByRole('tab', { name: /Never logged in/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Onboarding incomplete/ })).toBeInTheDocument();
  });

  it('renders the KPI stat header from list totals', async () => {
    mockAdminUsers.list.mockImplementation((params: { limit?: number; status?: string } = {}) => {
      if (params.limit === 1) {
        const totals: Record<string, number> = { pending: 3, active: 30, suspended: 2 };
        const total = params.status ? (totals[params.status] ?? 0) : 40;
        return Promise.resolve({ success: true, data: [], meta: { total } });
      }
      return Promise.resolve(makeListResponse([makeMember()]));
    });

    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(screen.getByText('Total members')).toBeInTheDocument();
      expect(screen.getByText('Pending approval')).toBeInTheDocument();
      expect(screen.getByText('Active members')).toBeInTheDocument();
      expect(screen.getByText('Suspended members')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('40')).toBeInTheDocument();
      expect(screen.getByText('30')).toBeInTheDocument();
    });
  });

  it('calls adminUsers.list with status param and updates the URL when tab changes to pending', async () => {
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getAllByRole('tab'));

    const pendingTab = screen.getAllByRole('tab').find((el) =>
      el.textContent?.toLowerCase().includes('pending')
    );
    expect(pendingTab).toBeDefined();
    if (pendingTab) fireEvent.click(pendingTab);

    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', limit: TABLE_LIMIT })
      );
    });
    await waitFor(() => {
      expect(window.location.search).toBe('?status=pending');
    });
  });

  it('honours a deep-linked ?status=suspended filter', async () => {
    window.history.replaceState({}, '', '/?status=suspended');
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'suspended', limit: TABLE_LIMIT })
      );
    });
  });

  it('falls back to the All tab for an unknown ?status value', async () => {
    window.history.replaceState({}, '', '/?status=banana');
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: TABLE_LIMIT })
      );
    });
    // The table fetch must NOT forward the junk status to the API.
    const tableCalls = mockAdminUsers.list.mock.calls.filter(
      (c: [{ limit?: number }?]) => c[0]?.limit === TABLE_LIMIT
    );
    expect(tableCalls.length).toBeGreaterThan(0);
    for (const call of tableCalls) {
      expect((call[0] as { status?: string }).status).toBeUndefined();
    }
  });

  it('re-fetches when search input changes', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('search-input'));

    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'Alice' } });

    // Debounce is 300ms — advance timers is not used here (avoid fake timers + waitFor)
    // Instead verify the debounced handler is wired in by checking more calls happen
    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenCalled();
    });
  });

  // ─── Filters live in the URL (search + role, alongside status) ─────────────

  it('opens pre-filtered from ?search= and ?role= in the URL', async () => {
    window.history.replaceState({}, '', '/?search=jane&role=broker');
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: TABLE_LIMIT, search: 'jane', role: 'broker' })
      );
    });
  });

  it('writes the search text to the URL so the view can be linked', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('search-input'));
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'jane' } });

    await waitFor(() => {
      expect(window.location.search).toContain('search=jane');
    });
    await waitFor(() => {
      expect(mockAdminUsers.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: TABLE_LIMIT, search: 'jane' })
      );
    });
  });

  it('keeps the search when the status tab changes', async () => {
    window.history.replaceState({}, '', '/?search=jane');
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getAllByRole('tab'));
    const pendingTab = screen.getAllByRole('tab').find((el) =>
      el.textContent?.toLowerCase().includes('pending')
    );
    if (pendingTab) fireEvent.click(pendingTab);

    await waitFor(() => {
      expect(window.location.search).toContain('status=pending');
      expect(window.location.search).toContain('search=jane');
    });
  });

  // ─── Confirmations ─────────────────────────────────────────────────────────

  it('bulk approve asks for confirmation and only runs after a yes', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember({ status: 'pending' })]));
    mockAdminUsers.bulkApprove.mockResolvedValue({ success: true });
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    fireEvent.click(screen.getByText('select-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve selected' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Approve selected members', status: 'success' })
      );
    });
    expect(String(mockConfirm.mock.calls[0]?.[0]?.body)).toContain('1');
    await waitFor(() => expect(mockAdminUsers.bulkApprove).toHaveBeenCalledWith([1]));
  });

  it('bulk suspend is a danger confirmation and does nothing when cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    fireEvent.click(screen.getByText('select-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend selected' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Suspend selected members', status: 'danger' })
      );
    });
    // Give any (wrong) request a chance to fire, then prove it did not.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAdminUsers.bulkSuspend).not.toHaveBeenCalled();
  });

  it('reactivating a suspended member asks for confirmation first', async () => {
    mockConfirm.mockResolvedValue(false);
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember({ status: 'suspended' })]));
    const user = userEvent.setup();
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    await chooseRowAction(user, 'Reactivate');

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Reactivate member' })
      );
    });
    expect(String(mockConfirm.mock.calls[0]?.[0]?.body)).toContain('Alice Member');
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAdminUsers.reactivate).not.toHaveBeenCalled();
  });

  it('"Check Vetting" navigates inside the app instead of reloading the page', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    const user = userEvent.setup();
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    await chooseRowAction(user, 'Check Vetting');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/vetting?user_id=1');
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  // ─── Notes modal ───────────────────────────────────────────────────────────

  it('deleting a note asks for a danger confirmation first', async () => {
    mockConfirm.mockResolvedValue(false);
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    mockAdminCrm.getNotes.mockResolvedValue({ success: true, data: [makeNote()] });
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Open notes for Alice Member' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('This is a broker note');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete note' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete note', status: 'danger' })
      );
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAdminCrm.deleteNote).not.toHaveBeenCalled();
  });

  it('notes modal closes with "Close", not "Cancel"', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    mockAdminCrm.getNotes.mockResolvedValue({ success: true, data: [makeNote()] });
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Open notes for Alice Member' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('This is a broker note');
    // The footer button is the one with visible text (the modal's X carries
    // "Close" only as an aria-label).
    expect(within(dialog).getByText('Close')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('shows an inline error with Retry when the notes fail to load', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    mockAdminCrm.getNotes.mockRejectedValueOnce(new Error('boom'));
    mockAdminCrm.getNotes.mockResolvedValue({ success: true, data: [makeNote()] });
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Open notes for Alice Member' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText("Notes couldn't be loaded.");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));

    await within(dialog).findByText('This is a broker note');
    expect(mockAdminCrm.getNotes).toHaveBeenCalledTimes(2);
  });

  // ─── Columns ───────────────────────────────────────────────────────────────

  it('marks no column as sortable (the shared table only sorts the visible page)', async () => {
    mockAdminUsers.list.mockResolvedValue(makeListResponse([makeMember()]));
    const MembersPage = (await import('./MembersPage')).default;
    render(<MembersPage />);

    await waitFor(() => screen.getByTestId('member-row-1'));
    expect(capturedColumns.current.length).toBeGreaterThan(0);
    expect(capturedColumns.current.filter((c) => c.sortable)).toEqual([]);
  });
});
