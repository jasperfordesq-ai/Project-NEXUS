// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── stable mock refs (vi.hoisted so they're available in vi.mock factories) ───
const { mockAdminBroker } = vi.hoisted(() => ({
  mockAdminBroker: {
    showArchive: vi.fn(),
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));
const mockBreadcrumb = vi.hoisted(() => vi.fn());
vi.mock('@/broker/BrokerBreadcrumbContext', () => ({ useBrokerBreadcrumbLabel: mockBreadcrumb }));

vi.mock('@/lib/serverTime', () => ({
  formatServerDateTime: (dt: string) => dt,
}));

// react-router-dom: mock useParams to inject :id
let mockId = '1';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: mockId }),
  };
});

import { ArchiveDetail } from './ArchiveDetailPage';

const mockArchive = {
  id: 1,
  decision: 'approved',
  decided_by_name: 'Admin User',
  decided_at: '2025-01-10T12:00:00Z',
  decision_notes: 'Looks fine',
  flag_reason: null,
  flag_severity: null,
  sender_id: 11,
  receiver_id: 12,
  decided_by: 5,
  sender_name: 'Alice',
  receiver_name: 'Bob',
  target_message_body: 'Hello there!',
  copy_reason: 'keyword_match',
  target_message_sent_at: '2025-01-09T10:00:00Z',
  listing_title: 'My Listing',
  conversation_snapshot: [
    {
      id: 10,
      sender_name: 'Alice',
      body: 'First message',
      created_at: '2025-01-09T09:00:00Z',
      is_deleted: false,
      is_edited: false,
    },
    {
      id: 11,
      sender_name: 'Bob',
      body: 'Reply here',
      created_at: '2025-01-09T09:05:00Z',
      is_deleted: false,
      is_edited: true,
    },
  ],
};

describe('ArchiveDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockId = '1';
  });

  // D: every member name opens the member window; the breadcrumb names the record.
  it('opens the member window from the sender, receiver and reviewer, and names the record in the breadcrumb', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: mockArchive });
    render(<ArchiveDetail />);
    expect(await screen.findByRole('button', { name: "Open Bob's record" })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: "Open Alice's record" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: "Open Admin User's record" })).toBeInTheDocument();
    expect(mockBreadcrumb).toHaveBeenCalledWith('Alice → Bob');
  });

  it('shows a shaped skeleton while fetching', () => {
    mockAdminBroker.showArchive.mockReturnValue(new Promise(() => {}));
    render(<ArchiveDetail />);

    const statusEls = screen.queryAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders archive detail when loaded successfully', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: mockArchive });

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
    expect(screen.getByText('Hello there!')).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('Looks fine')).toBeInTheDocument();
  });

  it('renders the archival banner with the read-only badge and frozen note', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: mockArchive });

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getByText('Read-only')).toBeInTheDocument();
    });
    expect(screen.getByText('Record #1')).toBeInTheDocument();
    expect(
      screen.getByText('This record is preserved exactly as it was reviewed and cannot be modified.')
    ).toBeInTheDocument();
  });

  it('renders conversation snapshot messages', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: mockArchive });

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getByText('First message')).toBeInTheDocument();
    });

    expect(screen.getByText('Reply here')).toBeInTheDocument();
  });

  it('renders "edited" label for edited messages', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: mockArchive });

    render(<ArchiveDetail />);

    await waitFor(() => {
      // t('archives.edited') = "edited"
      expect(screen.getByText(/edited/i)).toBeInTheDocument();
    });
  });

  it('renders deleted message placeholder for deleted messages', async () => {
    const archiveWithDeleted = {
      ...mockArchive,
      conversation_snapshot: [
        {
          id: 20,
          sender_name: 'Charlie',
          body: '',
          created_at: '2025-01-08T08:00:00Z',
          is_deleted: true,
          is_edited: false,
        },
      ],
    };
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: archiveWithDeleted });

    render(<ArchiveDetail />);

    await waitFor(() => {
      // t('archives.deleted') = "deleted"
      expect(screen.getByText(/deleted/i)).toBeInTheDocument();
    });
  });

  it('shows empty snapshot message when no conversation messages', async () => {
    const archiveEmpty = { ...mockArchive, conversation_snapshot: [] };
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: archiveEmpty });

    render(<ArchiveDetail />);

    await waitFor(() => {
      // t('archives.no_snapshot') = "No conversation snapshot available."
      expect(screen.getByText(/No conversation snapshot/i)).toBeInTheDocument();
    });
  });

  it('shows error state when API returns success=false', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: false, data: null });

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getByText('Record unavailable')).toBeInTheDocument();
    });
    // Shell back action remains available for recovery
    expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByText('Archive record not found.')).toBeInTheDocument();
  });

  it('shows error state when API call throws', async () => {
    mockAdminBroker.showArchive.mockRejectedValue(new Error('Network error'));

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to load archive record.')).toBeInTheDocument();
  });

  it('retries loading from the error state', async () => {
    mockAdminBroker.showArchive
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ success: true, data: mockArchive });
    const user = userEvent.setup();

    render(<ArchiveDetail />);

    expect(await screen.findByText('Record unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Hello there!')).toBeInTheDocument();
    });
    expect(mockAdminBroker.showArchive).toHaveBeenCalledTimes(2);
  });

  it('shows invalid_id error for non-numeric id', async () => {
    mockId = 'abc';

    render(<ArchiveDetail />);

    await waitFor(() => {
      // invalid id error renders the shell back link
      expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Invalid archive ID.')).toBeInTheDocument();
    // No retry offered for an unloadable id
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    // showArchive must NOT be called for invalid id
    expect(mockAdminBroker.showArchive).not.toHaveBeenCalled();
  });

  it('shows flag_reason section for rejected decisions', async () => {
    const rejectedArchive = {
      ...mockArchive,
      decision: 'rejected',
      flag_reason: 'Inappropriate content',
      flag_severity: 'high',
    };
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: rejectedArchive });

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getByText('Inappropriate content')).toBeInTheDocument();
    });
    // Panel-wide severity chip
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  // Message-scale severities (info/warning/concern/urgent) had no entry in the
  // shared chip, so a flagged record's severity read "Unknown".
  it('names a message-scale severity instead of Unknown', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({
      success: true,
      data: { ...mockArchive, decision: 'flagged', flag_reason: 'Shared a phone number', flag_severity: 'concern' },
    });

    render(<ArchiveDetail />);

    await waitFor(() => expect(screen.getByText('Shared a phone number')).toBeInTheDocument());
    expect(screen.getByText('Concern')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('names an unexpected decision through the shared status chip, never a capitalised slug', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({
      success: true,
      data: { ...mockArchive, decision: 'weird_new_state' },
    });

    render(<ArchiveDetail />);

    await waitFor(() => expect(screen.getByText('Hello there!')).toBeInTheDocument());
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText('Weird New State')).not.toBeInTheDocument();
  });

  it('shows listing_title when present', async () => {
    mockAdminBroker.showArchive.mockResolvedValue({ success: true, data: mockArchive });

    render(<ArchiveDetail />);

    await waitFor(() => {
      expect(screen.getByText('My Listing')).toBeInTheDocument();
    });
  });
});
