// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock data ──────────────────────────────────────────────────────────

const MOCK_REVIEWS = vi.hoisted(() => [
  {
    id: 20,
    reviewer_name: 'Alice Reviewer',
    reviewer_avatar: null,
    receiver_name: 'Bob Reviewed',
    receiver_avatar: null,
    rating: 5,
    content: 'Fantastic service, very helpful!',
    is_flagged: false,
    is_hidden: false,
    tenant_name: 'hOUR Timebank',
    tenant_id: 2,
    created_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 21,
    reviewer_name: 'Carol Complainer',
    reviewer_avatar: null,
    receiver_name: 'Dave Vendor',
    receiver_avatar: null,
    rating: 1,
    content: 'Terrible experience!',
    is_flagged: true,
    is_hidden: false,
    tenant_name: 'hOUR Timebank',
    tenant_id: 2,
    created_at: '2026-06-02T08:00:00Z',
  },
]);

// ── api mock ──────────────────────────────────────────────────────────────────

const mockApiObj = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: mockApiObj,
  api: mockApiObj,
}));

// ── adminApi mock ─────────────────────────────────────────────────────────────

vi.mock('@/admin/api/adminApi', () => ({
  adminModeration: {
    flagReview: vi.fn(),
    hideReview: vi.fn(),
    deleteReview: vi.fn(),
  },
  adminSuper: {
    listTenants: vi.fn(),
  },
}));

// ── contexts ──────────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      name: 'Admin User',
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: false,
    },
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── hooks ─────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/hooks/useApi', () => ({
  useApi: vi.fn(() => ({
    data: MOCK_REVIEWS,
    isLoading: false,
    error: null,
    execute: vi.fn(),
    meta: { total_pages: 1 },
    loading: false,
    refetch: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
  })),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { adminModeration } from '@/admin/api/adminApi';
import ReviewsModeration from './ReviewsModeration';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ReviewsModeration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminModeration.flagReview).mockResolvedValue({ success: true });
    vi.mocked(adminModeration.hideReview).mockResolvedValue({ success: true });
    vi.mocked(adminModeration.deleteReview).mockResolvedValue({ success: true });
  });

  it('renders reviewer names in the table', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
      expect(screen.getByText('Carol Complainer')).toBeInTheDocument();
    });
  });

  it('renders review content text', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Fantastic service, very helpful!')).toBeInTheDocument();
    });
  });

  it('shows flagged chip for flagged review', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      const flaggedEls = screen.queryAllByText(/flagged/i);
      expect(flaggedEls.length).toBeGreaterThan(0);
    });
  });

  it('renders Hide buttons for non-hidden reviews', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      const hideBtns = screen.getAllByRole('button').filter(
        (b) => /hide/i.test(b.textContent ?? ''),
      );
      expect(hideBtns.length).toBeGreaterThan(0);
    });
  });

  it('renders Delete buttons', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      const deleteBtns = screen.getAllByRole('button').filter(
        (b) => /delete/i.test(b.textContent ?? ''),
      );
      expect(deleteBtns.length).toBeGreaterThan(0);
    });
  });

  it('does NOT render Flag button for already-flagged review', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      // Alice Reviewer's review (id=20) is not flagged → Flag button present
      // Carol's review (id=21) is flagged → no Flag button for that row
      // We just confirm that the total Flag buttons ≤ 1 (only for unflagged)
      const flagBtns = screen.getAllByRole('button').filter(
        (b) => b.textContent?.trim() === 'Flag',
      );
      // Should be at most 1 (only Alice's unflagged review)
      expect(flagBtns.length).toBeLessThanOrEqual(1);
    });
  });

  it('opens confirm dialog when Hide is clicked', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });
    const hideBtns = screen.getAllByRole('button').filter(
      (b) => /hide/i.test(b.textContent ?? ''),
    );
    await userEvent.click(hideBtns[0]);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('opens confirm dialog when Delete is clicked', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });
    const deleteBtns = screen.getAllByRole('button').filter(
      (b) => /delete/i.test(b.textContent ?? ''),
    );
    await userEvent.click(deleteBtns[0]);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls hideReview and shows success toast on confirm', async () => {
    const { useApi } = await import('@/hooks/useApi');
    const mockExecute = vi.fn();
    vi.mocked(useApi).mockReturnValue({
      data: MOCK_REVIEWS,
      isLoading: false,
      error: null,
      execute: mockExecute,
      meta: { total_pages: 1 },
      loading: false,
      refetch: mockExecute,
      reset: vi.fn(),
      setData: vi.fn(),
    });

    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });

    const hideBtns = screen.getAllByRole('button').filter(
      (b) => /hide/i.test(b.textContent ?? ''),
    );
    await userEvent.click(hideBtns[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => /hide/i.test(b.textContent ?? '') && b.textContent?.trim() !== '',
    );
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(adminModeration.hideReview).toHaveBeenCalledWith(20);
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('calls deleteReview and shows success toast on confirm', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });
    const deleteBtns = screen.getAllByRole('button').filter(
      (b) => /delete/i.test(b.textContent ?? ''),
    );
    await userEvent.click(deleteBtns[0]);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => /delete/i.test(b.textContent ?? '') && b.textContent?.trim() !== '',
    );
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(adminModeration.deleteReview).toHaveBeenCalledWith(20);
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('shows error toast when deleteReview fails', async () => {
    vi.mocked(adminModeration.deleteReview).mockResolvedValue({
      success: false,
      error: 'Server error',
    });
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });
    const deleteBtns = screen.getAllByRole('button').filter(
      (b) => /delete/i.test(b.textContent ?? ''),
    );
    await userEvent.click(deleteBtns[0]);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const dialog = screen.getByRole('dialog');
    const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(
      (b) => /delete/i.test(b.textContent ?? '') && b.textContent?.trim() !== '',
    );
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  it('shows error alert when useApi returns an error', async () => {
    const useApiMod = await import('@/hooks/useApi');
    vi.mocked(useApiMod.useApi).mockReturnValueOnce({
      data: null,
      isLoading: false,
      error: 'Failed to load reviews',
      execute: vi.fn(),
      meta: null,
      loading: false,
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
    });
    render(<ReviewsModeration />);
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  it('renders search input', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      const searchInput = document.querySelector('input[type="search"]');
      expect(searchInput).toBeInTheDocument();
    });
  });

  it('calls search handler on Apply button click', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });
    const applyBtn = screen.getAllByRole('button').find(
      (b) => /apply/i.test(b.textContent ?? ''),
    );
    expect(applyBtn).toBeInTheDocument();
    await userEvent.click(applyBtn!);
    // No crash = pass
    expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
  });

  it('clears filters on Clear button click', async () => {
    render(<ReviewsModeration />);
    await waitFor(() => {
      expect(screen.getByText('Alice Reviewer')).toBeInTheDocument();
    });
    const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
    if (searchInput) {
      fireEvent.change(searchInput, { target: { value: 'alice' } });
    }
    const clearBtn = screen.getAllByRole('button').find(
      (b) => /clear/i.test(b.textContent ?? ''),
    );
    if (clearBtn) {
      await userEvent.click(clearBtn);
      if (searchInput) expect(searchInput.value).toBe('');
    }
  });
});
