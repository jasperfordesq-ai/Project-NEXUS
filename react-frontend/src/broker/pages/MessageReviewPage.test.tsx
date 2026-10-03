// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminBroker } = vi.hoisted(() => ({
  mockAdminBroker: {
    getMessages: vi.fn(),
    getUnreviewedCount: vi.fn(),
    reviewMessage: vi.fn(),
    reviewMessagesBulk: vi.fn(),
    flagMessage: vi.fn(),
    showMessage: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
  default: { adminBroker: mockAdminBroker },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Tenant / Router ─────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.hoisted(() => vi.fn());

// Mutable search params so individual tests can exercise ?status= deep links.
const routerState = vi.hoisted(() => ({
  params: new URLSearchParams(),
  setParams: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [routerState.params, routerState.setParams],
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// The shared CSV export: capture the request instead of downloading a file.
const csvState = vi.hoisted(() => ({ run: vi.fn(), exporting: false }));
vi.mock('@/broker/useCsvExport', () => ({
  useCsvExport: () => ({ run: csvState.run, exporting: csvState.exporting }),
}));

// Auto-refresh: capture the callback so a test can fire a quiet refresh.
const autoRefresh = vi.hoisted(() => ({ callback: null as null | (() => void) }));
vi.mock('@/broker/useBrokerAutoRefresh', () => ({
  useBrokerAutoRefresh: (cb: () => void) => {
    autoRefresh.callback = cb;
  },
}));

// The date range picker is HeroUI's compound component; a stub with two
// inputs is enough to prove the page passes from/to through.
vi.mock('@/broker/components/messages/BrokerDateRangeFilter', () => ({
  BrokerDateRangeFilter: ({
    value,
    onChange,
    label,
    clearLabel,
  }: {
    value: { from: string | null; to: string | null };
    onChange: (v: { from: string | null; to: string | null }) => void;
    label: string;
    clearLabel: string;
  }) => (
    <div>
      <input
        aria-label={label}
        value={value.from && value.to ? `${value.from}..${value.to}` : ''}
        onChange={(e) => {
          const [from, to] = e.target.value.split('..');
          onChange({ from: from || null, to: to || null });
        }}
      />
      {value.from && (
        <button type="button" onClick={() => onChange({ from: null, to: null })}>
          {clearLabel}
        </button>
      )}
    </div>
  ),
}));

// Stub shared admin components
vi.mock('@/admin/components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1 data-testid="page-header">{title}</h1>,
  BulkActionToolbar: ({
    selectedCount,
    actions,
    onClearSelection,
  }: {
    selectedCount: number;
    actions: { key: string; label: string; confirmMessage?: string; onConfirm: () => void }[];
    onClearSelection: () => void;
  }) =>
    selectedCount === 0 ? null : (
      <div data-testid="bulk-toolbar">
        <span>{`${selectedCount} selected`}</span>
        {actions.map((a) => (
          <button key={a.key} type="button" onClick={() => a.onConfirm()} title={a.confirmMessage}>
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onClearSelection}>clear selection</button>
      </div>
    ),
  DataTable: ({
    columns,
    data,
    isLoading,
    emptyContent,
    searchable,
    searchPlaceholder,
    onSearch,
    selectable,
    selectedKeys,
    onSelectionChange,
  }: {
    columns: { key: string; label: string; render?: (item: unknown) => React.ReactNode }[];
    data: unknown[];
    isLoading?: boolean;
    emptyContent?: React.ReactNode;
    searchable?: boolean;
    searchPlaceholder?: string;
    onSearch?: (q: string) => void;
    selectable?: boolean;
    selectedKeys?: Set<string>;
    onSelectionChange?: (keys: Set<string>) => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="data-table">
      {searchable && (
        <input type="search" aria-label={searchPlaceholder} onChange={(e) => onSearch?.(e.target.value)} />
      )}
      {isLoading && <div role="status" aria-busy="true" aria-label="loading">Loading…</div>}
      {!isLoading && data.length === 0 && (
        <div data-testid="empty-table">{emptyContent ?? 'No items'}</div>
      )}
      {!isLoading &&
        data.map((row) => (
          <div key={String((row as Record<string, unknown>).id)} data-testid="table-row">
            {selectable && (
              <input
                type="checkbox"
                aria-label={`Select row ${String((row as Record<string, unknown>).id)}`}
                checked={selectedKeys?.has(String((row as Record<string, unknown>).id)) ?? false}
                onChange={(e) => {
                  const id = String((row as Record<string, unknown>).id);
                  const next = new Set(selectedKeys);
                  if (e.target.checked) next.add(id); else next.delete(id);
                  onSelectionChange?.(next);
                }}
              />
            )}
            {columns.map((col) => (
              <div key={col.key}>
                {col.render ? col.render(row) : null}
              </div>
            ))}
          </div>
        ))}
    </div>
  ),
}));

// ─── serverTime stubs ─────────────────────────────────────────────────────────
vi.mock('@/lib/serverTime', () => ({
  formatServerDate: (v: string) => v,
  formatServerDateTime: (v: string) => v,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeMessage = (overrides = {}) => ({
  id: 1,
  sender_id: 11,
  sender_name: 'Alice',
  receiver_id: 12,
  receiver_name: 'Bob',
  message_body: 'Hello there, this is a test message',
  copy_reason: 'keyword_match',
  flagged: false,
  flag_severity: null,
  flag_reason: null,
  reviewed_at: null,
  sent_at: '2026-01-01T10:00:00Z',
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
});

const makeListRes = (items: unknown[] = [], total = 0) => ({
  success: true,
  data: items,
  meta: { total, total_items: total },
});

const press = (key: string) => fireEvent.keyDown(document.body, { key });

// ─────────────────────────────────────────────────────────────────────────────
describe('MessageReview (broker)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    routerState.params = new URLSearchParams();
    routerState.setParams = vi.fn();
    autoRefresh.callback = null;
    csvState.exporting = false;
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes());
    mockAdminBroker.getUnreviewedCount.mockResolvedValue({ success: true, data: { count: 0 } });
    mockAdminBroker.reviewMessage.mockResolvedValue({ success: true });
    mockAdminBroker.flagMessage.mockResolvedValue({ success: true });
    mockAdminBroker.showMessage.mockResolvedValue({ success: true, data: null });
  });

  it('shows a shaped skeleton while first loading messages', async () => {
    mockAdminBroker.getMessages.mockImplementationOnce(() => new Promise(() => {}));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    // Initial load renders BrokerSkeleton (role=status), not the data table.
    expect(screen.queryByTestId('data-table')).toBeNull();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders the all-caught-up empty state when the unreviewed queue is empty', async () => {
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-table')).toBeInTheDocument();
    });
    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });

  it('renders a filter-specific empty state for the flagged queue', async () => {
    routerState.params = new URLSearchParams('status=flagged');
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(screen.getByText('No flagged messages')).toBeInTheDocument();
    });
  });

  it('renders the KPI header with the global unreviewed count', async () => {
    mockAdminBroker.getUnreviewedCount.mockResolvedValue({ success: true, data: { count: 7 } });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    expect(await screen.findByText('Unreviewed messages')).toBeInTheDocument();
    expect(screen.getByText('Flagged messages')).toBeInTheDocument();
    expect(screen.getByText('Reviewed messages')).toBeInTheDocument();
    expect(screen.getByText('Matching this filter')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    });
  });

  // The Flagged / Reviewed cards used to count the rows on the current page
  // while being labelled like totals. They now read the paginated total of a
  // one-row probe per tab, the same number the Urgent tab badge shows.
  it('counts Flagged, Reviewed and Urgent across the whole queue with one-row probes', async () => {
    mockAdminBroker.getMessages.mockImplementation(async ({ filter }: { filter?: string }) => {
      const totals: Record<string, number> = { flagged: 7, reviewed: 12, urgent: 3 };
      if (filter && filter in totals) return makeListRes([], totals[filter]);
      return makeListRes([makeMessage({ flagged: true, flag_severity: 'concern' })], 1);
    });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.queryByText('Flagged on this page')).not.toBeInTheDocument();
    expect(screen.queryByText('Reviewed on this page')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.getByText('Every flagged message, not just this page')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Urgent/ }).textContent).toContain('3');
    expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, per_page: 1, filter: 'flagged' });
    expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, per_page: 1, filter: 'reviewed' });
    expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, per_page: 1, filter: 'urgent' });
  });

  it('treats a success:false list response as an error, not a silent empty queue', async () => {
    mockAdminBroker.getMessages.mockResolvedValue({ success: false, error: 'nope' });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    expect(await screen.findByText("Couldn't load messages")).toBeInTheDocument();
    expect(screen.queryByText('All caught up')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the header Refresh busy while either the list or the count is still loading', async () => {
    mockAdminBroker.getUnreviewedCount.mockImplementation(() => new Promise(() => {}));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => expect(screen.getByTestId('data-table')).toBeInTheDocument());
    const refresh = screen.getByRole('button', { name: /Refresh/ });
    expect(refresh).toHaveAttribute('data-pending', 'true');
  });

  it('disables the Flag confirm until a reason is typed', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Flag message' }));
    await waitFor(() => document.querySelector('[role="dialog"]'));
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (b) => b.textContent?.trim() === 'Flag',
    ) as HTMLButtonElement;
    expect(confirm).toBeDefined();
    expect(confirm).toBeDisabled();

    fireEvent.change(document.querySelector('[role="dialog"] textarea')!, { target: { value: 'Suspicious' } });
    await waitFor(() => expect(confirm).not.toBeDisabled());
  });

  it('shows the copy reason translated in the quick view and offers Close, not Cancel', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage({ copy_reason: 'first_contact' })], 1));
    mockAdminBroker.showMessage.mockResolvedValue({ success: true, data: { copy: { message_body: 'Hi' }, thread: [] } });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Quick view message' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Hi')).toBeInTheDocument());

    // Translated label (table column + quick view), never the slug.
    expect(screen.getAllByText('First Contact').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('first_contact')).not.toBeInTheDocument();
    const dialogButtons = Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent?.trim());
    expect(dialogButtons).toContain('Close');
    expect(dialogButtons).not.toContain('Cancel');
  });

  it('renders flag severities through the shared status chip', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([
      makeMessage({ id: 1, flagged: true, flag_severity: 'urgent' }),
      makeMessage({ id: 2, sender_name: 'Cara', flagged: true, flag_severity: 'concern' }),
    ], 2));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await waitFor(() => screen.getByText('Alice'));

    // "Urgent" is also a tab label; the chip is the one inside a .chip.
    const urgentChip = screen.getAllByText('Urgent').map((el) => el.closest('.chip')).find(Boolean);
    expect(urgentChip?.className).toContain('chip--primary');
    expect(screen.getByText('Concern').closest('.chip')?.className).toContain('chip--soft');
  });

  it('honours a deep-linked ?status=flagged filter', async () => {
    routerState.params = new URLSearchParams('status=flagged');
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, filter: 'flagged' });
    });
  });

  // Names used to be plain text (the sender's was the link to the message).
  // Both now open the member window; the preview is the link to the message.
  it('opens the member window from both names and the message from the preview', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    expect(await screen.findByRole('button', { name: "Open Alice's record" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Open Bob's record" })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Hello there/ })).toHaveAttribute(
      'href',
      '/test/broker/messages/1?queue=unreviewed',
    );
  });

  it('calls reviewMessage when Mark Reviewed button is clicked', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Mark message as reviewed' }));
    await waitFor(() => {
      expect(mockAdminBroker.reviewMessage).toHaveBeenCalledWith(1);
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('shows error toast when reviewMessage fails', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    mockAdminBroker.reviewMessage.mockRejectedValue(new Error('server error'));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Mark message as reviewed' }));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // The confirm is disabled while the reason is empty (Oct 2026), so an empty
  // submission can no longer reach the API at all.
  it('cannot submit a flag with an empty reason', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Flag message' }));
    await waitFor(() => document.querySelector('[role="dialog"]'));

    const dialogBtns = document.querySelectorAll('[role="dialog"] button');
    const confirmBtn = Array.from(dialogBtns).find((b) => b.textContent?.trim() === 'Flag');
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn!);
    expect(mockAdminBroker.flagMessage).not.toHaveBeenCalled();
  });

  it('calls flagMessage with reason and severity when flag form is submitted', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Flag message' }));
    await waitFor(() => document.querySelector('[role="dialog"]'));

    fireEvent.change(document.querySelector('[role="dialog"] textarea')!, { target: { value: 'Suspicious content' } });
    const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (b) => b.textContent?.trim() === 'Flag',
    )!;
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAdminBroker.flagMessage).toHaveBeenCalledWith(1, 'Suspicious content', 'concern');
    });
    expect(mockToast.success).toHaveBeenCalledWith('Message flagged.');
  });

  it('fetches the message detail when the quick-view button is clicked', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    mockAdminBroker.showMessage.mockResolvedValue({
      success: true,
      data: { copy: { message_body: 'Full message body' }, thread: [] },
    });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Quick view message' }));
    await waitFor(() => {
      expect(mockAdminBroker.showMessage).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByText('Full message body')).toBeInTheDocument();
  });

  it('shows error toast when getMessages fails', async () => {
    mockAdminBroker.getMessages.mockRejectedValue(new Error('network'));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders an honest error state with retry when loading fails', async () => {
    // The KPI probes share the endpoint, so fail the LIST call (unreviewed
    // filter) once rather than whichever call happens to come first.
    let listFailed = false;
    mockAdminBroker.getMessages.mockImplementation(async ({ filter, per_page }: { filter?: string; per_page?: number }) => {
      if (filter === 'unreviewed' && per_page === undefined) {
        if (!listFailed) {
          listFailed = true;
          throw new Error('network');
        }
        return makeListRes([makeMessage()], 1);
      }
      return makeListRes([], 0);
    });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    expect(await screen.findByText("Couldn't load messages")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('opens the Urgent view (flagged, not yet reviewed) from ?status=urgent — the dashboard alerts card', async () => {
    routerState.params = new URLSearchParams('status=urgent');
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, filter: 'urgent' });
    });
    expect(screen.getByRole('tab', { name: /Urgent/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('searches the whole queue on the server', async () => {
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search messages or names' }), {
      target: { value: '  xylophone ' },
    });

    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenLastCalledWith({ page: 1, filter: 'unreviewed', q: 'xylophone' });
    });
    expect(await screen.findByText('No messages match your search')).toBeInTheDocument();
  });

  // Exchange detail links here with ?q=<name>; the search starts filled in.
  it('seeds the search from ?q= in the address bar', async () => {
    routerState.params = new URLSearchParams('q=Priya%20Nolan');
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, filter: 'unreviewed', q: 'Priya Nolan' });
    });
  });

  it('passes the chosen date range to the list as from/to and resets to page 1', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await screen.findByText('Alice');

    fireEvent.change(screen.getByRole('textbox', { name: 'Date range' }), { target: { value: '2026-03-01..2026-03-31' } });

    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenLastCalledWith({
        page: 1,
        filter: 'unreviewed',
        from: '2026-03-01',
        to: '2026-03-31',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenLastCalledWith({ page: 1, filter: 'unreviewed' });
    });
  });

  it('renders filter tabs (unreviewed, urgent, flagged, reviewed, all)', async () => {
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs.length).toBe(5);
    });
  });

  it('hides Mark Reviewed button for already reviewed messages', async () => {
    const reviewedMsg = makeMessage({ reviewed_at: '2026-01-02T10:00:00Z' });
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([reviewedMsg], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    expect(screen.queryByRole('button', { name: 'Mark message as reviewed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quick view message' })).toBeInTheDocument();
  });

  // ── Bulk review ───────────────────────────────────────────────────────────

  // A concern is read, never ticked off: a flagged copy in the selection is
  // dropped before the request goes out, and the broker is told how many.
  it('bulk-reviews only the routine copies and says how many flagged ones were left out', async () => {
    routerState.params = new URLSearchParams('status=unreviewed');
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([
      makeMessage({ id: 1, sender_name: 'Alice' }),
      makeMessage({ id: 2, sender_name: 'Cara', flagged: true, flag_severity: 'concern' }),
      makeMessage({ id: 3, sender_name: 'Dev' }),
    ], 3));
    mockAdminBroker.reviewMessagesBulk.mockResolvedValue({
      success: true,
      data: { reviewed: [1, 3], skipped: [] },
    });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await screen.findAllByText('Alice');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 3' }));
    // The confirm wording counts only the copies that will actually be reviewed.
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toHaveAttribute('title', expect.stringContaining('2 selected messages'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() => expect(mockAdminBroker.reviewMessagesBulk).toHaveBeenCalledWith([1, 3]));
    expect(mockToast.info).toHaveBeenCalledWith('1 flagged message was skipped. Open it to review it.');
    expect(mockToast.success).toHaveBeenCalledWith('2 messages marked reviewed.');
  });

  it('sends nothing when only flagged copies are selected', async () => {
    routerState.params = new URLSearchParams('status=unreviewed');
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([
      makeMessage({ id: 2, sender_name: 'Cara', flagged: true, flag_severity: 'concern' }),
    ], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await screen.findAllByText('Cara');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith('1 flagged message was skipped. Open it to review it.'));
    expect(mockAdminBroker.reviewMessagesBulk).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('bulk-toolbar')).not.toBeInTheDocument());
  });

  it('offers no selection on the history tabs', async () => {
    routerState.params = new URLSearchParams('status=reviewed');
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage({ id: 1, reviewed_at: '2026-01-02' })], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.queryByRole('checkbox', { name: 'Select row 1' })).not.toBeInTheDocument();
  });

  // ── Keyboard triage ───────────────────────────────────────────────────────

  describe('keyboard', () => {
    const rows = () => [
      makeMessage({ id: 1, sender_name: 'Alice' }),
      makeMessage({ id: 2, sender_name: 'Cara', flagged: true, flag_severity: 'concern' }),
      makeMessage({ id: 3, sender_name: 'Dev' }),
    ];

    it('moves the highlight with j and k and opens the highlighted message with Enter', async () => {
      mockAdminBroker.getMessages.mockResolvedValue(makeListRes(rows(), 3));
      const { MessageReview } = await import('./MessageReviewPage');
      render(<MessageReview />);
      await screen.findByText('Dev');

      expect(document.querySelector('[aria-current="true"]')).toBeNull();
      press('j');
      expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('Alice');
      press('j');
      press('j');
      press('j'); // stays on the last row
      expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('Dev');
      press('k');
      expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('Cara');

      press('Enter');
      expect(mockNavigate).toHaveBeenCalledWith('/test/broker/messages/2?queue=unreviewed');
    });

    it('marks a highlighted routine copy reviewed with r, but never a flagged one', async () => {
      mockAdminBroker.getMessages.mockResolvedValue(makeListRes(rows(), 3));
      const { MessageReview } = await import('./MessageReviewPage');
      render(<MessageReview />);
      await screen.findByText('Dev');

      press('r'); // nothing highlighted yet
      expect(mockAdminBroker.reviewMessage).not.toHaveBeenCalled();

      press('j');
      press('j'); // Cara — flagged
      press('r');
      expect(mockAdminBroker.reviewMessage).not.toHaveBeenCalled();
      expect(mockToast.info).toHaveBeenCalledWith('Flagged messages are reviewed one at a time. Open it to read it.');

      press('j'); // Dev — routine
      press('r');
      await waitFor(() => expect(mockAdminBroker.reviewMessage).toHaveBeenCalledWith(3));
    });

    it('opens the flag dialog for the highlighted copy with f', async () => {
      mockAdminBroker.getMessages.mockResolvedValue(makeListRes(rows(), 3));
      const { MessageReview } = await import('./MessageReviewPage');
      render(<MessageReview />);
      await screen.findByText('Dev');

      press('j');
      press('f');
      await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
      expect(screen.getByText('Flag Message')).toBeInTheDocument();
    });

    it('ignores shortcuts typed into the search box', async () => {
      mockAdminBroker.getMessages.mockResolvedValue(makeListRes(rows(), 3));
      const { MessageReview } = await import('./MessageReviewPage');
      render(<MessageReview />);
      await screen.findByText('Dev');

      fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search messages or names' }), { key: 'j' });
      expect(document.querySelector('[aria-current="true"]')).toBeNull();
    });

    it('shows the key legend in the toolbar', async () => {
      const { MessageReview } = await import('./MessageReviewPage');
      render(<MessageReview />);
      await screen.findByTestId('data-table');
      const legend = screen.getByRole('list', { name: 'Keyboard shortcuts' });
      expect(legend.textContent).toContain('Move');
      expect(legend.textContent).toContain('Open');
      expect(legend.textContent).toContain('Review');
      expect(legend.textContent).toContain('Flag');
    });
  });

  // ── Export ────────────────────────────────────────────────────────────────

  it('exports the current filter page by page through the same endpoint', async () => {
    routerState.params = new URLSearchParams('status=flagged');
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage({ flagged: true, flag_severity: 'urgent' })], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await screen.findByText('Alice');

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(csvState.run).toHaveBeenCalledTimes(1);
    const request = csvState.run.mock.calls[0][0] as {
      filename: string;
      columns: { label: string; value: (row: unknown) => unknown }[];
      fetchPage: (page: number) => Promise<{ rows: unknown[]; hasMore: boolean }>;
    };
    expect(request.filename).toBe('broker-messages_flagged');
    expect(request.columns.map((c) => c.label)).toEqual([
      'Message ID', 'Sent', 'Sender', 'Receiver', 'Listing', 'Copy Reason', 'Flagged', 'Severity', 'Flag Reason', 'Status', 'Reviewed by', 'Reviewed at',
    ]);

    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage({ flagged: true, flag_severity: 'urgent' })], 250));
    const first = await request.fetchPage(1);
    expect(mockAdminBroker.getMessages).toHaveBeenLastCalledWith({ page: 1, per_page: 100, filter: 'flagged' });
    expect(first.hasMore).toBe(true);
    const row = first.rows[0];
    const cell = (label: string) => request.columns.find((c) => c.label === label)!.value(row);
    expect(cell('Sender')).toBe('Alice');
    expect(cell('Flagged')).toBe('Yes');
    expect(cell('Severity')).toBe('Urgent');
    expect(cell('Status')).toBe('Unreviewed');

    const third = await request.fetchPage(3);
    expect(third.hasMore).toBe(false);
  });

  // ── Auto-refresh ──────────────────────────────────────────────────────────

  it('refreshes quietly after a broker write: same page, rows stay on screen, no skeleton', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);
    await screen.findByText('Alice');
    const callsBefore = mockAdminBroker.getMessages.mock.calls.length;
    expect(autoRefresh.callback).toBeTypeOf('function');

    mockAdminBroker.getMessages.mockImplementation(() => new Promise(() => {}));
    act(() => autoRefresh.callback!());

    expect(mockAdminBroker.getMessages.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, filter: 'unreviewed' });
    // Quiet: the rows and the table stay; no loading status appears.
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('status', { busy: true })).toBeNull();
  });
});
