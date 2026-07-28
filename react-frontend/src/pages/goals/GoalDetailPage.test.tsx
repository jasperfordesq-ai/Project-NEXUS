// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── vi.hoisted — must precede vi.mock factories that use these refs ────────────
const { mockApi, mockNavigate } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
  mockNavigate: vi.fn(),
}));

// ── useParams mock (preserve shape) ──────────────────────────────────────────
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '42' }),
    useNavigate: () => mockNavigate,
  };
});

// ── Stable mock refs ──────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/helpers')>('@/lib/helpers');
  return { ...actual, resolveAvatarUrl: (url: unknown) => url ?? '' };
});

// ── Hooks ─────────────────────────────────────────────────────────────────────
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── SEO / social stubs ────────────────────────────────────────────────────────
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
// Bound to the barrel AND to the component's own path: GoalDetailPage imports
// '@/components/social/SocialInteractionPanel' directly, and vitest keys mocks
// per resolved module, so the barrel-only form never installed — the real panel
// rendered and data-testid="social-panel" was never in the DOM. Declared as a
// function, not a const: vi.mock is hoisted above the module body.
function socialMock() {
  return { SocialInteractionPanel: () => <div data-testid="social-panel" /> };
}

vi.mock('@/components/social', socialMock);
vi.mock('@/components/social/SocialInteractionPanel', socialMock);

// ── Goal child components ─────────────────────────────────────────────────────
vi.mock('./components/GoalProgressHistory', () => ({
  GoalProgressHistory: () => <div data-testid="progress-history" />,
}));
vi.mock('./components/GoalInsightsPanel', () => ({
  GoalInsightsPanel: () => <div data-testid="insights-panel" />,
}));

// ── Feedback ──────────────────────────────────────────────────────────────────
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div role="status">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
}));

import React from 'react';
import { GoalDetailPage } from './GoalDetailPage';

const GOAL = {
  id: 42,
  user_id: 1,
  title: 'Run a marathon',
  description: 'Train and complete a marathon in under 4 hours.',
  target_value: 100,
  current_value: 45,
  deadline: '2026-12-31T00:00:00Z',
  is_public: true,
  status: 'active' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  user_name: 'Jane Runner',
  user_avatar: null,
  progress_percentage: 45,
  is_owner: true,
  buddy_id: null,
  buddy_name: null,
  buddy_avatar: null,
  is_buddy: false,
  likes_count: 3,
  comments_count: 1,
  is_liked: false,
  checkin_frequency: 'weekly',
};

describe('GoalDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading skeleton on mount while fetching', () => {
    // Keep the promise pending
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<GoalDetailPage />);
    const statusEls = screen.getAllByRole('status');
    const busy = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeTruthy();
  });

  it('renders the goal title when data loads', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Run a marathon')).toBeInTheDocument();
    });
  });

  it('renders the goal description', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/Train and complete a marathon/i)).toBeInTheDocument();
    });
  });

  it('renders the progress values (current/target)', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      // Multiple elements may show "45" (progress bar label + percentage text)
      expect(screen.getAllByText(/45/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/100/).length).toBeGreaterThan(0);
    });
  });

  it('renders the owner name', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Runner')).toBeInTheDocument();
    });
  });

  it('renders the insights panel', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('insights-panel')).toBeInTheDocument();
    });
  });

  it('renders the social interaction panel', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('social-panel')).toBeInTheDocument();
    });
  });

  it('renders progress history for a public goal owned by the user', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('progress-history')).toBeInTheDocument();
    });
  });

  it('shows not-found empty state when API returns RESOURCE_NOT_FOUND', async () => {
    mockApi.get.mockResolvedValue({
      success: false,
      code: 'RESOURCE_NOT_FOUND',
      data: null,
    });
    render(<GoalDetailPage />);
    await waitFor(() => {
      // EmptyState renders as role=status; loading skeleton also uses role=status.
      // After loading completes, the busy one is gone and EmptyState remains.
      const statusEls = screen.getAllByRole('status');
      const notBusy = statusEls.find((el) => el.getAttribute('aria-busy') !== 'true');
      expect(notBusy).toBeTruthy();
    });
  });

  it('shows forbidden empty state when API returns RESOURCE_FORBIDDEN', async () => {
    mockApi.get.mockResolvedValue({
      success: false,
      code: 'RESOURCE_FORBIDDEN',
      data: null,
    });
    render(<GoalDetailPage />);
    await waitFor(() => {
      const statusEls = screen.getAllByRole('status');
      const notBusy = statusEls.find((el) => el.getAttribute('aria-busy') !== 'true');
      expect(notBusy).toBeTruthy();
    });
  });

  it('shows error alert with try-again button when API throws', async () => {
    mockApi.get.mockRejectedValue(new Error('Network failure'));
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('try-again button re-fetches the goal', async () => {
    mockApi.get.mockRejectedValue(new Error('Network failure'));
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockApi.get).toHaveBeenCalledTimes(1);

    // Now make the next call succeed
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    const tryAgainBtn = screen.getByRole('button', { name: /try|again|retry/i });
    await userEvent.click(tryAgainBtn);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledTimes(2);
    });
  });

  it('calls api.get with the correct goal id from useParams', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/goals/42');
    });
  });

  it('renders completed chip text for a completed goal', async () => {
    const completedGoal = { ...GOAL, status: 'completed' as const, progress_percentage: 100 };
    mockApi.get.mockResolvedValue({ success: true, data: completedGoal });
    render(<GoalDetailPage />);
    await waitFor(() => {
      // i18n key goals.status.completed will render as "completed" or the key
      expect(screen.getAllByText(/complet/i).length).toBeGreaterThan(0);
    });
  });

  it('renders the Back to Goals navigation button', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    render(<GoalDetailPage />);
    await waitFor(() => {
      const backBtn = screen.getByRole('button', { name: /back|goals/i });
      expect(backBtn).toBeInTheDocument();
    });
  });
});
