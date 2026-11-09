// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin', is_super_admin: true },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    usePusherOptional: () => null,
  })
);

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub heavy sub-components ────────────────────────────────────────────────
vi.mock('@/admin/components', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('../../components', () => ({
  MemberSearchPicker: () => <div data-testid="member-search-picker" />,
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
  StatCard: ({ label, value }: { label: string; value: unknown }) => (
    <div data-testid="stat-card">
      <span>{label}</span>
      <span>{String(value)}</span>
    </div>
  ),
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
    TableHeader: ({ children }: { children: React.ReactNode }) => <thead><tr>{children}</tr></thead>,
    TableColumn: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
    TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
    TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
    TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
    Select: ({ children, label }: { children: React.ReactNode; label?: string }) => (
      <div>
        {label && <label>{label}</label>}
        <select>{children}</select>
      </div>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen?: boolean }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

vi.mock('@/lib/chartColors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chartColors')>()),
  CHART_TOKEN_COLORS: { primary: '#000', border: '#ccc' },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeWorkflowSummary = () => ({
  stats: {
    pending_count: 5,
    pending_hours: 12.5,
    overdue_count: 2,
    escalated_count: 1,
    approved_30d_hours: 100,
    declined_30d_count: 3,
    coordinator_count: 4,
  },
  pending_reviews: [
    {
      id: 1,
      member_name: 'Jane Doe',
      organisation_name: 'Helping Hands',
      opportunity_title: 'Garden Helper',
      hours: 3,
      date_logged: '2025-01-01',
      created_at: '2025-01-01T10:00:00Z',
      age_days: 5,
      is_overdue: false,
      is_escalated: false,
      assigned_to: null,
      assigned_name: null,
      assigned_at: null,
      escalated_at: null,
      escalation_note: null,
    },
  ],
  recent_decisions: [],
  coordinator_signals: { active_requests: 10, active_offers: 8, trusted_organisations: 3 },
  coordinators: [],
});

const makeSupportRelationshipList = () => ({
  stats: { active_count: 2, paused_count: 0, check_ins_due: 1, expected_active_hours: 5 },
  items: [],
});

const makeForecastResponse = () => ({
  hours: { history: [], forecast: [], trend: 'stable', growth_rate_pct: 0, confidence: 'low' },
  members: { history: [], forecast: [], trend: 'stable', growth_rate_pct: 0, confidence: 'low' },
  recipients: { history: [], forecast: [], trend: 'stable', growth_rate_pct: 0, confidence: 'low' },
  alerts: [],
  generated_at: '2025-01-01T00:00:00Z',
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CaringCommunityWorkflowPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default happy-path responses
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/workflow') && !url.includes('reviews') && !url.includes('policy')) {
        return Promise.resolve({ success: true, data: makeWorkflowSummary() });
      }
      if (url.includes('/support-relationships')) {
        return Promise.resolve({ success: true, data: makeSupportRelationshipList() });
      }
      if (url.includes('/forecast')) {
        return Promise.resolve({ success: true, data: makeForecastResponse() });
      }
      if (url.includes('/safeguarding')) {
        return Promise.resolve({
          success: true,
          data: {
            total: 0,
            open_total: 0,
            open_by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
            by_status: {},
            overdue: 0,
            recent: [],
          },
        });
      }
      if (url.includes('/paper-onboarding')) {
        return Promise.resolve({ success: true, data: { count: 0, items: [] } });
      }
      if (url.includes('/tandem-suggestions')) {
        return Promise.resolve({ success: true, data: { suggestions: [], generated_at: '' } });
      }
      if (url.includes('/favours')) {
        return Promise.resolve({ success: true, data: { count: 0, items: [] } });
      }
      if (url.includes('/invite-codes')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: null });
    });
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    const statuses = screen.queryAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders without crashing after data loads', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      // Page should no longer be in loading state — a heading or content renders
      expect(screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
  });

  it('calls the workflow API endpoint on mount', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      const calls = (mockApi.get as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
      expect(calls.some((url: unknown) => typeof url === 'string' && url.includes('/v2/admin/caring-community/workflow'))).toBe(true);
    });
  });

  it('calls the support relationships API endpoint on mount', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      const calls = (mockApi.get as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
      expect(calls.some((url: unknown) => typeof url === 'string' && url.includes('/support-relationships'))).toBe(true);
    });
  });

  it('calls the forecast API endpoint on mount', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      const calls = (mockApi.get as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
      expect(calls.some((url: unknown) => typeof url === 'string' && url.includes('/forecast'))).toBe(true);
    });
  });

  it('shows an error toast when workflow API fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders page content once workflow data is loaded', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      // The page header title / some text content should appear after loading
      const headings = screen.queryAllByRole('heading');
      expect(headings.length).toBeGreaterThan(0);
    });
  });

  it('renders pending review member name from loaded data', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    });
  });

  it('renders workflow summary data successfully (no crash after load)', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      // After loading, loading spinner should be gone
      const busySpinners = screen.queryAllByRole('status').filter(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busySpinners).toHaveLength(0);
    });
  });

  it('renders organisation name from pending review', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      expect(screen.getByText(/Helping Hands/)).toBeInTheDocument();
    });
  });

  it('renders opportunity or organisation name from pending review section', async () => {
    const { default: CaringCommunityWorkflowPage } = await import('./CaringCommunityWorkflowPage');
    render(<CaringCommunityWorkflowPage />);

    await waitFor(() => {
      // The review section renders organisation_name or opportunity_title
      // "Helping Hands" should appear (already covered above), just verify list is non-empty
      const reviewTexts = screen.queryAllByText(/Helping Hands|Garden Helper/);
      expect(reviewTexts.length).toBeGreaterThan(0);
    });
  });
});
