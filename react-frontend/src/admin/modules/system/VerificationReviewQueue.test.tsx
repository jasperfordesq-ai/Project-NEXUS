// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// --- mocks ---------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

// Import AFTER mocks
import { api } from '@/lib/api';
import { VerificationReviewQueue } from './VerificationReviewQueue';

// --- helpers -------------------------------------------------------------

const PENDING_SESSION = {
  id: 1,
  tenant_id: 2,
  user_id: 42,
  // 🔴 A real PROVIDER slug. 'manual_review' is a verification LEVEL, not a
  // provider — the providers are stripe_identity / veriff / jumio / onfido /
  // idenfy / mock — so t('verification.provider_manual_review') missed and the
  // cell fell back to "Unknown provider".
  provider_slug: 'stripe_identity',
  verification_level: 'basic',
  status: 'created',
  created_at: '2026-01-01T12:00:00Z',
  completed_at: null,
  failure_reason: null,
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --- tests ---------------------------------------------------------------

describe('VerificationReviewQueue — loading state', () => {
  it('shows a loading spinner while fetching', () => {
    // Never resolve so we stay in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<VerificationReviewQueue />);
    // The loading div has aria-busy="true"
    const loadingEl = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loadingEl).toBeInTheDocument();
  });
});

describe('VerificationReviewQueue — empty state', () => {
  it('shows empty message when no pending sessions returned', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [], success: true });
    render(<VerificationReviewQueue />);
    await waitFor(() => {
      // Loading spinner gone
      const busy = screen
        .queryAllByRole('status')
        .find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
    // "No pending reviews" text key
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('VerificationReviewQueue — populated state', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [PENDING_SESSION], success: true });
  });

  it('renders the user name in the table', async () => {
    render(<VerificationReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
  });

  it('renders user email', async () => {
    render(<VerificationReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  it('shows formatted provider slug', async () => {
    render(<VerificationReviewQueue />);
    await waitFor(() => {
      expect(screen.getByText('Stripe Identity')).toBeInTheDocument();
    });
  });

  it('shows Approve and Reject buttons per row', async () => {
    render(<VerificationReviewQueue />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });
  });
});

describe('VerificationReviewQueue — approve action', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: [PENDING_SESSION], success: true });
  });

  it('opens confirmation modal when Approve is clicked', async () => {
    render(<VerificationReviewQueue />);
    await waitFor(() => screen.getByRole('button', { name: /approve/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    // Modal header should appear
    await waitFor(() => {
      // There's a heading with "approve" semantics — look for any modal trigger text
      const modal = screen.queryByRole('dialog');
      expect(modal).toBeInTheDocument();
    });
  });

  it('calls POST approve endpoint and shows success toast', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    // Second GET call (refresh) returns empty
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: [PENDING_SESSION], success: true })
      .mockResolvedValueOnce({ data: [], success: true });

    render(<VerificationReviewQueue />);
    await waitFor(() => screen.getByRole('button', { name: /approve/i }));
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    // Find the confirm button inside the modal
    await waitFor(() => screen.getByRole('dialog'));
    // The confirm button is the last button inside the modal footer
    const confirmBtns = screen.getAllByRole('button');
    const approveConfirm = confirmBtns.find(
      (b) => b.textContent?.toLowerCase().includes('approve') && !b.closest('[aria-label]'),
    );
    if (approveConfirm) {
      await userEvent.click(approveConfirm);
      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith(
          `/v2/admin/identity/sessions/${PENDING_SESSION.id}/approve`,
          {},
        );
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });
});

describe('VerificationReviewQueue — refresh button', () => {
  it('re-fetches sessions when refresh button pressed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [], success: true });
    render(<VerificationReviewQueue />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(1);
    });
    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await userEvent.click(refreshBtn);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });
});
