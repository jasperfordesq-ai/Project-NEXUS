// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const {
  mockApi,
  mockToast,
  mockResolveReport,
  mockDismissReport,
  mockListTenants,
  mockUseApi,
} = vi.hoisted(() => {
  const mockApi = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };
  const mockResolveReport = vi.fn();
  const mockDismissReport = vi.fn();
  const mockListTenants = vi.fn();

  // Default useApi response: no data, not loading
  const mockUseApi = vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    execute: vi.fn(),
    refetch: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
    loading: false,
    meta: null,
  }));

  return {
    mockApi,
    mockToast,
    mockResolveReport,
    mockDismissReport,
    mockListTenants,
    mockUseApi,
  };
});

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/hooks/useApi', () => ({
  useApi: mockUseApi,
  default: mockUseApi,
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
  default: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminModeration: {
    resolveReport: mockResolveReport,
    dismissReport: mockDismissReport,
    getReports: vi.fn(),
    getReportStats: vi.fn(),
  },
  adminSuper: {
    listTenants: mockListTenants,
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Admin', role: 'admin' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Admin', role: 'admin' },
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

vi.mock('@/admin/AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
  AdminMetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/admin/components/PageHeader', () => ({
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

vi.mock('@/admin/components/ConfirmModal', () => ({
  default: ({
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
      <div role="dialog" aria-label="confirm-modal">
        <span>{title}</span>
        <button onClick={onConfirm} data-testid="confirm-ok">Confirm</button>
        <button onClick={onClose} data-testid="confirm-cancel">Cancel</button>
      </div>
    ) : null,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeReport = (overrides = {}) => ({
  id: 1,
  reporter_id: 10,
  tenant_id: 2,
  tenant_name: 'Test Tenant',
  reporter_name: 'Jane Reporter',
  reporter_avatar: null,
  content_type: 'post' as const,
  target_id: 55,
  target_label: null,
  target_preview: 'This post is spam',
  target_avatar: null,
  target_author_id: 20,
  target_author_name: 'Bob Author',
  target_exists: true,
  reason: 'Spam',
  status: 'pending' as const,
  created_at: '2025-06-01T12:00:00Z',
  updated_at: '2025-06-01T12:00:00Z',
  resolved_at: null,
  resolved_by: null,
  ...overrides,
});

const makeStats = (overrides = {}) => ({
  feed_posts_total: 100,
  feed_posts_hidden: 5,
  feed_posts_flagged: 3,
  comments_total: 50,
  comments_hidden: 2,
  comments_flagged: 1,
  reviews_total: 20,
  reviews_hidden: 0,
  reviews_flagged: 0,
  reports_pending: 4,
  reports_resolved: 12,
  reports_dismissed: 2,
  pending: 4,
  resolved: 12,
  dismissed: 2,
  total: 18,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ReportsManagement', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListTenants.mockResolvedValue({ success: false, data: [] });

    // Default: stats loaded, reports list empty, not loading
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [],
        isLoading: false,
        error: null,
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 0 },
      };
    });
  });

  it('renders the page header', async () => {
    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });
  });

  it('renders stats cards when stats data is available', async () => {
    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => {
      // Total = 18 should appear in a stats card
      expect(screen.getByText('18')).toBeInTheDocument();
      // Pending = 4
      expect(screen.getByText('4')).toBeInTheDocument();
      // Resolved = 12
      expect(screen.getByText('12')).toBeInTheDocument();
      // Dismissed = 2
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  it('shows loading state from useApi', async () => {
    mockUseApi.mockImplementation(() => ({
      data: null,
      isLoading: true,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: true,
      meta: null,
    }));

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    // The Refresh button should be loading (isLoading=true passed to Button)
    const refreshBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refresh'),
    );
    expect(refreshBtn).toBeDefined();
  });

  it('shows empty state when no reports and no filters active', async () => {
    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => {
      // HeroUI Table sets data-empty="true" on the table body when there are no rows
      // The emptyContent text ("No reports to review") is passed as a prop but not
      // rendered as visible text in JSDOM — only the data-empty attribute is set.
      const emptyBody = document.querySelector('[data-empty="true"][data-slot="table-body"]');
      expect(emptyBody).toBeTruthy();
    });
  });

  it('shows error alert when useApi returns an error', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: null,
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: null,
        isLoading: false,
        error: 'Server error',
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: null,
      };
    });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('renders a pending report row with Resolve and Dismiss buttons', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [makeReport()],
        isLoading: false,
        error: null,
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 1 },
      };
    });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => {
      expect(screen.getByText('Jane Reporter')).toBeInTheDocument();
      expect(screen.getByText('Spam')).toBeInTheDocument();
    });

    const resolveBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('resolve'),
    );
    expect(resolveBtn).toBeDefined();

    const dismissBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dismiss'),
    );
    expect(dismissBtn).toBeDefined();
  });

  it('shows a reason code as words, and a written reason exactly as the member wrote it', async () => {
    const byEndpoint = (endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(), isLoading: false, error: null,
          execute: vi.fn(), refetch: vi.fn(), reset: vi.fn(), setData: vi.fn(),
          loading: false, meta: null,
        };
      }
      return {
        data: [
          makeReport({ id: 1, reason: 'safety_concern' }),
          makeReport({ id: 2, reason: 'not_timebank_service' }),
          makeReport({ id: 3, reason: 'He keeps messaging me' }),
        ],
        isLoading: false, error: null,
        execute: vi.fn(), refetch: vi.fn(), reset: vi.fn(), setData: vi.fn(),
        loading: false, meta: { total_pages: 1, total: 3 },
      };
    };
    mockUseApi.mockImplementation(byEndpoint as unknown as Parameters<typeof mockUseApi.mockImplementation>[0]);

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    expect(await screen.findByText('Safety concern')).toBeInTheDocument();
    expect(screen.getByText('Not a timebank service')).toBeInTheDocument();
    expect(screen.getByText('He keeps messaging me')).toBeInTheDocument();
    expect(screen.queryByText('safety_concern')).not.toBeInTheDocument();
    expect(screen.queryByText('not_timebank_service')).not.toBeInTheDocument();
  });

  it('renders the reported target preview and a View details action', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(), isLoading: false, error: null,
          execute: vi.fn(), refetch: vi.fn(), reset: vi.fn(), setData: vi.fn(),
          loading: false, meta: null,
        };
      }
      return {
        data: [makeReport()], isLoading: false, error: null,
        execute: vi.fn(), refetch: vi.fn(), reset: vi.fn(), setData: vi.fn(),
        loading: false, meta: { total_pages: 1, total: 1 },
      };
    });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => {
      // The resolved target preview appears in the new "Reported" column
      expect(screen.getByText('This post is spam')).toBeInTheDocument();
    });

    // A View details affordance opens the detail drawer
    const viewBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('view'),
    );
    expect(viewBtn).toBeDefined();
  });

  it('opens confirm modal when Resolve is clicked', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [makeReport()],
        isLoading: false,
        error: null,
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 1 },
      };
    });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => screen.getByText('Jane Reporter'));

    const resolveBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('resolve'),
    );
    fireEvent.click(resolveBtn!);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();
    });
  });

  it('calls resolveReport and shows success toast on confirm', async () => {
    const mockExecute = vi.fn();
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: mockExecute,
          refetch: mockExecute,
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [makeReport()],
        isLoading: false,
        error: null,
        execute: mockExecute,
        refetch: mockExecute,
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 1 },
      };
    });
    mockResolveReport.mockResolvedValueOnce({ success: true });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => screen.getByText('Jane Reporter'));

    const resolveBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('resolve'),
    );
    fireEvent.click(resolveBtn!);

    await waitFor(() => screen.getByTestId('confirm-ok'));
    fireEvent.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => {
      expect(mockResolveReport).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls dismissReport on Dismiss confirm', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [makeReport()],
        isLoading: false,
        error: null,
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 1 },
      };
    });
    mockDismissReport.mockResolvedValueOnce({ success: true });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => screen.getByText('Jane Reporter'));

    const dismissBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('dismiss'),
    );
    fireEvent.click(dismissBtn!);

    await waitFor(() => screen.getByTestId('confirm-ok'));
    fireEvent.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => {
      expect(mockDismissReport).toHaveBeenCalledWith(1);
    });
  });

  it('shows toast error when resolveReport API fails', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [makeReport()],
        isLoading: false,
        error: null,
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 1 },
      };
    });
    mockResolveReport.mockRejectedValueOnce(new Error('network'));

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => screen.getByText('Jane Reporter'));

    const resolveBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('resolve'),
    );
    fireEvent.click(resolveBtn!);

    await waitFor(() => screen.getByTestId('confirm-ok'));
    fireEvent.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('does not show action buttons for resolved reports', async () => {
    mockUseApi.mockImplementation((endpoint: string) => {
      if (endpoint?.includes('stats')) {
        return {
          data: makeStats(),
          isLoading: false,
          error: null,
          execute: vi.fn(),
          refetch: vi.fn(),
          reset: vi.fn(),
          setData: vi.fn(),
          loading: false,
          meta: null,
        };
      }
      return {
        data: [makeReport({ status: 'resolved' })],
        isLoading: false,
        error: null,
        execute: vi.fn(),
        refetch: vi.fn(),
        reset: vi.fn(),
        setData: vi.fn(),
        loading: false,
        meta: { total_pages: 1, total: 1 },
      };
    });

    const { default: ReportsManagement } = await import('./ReportsManagement');
    render(<ReportsManagement />);

    await waitFor(() => screen.getByText('Jane Reporter'));

    const resolveBtn = screen.queryAllByRole('button').find((b) =>
      b.textContent?.toLowerCase() === 'resolve' ||
      b.textContent?.toLowerCase().trim() === 'resolve',
    );
    // No standalone resolve button for already-resolved reports
    expect(resolveBtn).toBeUndefined();
  });
});
