// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const { mockToast, mockNavigate } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

// api is not directly imported by NewsletterList — adminNewsletters wraps it.
vi.mock('@/lib/api', () => {
  const m = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { default: m, api: m };
});

// Mock adminApi so we can control adminNewsletters directly
const { mockNLList, mockNLDelete, mockNLSend, mockNLDuplicate, mockPolicyEmails } = vi.hoisted(() => ({
  mockNLList: vi.fn(),
  mockNLDelete: vi.fn(),
  mockNLSend: vi.fn(),
  mockNLDuplicate: vi.fn(),
  mockPolicyEmails: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminLegalDocs: { publicationEmails: mockPolicyEmails },
  adminNewsletters: {
    list: mockNLList,
    delete: mockNLDelete,
    sendNewsletter: mockNLSend,
    duplicateNewsletter: mockNLDuplicate,
  },
}));

// Mock NewsletterResend so we don't need its dependencies
vi.mock('./NewsletterResend', () => ({
  NewsletterResend: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="newsletter-resend-modal">Resend</div> : null,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { NewsletterList } from './NewsletterList';

// ── Test data ─────────────────────────────────────────────────────────────────
const DRAFT_NL = {
  id: 1,
  name: 'Draft Newsletter',
  subject: 'Hello World',
  status: 'draft',
  recipients_count: 0,
  total_recipients: 100,
  open_rate: 0,
  click_rate: 0,
  sent_at: null,
  created_at: '2026-01-01T00:00:00Z',
  is_recurring: false,
  ab_test_enabled: false,
};

const SENT_NL = {
  id: 2,
  name: 'Sent Newsletter',
  subject: 'Monthly Update',
  status: 'sent',
  recipients_count: 200,
  total_recipients: 200,
  open_rate: 45.5,
  click_rate: 12.3,
  sent_at: '2026-01-15T10:00:00Z',
  created_at: '2026-01-10T00:00:00Z',
  is_recurring: false,
  ab_test_enabled: false,
};

// Mirrors what the shared api client (src/lib/api.ts) really resolves with: it
// unwraps the `data` envelope, so `data` is the bare row array and pagination
// lives on the sibling `meta`. Earlier fixtures nested `meta` inside `data`, a
// shape the client never produces, which hid that the page ignored `meta`.
function listResponse(items: unknown[], meta: { total?: number; total_pages?: number } = {}) {
  return {
    success: true,
    data: items,
    meta: { current_page: 1, per_page: 20, total: items.length, total_pages: items.length ? 1 : 0, ...meta },
  };
}

function resolveList(items: unknown[], meta: { total?: number; total_pages?: number } = {}) {
  mockNLList.mockResolvedValue(listResponse(items, meta));
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('NewsletterList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicyEmails.mockResolvedValue({ success: true, data: [] });
  });

  it('shows policy submissions and provider delivery alongside newsletter campaigns', async () => {
    resolveList([]);
    mockPolicyEmails.mockResolvedValue({ success: true, data: [{
      document_id: 5, title: 'Privacy policy', version_id: 9, version_number: '2.0',
      published_at: '2026-09-30T20:00:00Z', recipients: 10, queued: 2,
      submitted: 7, delivered: 6, bounced: 1, exceptions: 1, unique_opens: 4, unique_clicks: 2,
    }] });
    render(<NewsletterList />);
    expect(await screen.findByText('Privacy policy · version 2.0')).toBeInTheDocument();
    expect(screen.getByText(/Submitted 7 · Delivered 6 · Bounced 1/)).toBeInTheDocument();
    expect(screen.getByText('Opened 4 · Clicked 2')).toBeInTheDocument();
  });

  it('shows a loading spinner while fetching', () => {
    // Never resolves — keeps component in loading state
    mockNLList.mockReturnValue(new Promise(() => {}));
    render(<NewsletterList />);
    // DataTable renders a loading overlay / spinner internally; the refresh button
    // should also appear as loading (isLoading prop)
    const spinners = getAllByRoleStatus(document.body);
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('renders newsletter rows after load', async () => {
    resolveList([DRAFT_NL, SENT_NL]);
    render(<NewsletterList />);
    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
      expect(screen.getByText('Monthly Update')).toBeInTheDocument();
    });
  });

  it('shows empty-state message when list is empty', async () => {
    resolveList([]);
    render(<NewsletterList />);
    await waitFor(() => {
      expect(screen.getByText(/no newsletters found/i)).toBeInTheDocument();
    });
  });

  it('navigates to create page when Create Newsletter button is pressed', async () => {
    resolveList([]);
    render(<NewsletterList />);
    await waitFor(() => screen.getByText(/create newsletter/i));

    await userEvent.click(screen.getByText(/create newsletter/i));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/admin/newsletters/create'));
  });

  it('opens delete confirm modal and calls delete on confirm', async () => {
    const user = userEvent.setup();
    resolveList([DRAFT_NL]);
    mockNLDelete.mockResolvedValue({ success: true });
    mockNLList
      .mockResolvedValueOnce(listResponse([DRAFT_NL]))
      .mockResolvedValue(listResponse([]));

    render(<NewsletterList />);
    await waitFor(() => screen.getByText('Hello World'));

    // Open the dropdown for the first row
    const actionBtn = screen.getAllByRole('button', { name: /actions/i })[0];
    await user.click(actionBtn);

    // The Dropdown portal exposes text items
    await waitFor(() =>
      expect(screen.getByText(/^delete$/i)).toBeInTheDocument()
    );
    await user.click(screen.getByText(/^delete$/i));

    // Confirm modal should appear
    await waitFor(() =>
      expect(screen.getByText(/delete newsletter/i)).toBeInTheDocument()
    );

    // Confirm deletion — button with text "Delete" inside the modal
    const confirmBtns = screen.getAllByRole('button', { name: /^delete$/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockNLDelete).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when delete fails', async () => {
    const user = userEvent.setup();
    resolveList([DRAFT_NL]);
    mockNLDelete.mockResolvedValue({ success: false });

    render(<NewsletterList />);
    await waitFor(() => screen.getByText('Hello World'));

    const actionBtn = screen.getAllByRole('button', { name: /actions/i })[0];
    await user.click(actionBtn);

    await waitFor(() => expect(screen.getByText(/^delete$/i)).toBeInTheDocument());
    await user.click(screen.getByText(/^delete$/i));

    await waitFor(() => screen.getByText(/delete newsletter/i));

    const confirmBtns = screen.getAllByRole('button', { name: /^delete$/i });
    await user.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows send confirm modal and calls sendNewsletter on confirm', async () => {
    const user = userEvent.setup();
    resolveList([DRAFT_NL]);
    mockNLSend.mockResolvedValue({ success: true, data: { message: 'Queued' } });
    // After send, list re-fetches
    mockNLList
      .mockResolvedValueOnce(listResponse([DRAFT_NL]))
      .mockResolvedValue(listResponse([]));

    render(<NewsletterList />);
    await waitFor(() => screen.getByText('Hello World'));

    const actionBtn = screen.getAllByRole('button', { name: /actions/i })[0];
    await user.click(actionBtn);

    // "Send Now" option appears in dropdown
    await waitFor(() => expect(screen.getByText(/send now/i)).toBeInTheDocument());
    await user.click(screen.getByText(/send now/i));

    // Send confirm modal
    await waitFor(() =>
      expect(screen.getByText(/send newsletter now/i)).toBeInTheDocument()
    );

    // Confirm via the modal confirm button
    const sendBtns = screen.getAllByRole('button', { name: /send now/i });
    await user.click(sendBtns[sendBtns.length - 1]);

    await waitFor(() => {
      expect(mockNLSend).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows open_rate percentage when available', async () => {
    resolveList([SENT_NL]);
    render(<NewsletterList />);
    await waitFor(() => {
      expect(screen.getByText(/45\.5%/)).toBeInTheDocument();
    });
  });

  it('gracefully handles API error on initial load', async () => {
    mockNLList.mockRejectedValue(new Error('Network error'));
    render(<NewsletterList />);
    // Should not crash — empty list with no items rendered
    await waitFor(() => {
      // DataTable will show empty state or just no rows; no uncaught error
      expect(screen.queryByText(/hello world/i)).not.toBeInTheDocument();
    });
  });

  // Regression: with more than 20 newsletters the page counted only the 20 rows
  // it was given, showed no page control, and every older newsletter was
  // unreachable from the list.
  it('offers a page control when the API reports more than one page', async () => {
    resolveList([DRAFT_NL, SENT_NL], { total: 45, total_pages: 3 });
    render(<NewsletterList />);

    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: '4' })).not.toBeInTheDocument();
  });

  it('requests page 2 when the next page is chosen', async () => {
    resolveList([DRAFT_NL, SENT_NL], { total: 45, total_pages: 3 });
    render(<NewsletterList />);

    const nav = await screen.findByRole('navigation');
    fireEvent.click(within(nav).getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(mockNLList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });
  });
});

// Helper: find elements that are spinner/status with aria-busy=true
function getAllByRoleStatus(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[role="status"]')).filter(
    (el) => el.getAttribute('aria-busy') === 'true'
  );
}
