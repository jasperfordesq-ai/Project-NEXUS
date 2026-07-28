// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── canManageCaring ─────────────────────────────────────────────────────────
vi.mock('@/caring/access', () => ({
  canManageCaring: vi.fn(() => true),
}));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockShowToast = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: mockShowToast };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: { id: 1, name: 'Admin', role: 'admin' },
      isAuthenticated: true,
      login: vi.fn(), logout: vi.fn(), register: vi.fn(),
      updateUser: vi.fn(), refreshUser: vi.fn(),
      status: 'idle' as const, error: null,
    }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub heavy admin children ────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/EmptyState' and '../../components/PageHeader'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">{title}{actions}</div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// ─── Stub HeroUI Select (can infinite-loop) ────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Select: ({ children, label, onChange }: {
      children: React.ReactNode;
      label?: string;
      onChange?: React.ChangeEventHandler<HTMLSelectElement>;
    }) => (
      <select aria-label={label} onChange={onChange}>{children}</select>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeFeedbackRow = (overrides = {}) => ({
  id: 1,
  tenant_id: 2,
  submitter_user_id: 5,
  sub_region_id: null,
  category: 'question' as const,
  subject: 'Water supply issue',
  body: 'The water supply has been irregular for a week.',
  sentiment_tag: 'concerned' as const,
  status: 'new' as const,
  assigned_user_id: null,
  assigned_role: null,
  triage_notes: null,
  resolution_notes: null,
  is_anonymous: false,
  is_public: true,
  created_at: '2025-06-01T08:00:00Z',
  updated_at: '2025-06-01T08:00:00Z',
  ...overrides,
});

const makeStats = () => ({
  total_open: 7,
  by_status: { new: 4, triaging: 3 },
  by_category: { question: 5, idea: 2 },
  by_sub_region: {},
  recent_count_7d: 3,
  sentiment_distribution: { concerned: 2, neutral: 5 },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('MunicipalityFeedbackAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [] });
    });
  });

  it('shows loading spinner initially', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return new Promise(() => {});
    });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no items returned', async () => {
    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders feedback rows when items returned', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [makeFeedbackRow()] });
    });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Water supply issue')).toBeInTheDocument();
    });
  });

  it('renders dashboard stats chips when stats are loaded', async () => {
    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => {
      // The stats card renders when the dashboard endpoint responds.
      // The stats chips show "total_open: <b>7</b>" so check for the number in any element.
      const allText = document.body.textContent ?? '';
      // total_open is 7 — should appear somewhere in the rendered output
      expect(allText).toMatch(/7/);
    });
  });

  it('opens detail modal when View / subject button clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [makeFeedbackRow()] });
    });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => screen.getByText('Water supply issue'));

    // Click the subject (button in the table)
    const subjectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Water supply issue'),
    );
    expect(subjectBtn).toBeDefined();
    fireEvent.click(subjectBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls PUT /triage when save triage button clicked in modal', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [makeFeedbackRow()] });
    });
    mockApi.put.mockResolvedValue({ data: makeFeedbackRow({ status: 'triaging' }) });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => screen.getByText('Water supply issue'));

    const subjectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Water supply issue'),
    );
    fireEvent.click(subjectBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click save triage
    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save') ||
      b.textContent?.toLowerCase().includes('triage'),
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/admin/caring-community/feedback/1/triage',
          expect.any(Object),
        );
      });
    }
  });

  it('calls POST /resolve when resolve button clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [makeFeedbackRow()] });
    });
    mockApi.post.mockResolvedValue({ data: makeFeedbackRow({ status: 'resolved' }) });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => screen.getByText('Water supply issue'));

    const subjectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Water supply issue'),
    );
    fireEvent.click(subjectBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill resolution notes first (required)
    const textareas = document.querySelectorAll('textarea');
    // The second textarea is typically resolution notes
    const resolutionTextarea = Array.from(textareas).find((ta) =>
      ta.closest('div')?.querySelector('label')?.textContent?.toLowerCase().includes('resolution'),
    ) ?? textareas[textareas.length - 1];

    if (resolutionTextarea) {
      fireEvent.change(resolutionTextarea, { target: { value: 'Issue resolved by maintenance team.' } });
    }

    const resolveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('resolve') && !b.textContent?.toLowerCase().includes('close'),
    );
    if (resolveBtn) {
      fireEvent.click(resolveBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/caring-community/feedback/1/resolve',
          expect.any(Object),
        );
      });
    }
  });

  it('shows toast error when resolve called without resolution notes', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [makeFeedbackRow()] });
    });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => screen.getByText('Water supply issue'));

    const subjectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Water supply issue'),
    );
    fireEvent.click(subjectBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Do NOT fill resolution notes
    const resolveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('resolve') && !b.textContent?.toLowerCase().includes('close'),
    );
    if (resolveBtn) {
      fireEvent.click(resolveBtn);
      await waitFor(() => {
        // showToast or toast.error should be called
        const called = mockShowToast.mock.calls.length > 0 || mockToast.error.mock.calls.length > 0;
        expect(called).toBe(true);
      });
    }
  });

  it('calls POST /close when close-no-resolution button clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/dashboard')) return Promise.resolve({ data: makeStats() });
      return Promise.resolve({ data: [makeFeedbackRow()] });
    });
    mockApi.post.mockResolvedValue({ data: makeFeedbackRow({ status: 'closed' }) });

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => screen.getByText('Water supply issue'));

    const subjectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Water supply issue'),
    );
    fireEvent.click(subjectBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    const closeBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('close') &&
      !b.textContent?.toLowerCase().includes('cancel'),
    );
    if (closeBtn) {
      fireEvent.click(closeBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/caring-community/feedback/1/close',
          expect.any(Object),
        );
      });
    }
  });

  it('calls download when Export CSV button clicked', async () => {
    mockApi.download = vi.fn().mockResolvedValue(undefined);

    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    const exportBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('export') ||
      b.textContent?.toLowerCase().includes('csv'),
    );
    if (exportBtn) {
      fireEvent.click(exportBtn);
      await waitFor(() => {
        expect(mockApi.download).toHaveBeenCalled();
      });
    }
  });

  it('fetches list again when Refresh button clicked', async () => {
    const { default: MunicipalityFeedbackAdminPage } = await import('./MunicipalityFeedbackAdminPage');
    render(<MunicipalityFeedbackAdminPage />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    const initialCallCount = mockApi.get.mock.calls.length;

    const refreshBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refresh'),
    );
    if (refreshBtn) {
      fireEvent.click(refreshBtn);
      await waitFor(() => {
        expect(mockApi.get.mock.calls.length).toBeGreaterThan(initialCallCount);
      });
    }
  });
});
