// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockAdminBroker } = vi.hoisted(() => ({
  mockAdminBroker: {
    showMessage: vi.fn(),
    reviewMessage: vi.fn(),
    flagMessage: vi.fn(),
    approveMessage: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/lib/serverTime', () => ({
  formatServerDateTime: (s: string) => s ?? '',
  formatServerDate: (s: string) => s ?? '',
  parseServerTimestamp: (s: string) => (s ? new Date(s) : null),
}));

const mockNavigate = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '7' }),
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeThread = (overrides: object[] = []) => [
  {
    id: 100,
    sender_name: 'Alice Sender',
    body: 'Hello there',
    created_at: '2025-01-01T09:00:00Z',
    is_deleted: false,
    is_edited: false,
    subject: null,
  },
  ...overrides,
];

const makeCopy = (overrides = {}) => ({
  id: 7,
  original_message_id: 100,
  sender_name: 'Alice Sender',
  receiver_name: 'Bob Receiver',
  listing_title: 'Vintage Lamp',
  copy_reason: 'first_contact',
  sent_at: '2025-01-01T09:00:00Z',
  reviewed_at: null,
  flagged: false,
  flag_reason: null,
  flag_severity: null,
  ...overrides,
});

const makeDetail = (overrides = {}) => ({
  copy: makeCopy(),
  thread: makeThread(),
  archive: null,
  ...overrides,
});

const makeSuccess = (data: object) => ({ success: true, data });
const makeError = () => ({ success: false, error: 'Not found' });

// ─────────────────────────────────────────────────────────────────────────────
describe('MessageDetail (broker)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminBroker.showMessage.mockResolvedValue(makeSuccess(makeDetail()));
  });

  it('shows a shaped skeleton loading state initially', async () => {
    mockAdminBroker.showMessage.mockImplementation(() => new Promise(() => {}));
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows an honest error state with a retry button when the API fails', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(makeError());
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(screen.getByText('Message not found.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('reloads the detail when Retry is pressed after a failure', async () => {
    mockAdminBroker.showMessage
      .mockResolvedValueOnce(makeError())
      .mockResolvedValueOnce(makeSuccess(makeDetail()));

    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(screen.getByText('Message not found.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Bob Receiver')).toBeInTheDocument();
    });
    expect(mockAdminBroker.showMessage).toHaveBeenCalledTimes(2);
  });

  it('renders metadata card with sender and receiver', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      // "Alice Sender" appears in both metadata card and thread; ensure at least one instance
      const senderEls = screen.getAllByText('Alice Sender');
      expect(senderEls.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Bob Receiver')).toBeInTheDocument();
    });
  });

  it('renders conversation thread messages', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(screen.getByText('Hello there')).toBeInTheDocument();
    });
  });

  it('marks the copied message in the thread with a Copied badge', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });

  it('renders a color-coded severity banner when the copy is flagged', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(
      makeSuccess(
        makeDetail({
          copy: makeCopy({
            flagged: true,
            flag_reason: 'Suspicious contact details',
            flag_severity: 'urgent',
          }),
        })
      )
    );

    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(screen.getByText('Flagged for review')).toBeInTheDocument();
      expect(screen.getByText('Suspicious contact details')).toBeInTheDocument();
      expect(screen.getByText('Urgent')).toBeInTheDocument();
    });
    // Already-flagged copies must not offer the Flag action again
    expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull();
  });

  it('shows Mark Reviewed button when message is unreviewed', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('review') || b.textContent?.toLowerCase().includes('reviewed')
      );
      expect(btn).toBeDefined();
    });
  });

  it('calls reviewMessage and shows success toast', async () => {
    mockAdminBroker.reviewMessage.mockResolvedValue({ success: true });
    // Reload after review
    mockAdminBroker.showMessage
      .mockResolvedValueOnce(makeSuccess(makeDetail()))
      .mockResolvedValueOnce(makeSuccess(makeDetail({ copy: makeCopy({ reviewed_at: '2025-01-01T10:00:00Z' }) })));

    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => screen.getAllByRole('button'));

    const reviewBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('review') || b.textContent?.toLowerCase().includes('mark')
    );
    if (reviewBtn) fireEvent.click(reviewBtn);

    await waitFor(() => {
      expect(mockAdminBroker.reviewMessage).toHaveBeenCalledWith(7);
    });
  });

  it('opens flag modal when Flag button is pressed', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => screen.getAllByRole('button'));

    const flagBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('flag')
    );
    if (flagBtn) fireEvent.click(flagBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('shows flag_reason_required toast when flag submitted without reason', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => screen.getAllByRole('button'));

    const flagBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('flag')
    );
    if (flagBtn) fireEvent.click(flagBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click flag confirm inside modal without entering a reason
    const confirmFlagBtn = screen
      .getAllByRole('button')
      .filter((b) => b.closest('[role="dialog"]'))
      .find((b) => b.textContent?.toLowerCase().includes('flag'));
    if (confirmFlagBtn) fireEvent.click(confirmFlagBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('opens approve-and-archive modal', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => screen.getAllByRole('button'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('archive') || b.textContent?.toLowerCase().includes('approve')
    );
    if (approveBtn) fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    });
  });

  it('shows archived state when archive record is present', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(
      makeSuccess(makeDetail({
        archive: {
          decision: 'approved',
          decided_by_name: 'Admin User',
          decided_at: '2025-01-02T10:00:00Z',
          decision_notes: 'Looks fine',
        },
      }))
    );

    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Looks fine')).toBeInTheDocument();
  });

  it('hides decision actions and shows the read-only notice when archived', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(
      makeSuccess(makeDetail({
        archive: {
          decision: 'flagged',
          decided_by_name: 'Admin User',
          decided_at: '2025-01-02T10:00:00Z',
          decision_notes: null,
        },
      }))
    );

    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => {
      expect(
        screen.getByText('This record is archived. No further actions are available.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Approve & Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull();
  });

  it('calls approveMessage and navigates away on success', async () => {
    mockAdminBroker.approveMessage.mockResolvedValue({ success: true });

    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => screen.getAllByRole('button'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('archive') || b.textContent?.toLowerCase().includes('approve')
    );
    if (approveBtn) fireEvent.click(approveBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    const confirmBtn = screen
      .getAllByRole('button')
      .filter((b) => b.closest('[role="dialog"]'))
      .find((b) => b.textContent?.toLowerCase().includes('confirm') || b.textContent?.toLowerCase().includes('approve'));
    if (confirmBtn) fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockAdminBroker.approveMessage).toHaveBeenCalledWith(7, undefined);
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  // Back used to go to the unfiltered list whatever tab the message was opened
  // from; the queue is already known from ?queue=, so Back honours it.
  it('returns to the queue tab the message was opened from', async () => {
    window.history.pushState({}, '', '/test/broker/messages/7?queue=urgent');
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);
    await waitFor(() => expect(screen.getByText('Bob Receiver')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(mockNavigate).toHaveBeenCalledWith('/test/broker/messages?status=urgent');
    window.history.pushState({}, '', '/');
  });

  it('returns to the plain messages list when no queue is known', async () => {
    window.history.pushState({}, '', '/test/broker/messages/7');
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);
    await waitFor(() => expect(screen.getByText('Bob Receiver')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(mockNavigate).toHaveBeenCalledWith('/test/broker/messages');
  });

  it('links to the guide on reviewing a message', async () => {
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);
    await waitFor(() => expect(screen.getByText('Bob Receiver')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'How this page works' })).toHaveAttribute(
      'href',
      expect.stringContaining('/broker/help/broker_safeguarding/broker_review_message'),
    );
  });

  // The archive record used to print "Flagged" for any decision other than
  // approved. It now names the decision that was actually recorded.
  it('shows the recorded archive decision rather than assuming Flagged', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(
      makeSuccess(makeDetail({
        archive: { decision: 'rejected', decided_by_name: 'Admin User', decided_at: '2025-01-02T10:00:00Z', decision_notes: null },
      }))
    );
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);
    await waitFor(() => expect(screen.getByText('Admin User')).toBeInTheDocument());
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByText('Flagged')).not.toBeInTheDocument();
  });

  it('renders the severity through the shared status chip, filled only for urgent', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(
      makeSuccess(makeDetail({ copy: makeCopy({ flagged: true, flag_reason: 'Odd', flag_severity: 'info' }) }))
    );
    const { MessageDetail } = await import('./MessageDetailPage');
    const { unmount } = render(<MessageDetail />);
    await waitFor(() => expect(screen.getByText('Flagged for review')).toBeInTheDocument());
    const info = screen.getByText('Info').closest('.chip');
    expect(info?.className).toContain('chip--accent');
    expect(info?.className).toContain('chip--soft');
    unmount();

    mockAdminBroker.showMessage.mockResolvedValue(
      makeSuccess(makeDetail({ copy: makeCopy({ flagged: true, flag_reason: 'Odd', flag_severity: 'urgent' }) }))
    );
    render(<MessageDetail />);
    await waitFor(() => expect(screen.getByText('Flagged for review')).toBeInTheDocument());
    expect(screen.getByText('Urgent').closest('.chip')?.className).toContain('chip--primary');
  });

  // The server sends MySQL tinyints (0/1), not booleans. `{msg.is_edited && …}`
  // with is_edited = 0 printed a stray "0" beside every message.
  it('prints nothing for a not-edited message when the server sends is_edited as 0', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(makeSuccess(makeDetail({
      thread: [{ id: 100, sender_name: 'Alice Sender', body: 'Hello there', created_at: '2025-01-01T09:00:00Z', is_deleted: 0, is_edited: 0, subject: null }],
    })));
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => expect(screen.getByText('Hello there')).toBeInTheDocument());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows a voice message as one, with its length and transcript, instead of an empty bubble', async () => {
    mockAdminBroker.showMessage.mockResolvedValue(makeSuccess(makeDetail({
      thread: makeThread([
        { id: 101, sender_name: 'Alice Sender', body: '', created_at: '2025-01-01T09:05:00Z', is_deleted: 0, is_edited: 0, is_voice: 1, audio_duration: 12, transcript: 'Can you come on Saturday?' },
        { id: 102, sender_name: 'Alice Sender', body: '', created_at: '2025-01-01T09:06:00Z', is_deleted: 0, is_edited: 0, is_voice: 1, audio_duration: null, transcript: null },
      ]),
    })));
    const { MessageDetail } = await import('./MessageDetailPage');
    render(<MessageDetail />);

    await waitFor(() => expect(screen.getByText('Voice message (12 s)')).toBeInTheDocument());
    expect(screen.getByText('Transcript: Can you come on Saturday?')).toBeInTheDocument();
    expect(screen.getByText('Voice message')).toBeInTheDocument();
    expect(screen.getByText(/No transcript is available/)).toBeInTheDocument();
  });
});
