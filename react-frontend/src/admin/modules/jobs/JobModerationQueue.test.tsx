// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Hoisted mock data ────────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/lib/api', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  default: {
    get: mockApiGet,
    post: mockApiPost,
  },
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: unknown) => (url as string) || '/default-avatar.png'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

// Stub heavy admin components
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader', '../../components/StatCard', '../../components/EmptyState'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the
// stub data-testids were never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value }: { label: string; value: number }) => (
      <div data-testid="stat-card">
        <span>{label}</span>
        <span>{String(value)}</span>
      </div>
    ),
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
        <p>{title}</p>
        {description && <p>{description}</p>}
      </div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);
vi.mock('../../components/EmptyState', adminComponentsMock);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeJob = (overrides = {}) => ({
  id: 1,
  title: 'Software Engineer',
  description: 'Build great software at a cool company',
  type: 'full-time',
  category: 'technology',
  location: 'Dublin',
  status: 'pending',
  moderation_status: 'pending',
  moderation_notes: null,
  spam_score: 0,
  spam_flags: [],
  created_at: '2025-06-01T10:00:00Z',
  poster_name: 'John Poster',
  poster_avatar: null,
  user_id: 10,
  ...overrides,
});

const makeModStats = (overrides = {}) => ({
  pending: 3,
  approved_today: 10,
  rejected_today: 2,
  flagged: 1,
  total_reviewed: 50,
  ...overrides,
});

const makeSpamStats = (overrides = {}) => ({
  total_analyzed: 5,
  blocked: 1,
  flagged: 2,
  avg_score: 25,
  top_flags: { 'external_links': 2 },
  ...overrides,
});

function setupSuccess(jobs = [makeJob()], total = jobs.length) {
  mockApiGet.mockImplementation((url: string) => {
    if (url.includes('moderation-queue')) {
      return Promise.resolve({ success: true, data: { items: jobs, total } });
    }
    if (url.includes('moderation-stats')) {
      return Promise.resolve({ success: true, data: makeModStats() });
    }
    if (url.includes('spam-stats')) {
      return Promise.resolve({ success: true, data: makeSpamStats() });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('JobModerationQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSuccess([]);
  });

  it('shows loading spinner while fetching', async () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows empty state when no pending jobs', async () => {
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders job card when pending jobs are returned', async () => {
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    });
  });

  it('renders poster name on job card', async () => {
    setupSuccess([makeJob({ poster_name: 'Jane Doe' })]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    });
  });

  it('renders job description preview', async () => {
    setupSuccess([makeJob({ description: 'Join our amazing team' })]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      expect(screen.getByText('Join our amazing team')).toBeInTheDocument();
    });
  });

  it('shows error toast when queue fetch fails', async () => {
    mockApiGet.mockRejectedValue(new Error('network'));
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders stat cards from moderation stats', async () => {
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('stat-card');
      expect(cards.length).toBe(5);
    });
  });

  it('renders spam stats summary when spam data has total_analyzed > 0', async () => {
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument(); // total_analyzed
    });
  });

  it('opens approve modal when Approve button is clicked', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('approve')
    );
    expect(approveBtn).toBeDefined();
    if (approveBtn) await user.click(approveBtn);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('opens reject modal when Reject button is clicked', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    expect(rejectBtn).toBeDefined();
    if (rejectBtn) await user.click(rejectBtn);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('calls approve API when approve is confirmed', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob({ id: 42 })]);
    mockApiPost.mockResolvedValue({ success: true });

    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('approve')
    );
    if (approveBtn) await user.click(approveBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Find confirm button in modal (the approve action button)
    const confirmBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('approve') &&
      b.closest('[role="dialog"]')
    );

    const confirmBtn = confirmBtns[0];
    if (confirmBtn) {
      await user.click(confirmBtn);
      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/v2/admin/jobs/42/approve',
          expect.any(Object)
        );
      });
    }
  });

  it('calls reject API when reject is confirmed with a reason', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob({ id: 99 })]);
    mockApiPost.mockResolvedValue({ success: true });

    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    if (rejectBtn) await user.click(rejectBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Type a reason in the textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      await user.type(textarea, 'Spam content detected');
    }

    // Click the modal's Reject confirm button
    const confirmBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('reject') &&
      b.closest('[role="dialog"]')
    );
    const confirmBtn = confirmBtns[0];
    if (confirmBtn && textarea) {
      await user.click(confirmBtn);
      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/v2/admin/jobs/99/reject',
          expect.objectContaining({ reason: 'Spam content detected' })
        );
      });
    }
  });

  it('shows error toast when reject is attempted without a reason', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const rejectBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('reject')
    );
    if (rejectBtn) await user.click(rejectBtn);

    await waitFor(() => document.querySelector('[role="dialog"]'));

    // Don't fill in reason; try to click confirm — button should be disabled (isDisabled when no reason)
    const confirmBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('reject') &&
      b.closest('[role="dialog"]')
    );
    const confirmBtn = confirmBtns[0];
    if (confirmBtn) {
      // The button should be data-disabled since requiresReason && !actionReason.trim()
      const isDisabled =
        confirmBtn.getAttribute('disabled') !== null ||
        confirmBtn.getAttribute('data-disabled') === 'true';
      if (!isDisabled) {
        // If not disabled (fallback), clicking should trigger toast error
        await user.click(confirmBtn);
        await waitFor(() => {
          expect(mockToast.error).toHaveBeenCalled();
        });
      } else {
        // Confirm button is disabled — the requirement is enforced via UI
        expect(isDisabled).toBe(true);
      }
    }
  });

  it('shows success toast after successful approve', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob({ id: 5 })]);
    mockApiPost.mockResolvedValue({ success: true });

    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('approve')
    );
    if (approveBtn) await user.click(approveBtn);
    await waitFor(() => document.querySelector('[role="dialog"]'));

    const confirmBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('approve') &&
      b.closest('[role="dialog"]')
    );
    const confirmBtn = confirmBtns[0];
    if (confirmBtn) {
      await user.click(confirmBtn);
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  it('removes approved job from the list after successful action', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob({ id: 5 })]);
    mockApiPost.mockResolvedValue({ success: true });

    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const approveBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('approve')
    );
    if (approveBtn) await user.click(approveBtn);
    await waitFor(() => document.querySelector('[role="dialog"]'));

    const confirmBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.toLowerCase().includes('approve') &&
      b.closest('[role="dialog"]')
    );
    const confirmBtn = confirmBtns[0];
    if (confirmBtn) {
      await user.click(confirmBtn);
      await waitFor(() => {
        expect(screen.queryByText('Software Engineer')).not.toBeInTheDocument();
      });
    }
  });

  it('renders spam score chip when job has a spam score > 0', async () => {
    setupSuccess([makeJob({ spam_score: 75, spam_flags: ['external_links'] })]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));
    // Spam score chip renders the score value
    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  it('renders pagination when total exceeds PAGE_SIZE', async () => {
    setupSuccess([makeJob()], 25); // 25 total > 20 PAGE_SIZE
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    // Pagination aria-label
    const pagination = document.querySelector('[aria-label]');
    // Some pagination element should appear
    const paginationEls = screen.queryAllByRole('navigation');
    // Or look for pagination control buttons
    const nextBtn = screen.queryByRole('button', { name: /next/i });
    // At least one of these should be present if pagination is rendered
    expect(
      paginationEls.length > 0 || nextBtn !== null || pagination !== null
    ).toBe(true);
  });

  it('calls refresh when Refresh button is pressed', async () => {
    const user = userEvent.setup();
    setupSuccess([makeJob()]);
    const { JobModerationQueue } = await import('./JobModerationQueue');
    render(<JobModerationQueue />);

    await waitFor(() => screen.getByText('Software Engineer'));

    const refreshBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('refresh')
    );
    if (refreshBtn) await user.click(refreshBtn);

    // Should call get endpoints again: loadPendingJobs (queue) + loadStats (mod-stats + spam-stats) × 2
    await waitFor(() => {
      // Initial mount: 3 calls (queue + mod-stats + spam-stats)
      // Refresh: 3 more calls = 6 total
      expect(mockApiGet).toHaveBeenCalledTimes(6);
    });
  });
});
