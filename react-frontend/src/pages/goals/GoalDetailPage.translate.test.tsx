// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

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
    useAuth: () => ({
      user: { id: 1 } as never,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
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
vi.mock('./components/GoalBuddyRequests', () => ({
  GoalBuddyRequests: () => <div data-testid="buddy-requests" />,
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

// Owner, 31 Oct 2026: the goal itself, not only its comments, must be
// translatable. One Translate press translates the description and the title.
describe('GoalDetailPage — Translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: GOAL });
    mockApi.post.mockImplementation((_url: string, body: { content_type: string }) => Promise.resolve({
      success: true,
      data: {
        translated_text: body.content_type === 'goal_title' ? 'Correr un maratón' : 'Entrenar y completar un maratón en menos de 4 horas.',
        source_locale: 'en',
        target_locale: 'es',
        cached: false,
      },
    }));
  });

  it('translates the description and title together, then restores the original', async () => {
    render(<GoalDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Run a marathon' });

    fireEvent.click(screen.getByRole('button', { name: /^translate$/i }));

    await screen.findByText('Entrenar y completar un maratón en menos de 4 horas.');
    expect(screen.getByRole('heading', { level: 1, name: 'Correr un maratón' })).toBeInTheDocument();
    expect(mockApi.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'goal',
      content_id: 42,
      source_text: 'Train and complete a marathon in under 4 hours.',
    }));
    expect(mockApi.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'goal_title',
      content_id: 42,
      source_text: 'Run a marathon',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Run a marathon' })).toBeInTheDocument());
    expect(screen.getByText('Train and complete a marathon in under 4 hours.')).toBeInTheDocument();
  });
});
