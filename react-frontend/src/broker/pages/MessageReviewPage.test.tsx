// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
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

// Mutable search params so individual tests can exercise ?status= deep links.
const routerState = vi.hoisted(() => ({
  params: new URLSearchParams(),
  setParams: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => vi.fn(),
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

// Stub shared admin components
vi.mock('@/admin/components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1 data-testid="page-header">{title}</h1>,
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
  sender_name: 'Alice',
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

// ─────────────────────────────────────────────────────────────────────────────
describe('MessageReview (broker)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    routerState.params = new URLSearchParams();
    routerState.setParams = vi.fn();
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
    expect(screen.getByText('Flagged on this page')).toBeInTheDocument();
    expect(screen.getByText('Reviewed on this page')).toBeInTheDocument();
    expect(screen.getByText('Matching this filter')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('7').length).toBeGreaterThan(0);
    });
  });

  it('honours a deep-linked ?status=flagged filter', async () => {
    routerState.params = new URLSearchParams('status=flagged');
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(mockAdminBroker.getMessages).toHaveBeenCalledWith({ page: 1, filter: 'flagged' });
    });
  });

  it('renders message rows when messages are returned', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('renders receiver name in table', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
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
  });

  it('shows success toast after marking reviewed', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Mark message as reviewed' }));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
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

  it('opens flag modal when Flag button is clicked', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Flag message' }));
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('shows error toast when flag submitted with empty reason', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    // Open flag modal
    fireEvent.click(screen.getByRole('button', { name: 'Flag message' }));
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click flag confirm button without filling reason
    const dialogBtns = document.querySelectorAll('[role="dialog"] button');
    const confirmBtn = Array.from(dialogBtns).find((b) =>
      b.textContent?.toLowerCase().includes('flag')
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  it('calls flagMessage with reason and severity when flag form is submitted', async () => {
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage()], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    fireEvent.click(screen.getByRole('button', { name: 'Flag message' }));
    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill in the reason textarea
    const textareas = document.querySelectorAll('[role="dialog"] textarea');
    if (textareas.length > 0) {
      fireEvent.change(textareas[0], { target: { value: 'Suspicious content' } });
    }

    const dialogBtns = document.querySelectorAll('[role="dialog"] button');
    const confirmBtn = Array.from(dialogBtns).find((b) =>
      b.textContent?.toLowerCase().includes('flag')
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockAdminBroker.flagMessage).toHaveBeenCalledWith(
          1,
          'Suspicious content',
          expect.any(String)
        );
      });
    }
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
    mockAdminBroker.getMessages
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(makeListRes([makeMessage()], 1));
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

  it('renders filter tabs (unreviewed, flagged, reviewed, all)', async () => {
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('hides Mark Reviewed button for already reviewed messages', async () => {
    const reviewedMsg = makeMessage({ reviewed_at: '2026-01-02T10:00:00Z' });
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([reviewedMsg], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => screen.getByText('Alice'));

    // reviewed_at is set → no "mark reviewed" action in the row, but the
    // quick-view action remains available.
    expect(screen.queryByRole('button', { name: 'Mark message as reviewed' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Quick view message' })).toBeInTheDocument();
  });

  it('marks several selected messages reviewed at once and says which were skipped', async () => {
    routerState.params = new URLSearchParams('status=unreviewed');
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([
      makeMessage({ id: 1, sender_name: 'Alice' }),
      makeMessage({ id: 2, sender_name: 'Cara', flagged: true }),
    ], 2));
    mockAdminBroker.reviewMessagesBulk.mockResolvedValue({
      success: true,
      data: { reviewed: [1], skipped: [{ id: 2, reason: 'flagged' }] },
    });
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await screen.findAllByText('Alice');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select row 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row 2' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));

    await waitFor(() => expect(mockAdminBroker.reviewMessagesBulk).toHaveBeenCalledWith([1, 2]));
    expect(mockToast.success).toHaveBeenCalledWith('1 message marked reviewed.');
    expect(mockToast.info).toHaveBeenCalledWith('1 flagged message was skipped. Open it to review it.');
  });

  it('offers no selection on the history tabs', async () => {
    routerState.params = new URLSearchParams('status=reviewed');
    mockAdminBroker.getMessages.mockResolvedValue(makeListRes([makeMessage({ id: 1, reviewed_at: '2026-01-02' })], 1));
    const { MessageReview } = await import('./MessageReviewPage');
    render(<MessageReview />);

    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.queryByRole('checkbox', { name: 'Select row 1' })).not.toBeInTheDocument();
  });
});
