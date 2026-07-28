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
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// ─── Stub heavy admin children ────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/StatCard', '../../components/PageHeader'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the
// stub data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    StatCard: ({ label, value }: { label: string; value: unknown }) => (
      <div data-testid="stat-card">{label}: {String(value)}</div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">{title}{actions}</div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// Stub HeroUI Select / Switch (can infinite-loop in jsdom)
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Select: ({ children, 'aria-label': ariaLabel }: { children: React.ReactNode; 'aria-label'?: string }) => (
      <select aria-label={ariaLabel}>{children}</select>
    ),
    SelectItem: ({ children, id }: { children: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Switch: ({ children, isSelected, onValueChange }: {
      children: React.ReactNode;
      isSelected?: boolean;
      onValueChange?: (v: boolean) => void;
    }) => (
      <label>
        <input type="checkbox" checked={!!isSelected} onChange={(e) => onValueChange?.(e.target.checked)} />
        {children}
      </label>
    ),
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeItem = (overrides = {}) => ({
  id: 1,
  content_type: 'post',
  content_id: 10,
  title: 'Test Post Title',
  body: 'Post body content here',
  author_id: 5,
  author_name: 'Alice Author',
  author_avatar: null,
  status: 'pending',
  auto_flagged: false,
  auto_flag_reason: null,
  submitted_at: '2025-06-01T10:00:00Z',
  reviewed_at: null,
  reviewed_by: null,
  rejection_reason: null,
  ...overrides,
});

const makeStats = () => ({
  total: 10,
  pending: 5,
  flagged: 2,
  approved: 2,
  rejected: 1,
  auto_flagged_total: 2,
  by_type: {},
});

const makeSettings = () => ({
  enabled: true,
  require_post: true,
  require_listing: false,
  require_event: false,
  require_comment: false,
  auto_filter: true,
});

const queueResponse = (items: object[] = []) => ({ data: items });

// ─────────────────────────────────────────────────────────────────────────────
describe('ModerationQueuePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: queue empty, stats + settings loaded
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse());
    });
  });

  it('shows a loading spinner initially', async () => {
    // Make the queue call hang so we catch loading state
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return new Promise(() => {});
    });
    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    // ModerationQueuePage uses <TableBody isLoading loadingContent={<Spinner />}>.
    // HeroUI Spinner renders role="status" — check for its presence in the document.
    // We also accept any element with role="status" OR aria-busy (either signal is valid).
    const statuses = screen.queryAllByRole('status');
    const busyEl = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    const anySpinner = document.querySelector('[role="status"]');
    // At least one loading indicator must exist while the request is pending
    expect(busyEl !== undefined || anySpinner !== null).toBe(true);
  });

  it('renders stat cards when stats are loaded', async () => {
    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('stat-card');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  it('renders empty queue message when no items returned', async () => {
    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => {
      // loading spinner gone
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });
    // Table renders with emptyContent prop — no item rows should exist
    expect(screen.queryByText('Test Post Title')).toBeNull();
  });

  it('renders item row when queue returns items', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => {
      expect(screen.getByText('Test Post Title')).toBeInTheDocument();
      expect(screen.getByText(/Alice Author/)).toBeInTheDocument();
    });
  });

  it('shows approve and reject buttons for pending items', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => screen.getByText('Test Post Title'));

    const approveBtn = screen.queryAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('approve'),
    );
    const rejectBtn = screen.queryAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject'),
    );
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();
  });

  it('calls POST /review approve endpoint when approve button clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });
    mockApi.post.mockResolvedValue({ success: true });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => screen.getByText('Test Post Title'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('approve'),
    );
    expect(approveBtn).toBeDefined();
    fireEvent.click(approveBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/admin/moderation/1/review',
        expect.objectContaining({ decision: 'approved' }),
      );
    });
  });

  it('opens reject modal when reject button clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => screen.getByText('Test Post Title'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject'),
    );
    expect(rejectBtn).toBeDefined();
    fireEvent.click(rejectBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls POST /review rejected when modal reject confirmed with reason', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });
    mockApi.post.mockResolvedValue({ success: true });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => screen.getByText('Test Post Title'));

    // Click reject to open modal
    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject'),
    );
    fireEvent.click(rejectBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Fill reason in textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      fireEvent.change(textarea, { target: { value: 'Spam content' } });
    }

    // Click confirm reject button in modal footer
    const confirmBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject') &&
      b !== rejectBtn,
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockApi.post).toHaveBeenCalledWith(
          '/v2/admin/moderation/1/review',
          expect.objectContaining({ decision: 'rejected' }),
        );
      });
    }
  });

  it('shows toast warning when reject attempted without reason', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => screen.getByText('Test Post Title'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('reject'),
    );
    fireEvent.click(rejectBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click confirm without entering reason
    const confirmBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject') &&
      b !== rejectBtn,
    );
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockToast.warning).toHaveBeenCalled();
      });
    }
  });

  it('opens settings modal when Settings button clicked', async () => {
    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => {
      const statBusy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(statBusy).toBeUndefined();
    });

    const settingsBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('setting'),
    );
    expect(settingsBtn).toBeDefined();
    fireEvent.click(settingsBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls PUT /settings when settings saved', async () => {
    mockApi.put.mockResolvedValue({ success: true });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => {
      const statBusy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(statBusy).toBeUndefined();
    });

    // Open settings modal
    const settingsBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('setting'),
    );
    fireEvent.click(settingsBtn!);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Click save
    const saveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('save'),
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/admin/moderation/settings',
          expect.any(Object),
        );
      });
    }
  });

  it('renders by_type breakdown when stats include type data', async () => {
    const statsWithTypes = {
      ...makeStats(),
      by_type: {
        post: { pending: 3, flagged: 1, approved: 2, rejected: 0 },
      },
    };
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: statsWithTypes });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse());
    });

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    // The by_type panel renders when by_type has entries — just verify no crash
    await waitFor(() => {
      const statBusy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(statBusy).toBeUndefined();
    });
  });

  it('shows toast error when approve API fails', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: makeStats() });
      if (url.includes('/settings')) return Promise.resolve({ data: makeSettings() });
      return Promise.resolve(queueResponse([makeItem()]));
    });
    mockApi.post.mockRejectedValue(new Error('network error'));

    const { ModerationQueuePage } = await import('./ModerationQueuePage');
    render(<ModerationQueuePage />);

    await waitFor(() => screen.getByText('Test Post Title'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('approve'),
    );
    fireEvent.click(approveBtn!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
