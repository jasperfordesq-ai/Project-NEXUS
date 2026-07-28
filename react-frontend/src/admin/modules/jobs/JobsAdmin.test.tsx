// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import JobsAdmin from './JobsAdmin';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', last_name: 'User' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useApi: vi.fn(() => ({ data: null, loading: false, error: null })),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: unknown) => url || '/default-avatar.png'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, variants, initial, animate, exit, layout, ...rest }: Record<string, unknown>) => {
      void variants; void initial; void animate; void exit; void layout;
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>;
    },
    span: ({ children, variants, initial, animate, exit, ...rest }: Record<string, unknown>) => {
      void variants; void initial; void animate; void exit;
      return <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>{children as React.ReactNode}</span>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid='empty-state'>{title}</div>
  ),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: vi.fn(() => ({ id: '1' })),
    useNavigate: vi.fn(() => vi.fn()),
    useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

// Comprehensive DataTable mock rendering all column cells
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader', '../../components/DataTable', '../../components/ConfirmModal', '../../components/EmptyState', '../../components/StatCard'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the
// stub data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
    StatCard: ({ label, value, description }: {
      label: string;
      value: React.ReactNode;
      description?: React.ReactNode;
    }) => (
      <div data-testid='stat-card'>
        <span>{label}</span>
        <strong>{value}</strong>
        {description ? <small>{description}</small> : null}
      </div>
    ),
    DataTable: ({ columns, data, isLoading, emptyContent }: {
      columns: { key: string; label: string; render?: (row: Record<string, unknown>) => React.ReactNode }[];
      data: Record<string, unknown>[];
      isLoading?: boolean;
      emptyContent?: React.ReactNode;
    }) => (
      <div data-testid='data-table'>
        {isLoading && <div data-testid='table-loading'>Loading...</div>}
        {!isLoading && data.length === 0 && (
          <div data-testid='table-empty'>{emptyContent}</div>
        )}
        {!isLoading && data.map((row, ri) => (
          <div key={ri} data-testid='table-row'>
            {columns.map((col, ci) => (
              <div key={ci} data-testid={`cell-${col.key}`}>
                {col.render ? col.render(row) : String(row[col.key] ?? '')}
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
    ConfirmModal: ({ isOpen, onConfirm, onClose, children }: {
      isOpen: boolean;
      onConfirm: () => void;
      onClose: () => void;
      children?: React.ReactNode;
    }) => isOpen ? (
      <div data-testid='confirm-modal'>
        {children}
        <button data-testid='confirm-btn' onClick={onConfirm}>Confirm</button>
        <button data-testid='close-btn' onClick={onClose}>Cancel</button>
      </div>
    ) : null,
    EmptyState: ({ title }: { title: string }) => <div data-testid='empty-state'>{title}</div>,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/ConfirmModal', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);

// Admin job fixture
const makeAdminJob = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Community Helper',
  organization_name: 'Test Org',
  poster_name: null,
  type: 'volunteer',
  applications_count: 3,
  views_count: 50,
  is_featured: false,
  status: 'open',
  deadline: null,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('JobsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: [], meta: { page: 1, per_page: 50, total: 0, total_pages: 1 } });
    mockApiPost.mockResolvedValue({ success: true });
    mockApiDelete.mockResolvedValue({ success: true });
  });

  it('renders page header with title', async () => {
    render(<JobsAdmin />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    });
  });

  it('shows status filter tabs', async () => {
    render(<JobsAdmin />);
    await waitFor(() => {
      expect(screen.getByText('All')).toBeTruthy();
      expect(screen.getByText('Open')).toBeTruthy();
      expect(screen.getByText('Closed')).toBeTruthy();
      expect(screen.getByText('Expired')).toBeTruthy();
    });
  });

  it('shows data table', async () => {
    render(<JobsAdmin />);
    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeTruthy();
    });
  });

  it('renders table rows when API returns jobs', async () => {
    const jobs = [
      makeAdminJob({ id: 1, title: 'Community Helper', status: 'open' }),
      makeAdminJob({ id: 2, title: 'Tech Support', status: 'closed' }),
    ];
    mockApiGet.mockResolvedValue({ success: true, data: jobs, meta: { page: 1, per_page: 50, total: 2, total_pages: 1 } });
    render(<JobsAdmin />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row');
      expect(rows).toHaveLength(2);
    });
  });

  it('renders open status in table row', async () => {
    const jobs = [makeAdminJob({ status: 'open' })];
    mockApiGet.mockResolvedValue({ success: true, data: jobs, meta: { page: 1, per_page: 50, total: 1, total_pages: 1 } });
    render(<JobsAdmin />);
    await waitFor(() => {
      const statusCell = screen.getByTestId('cell-status');
      expect(statusCell.textContent?.toLowerCase()).toContain('open');
    });
  });

  it('renders closed status in table row', async () => {
    const jobs = [makeAdminJob({ status: 'closed' })];
    mockApiGet.mockResolvedValue({ success: true, data: jobs, meta: { page: 1, per_page: 50, total: 1, total_pages: 1 } });
    render(<JobsAdmin />);
    await waitFor(() => {
      const statusCell = screen.getByTestId('cell-status');
      expect(statusCell.textContent?.toLowerCase()).toContain('closed');
    });
  });

  it('calls /v2/admin/jobs endpoint on mount', async () => {
    render(<JobsAdmin />);
    await waitFor(() => {
      const calls = mockApiGet.mock.calls as [string][];
      expect(calls.some(([url]) => url.includes('/v2/admin/jobs'))).toBe(true);
    });
  });

  it('renders actions cell in table row', async () => {
    const jobs = [makeAdminJob({ id: 1, is_featured: false })];
    mockApiGet.mockResolvedValue({ success: true, data: jobs, meta: { page: 1, per_page: 50, total: 1, total_pages: 1 } });
    render(<JobsAdmin />);
    await waitFor(() => {
      expect(screen.getByTestId('cell-actions')).toBeTruthy();
    });
  });

  it('shows no table rows when no jobs returned', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [], meta: { page: 1, per_page: 50, total: 0, total_pages: 1 } });
    render(<JobsAdmin />);
    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeTruthy();
    });
    const rows = screen.queryAllByTestId('table-row');
    expect(rows).toHaveLength(0);
  });

  it('renders without crashing', async () => {
    render(<JobsAdmin />);
    await waitFor(() => { expect(document.body).toBeTruthy(); });
  });

});
