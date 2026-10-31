// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Hoisted mock data ───────────────────────────────────────────────────────
const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
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
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

// Stub heavy child components
vi.mock('@/components/reviews/ReviewModal', () => ({
  ReviewModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen
      ? React.createElement('div', { role: 'dialog', 'data-testid': 'review-modal' },
          React.createElement('button', { onClick: onClose }, 'Close Modal'))
      : null,
}));

vi.mock('@/components/social', () => ({
  SocialInteractionPanel: () => null,
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeReview = (overrides = {}) => ({
  id: 10,
  rating: 4,
  comment: 'Great member!',
  is_anonymous: false,
  reviewer: { id: 2, name: 'Jane Doe', avatar_url: null },
  created_at: '2025-03-01T00:00:00Z',
  is_liked: false,
  likes_count: 0,
  comments_count: 0,
  ...overrides,
});

const emptyResponse = { success: true, data: [], meta: { has_more: false, cursor: null } };

// Owner, 31 Oct 2026: what a member wrote must be translatable for readers of
// any language — a review's text, not only the comments under it.
describe('ReviewsPage — Translate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/reviews/user/1')) {
        return Promise.resolve({ success: true, data: [makeReview({ comment: '¡Gran vecina!' })], meta: { has_more: false, cursor: null } });
      }
      return Promise.resolve(emptyResponse);
    });
    mockApi.post.mockImplementation((url: string) => Promise.resolve(
      url === '/v2/ugc-translate'
        ? { success: true, data: { translated_text: 'Great neighbour!', source_locale: 'es', target_locale: 'en', cached: false } }
        : { success: true },
    ));
  });

  it('translates a received review and restores the original', async () => {
    const { default: ReviewsPage } = await import('./ReviewsPage');
    render(<ReviewsPage />);
    await screen.findByText('¡Gran vecina!');

    fireEvent.click(screen.getByRole('button', { name: /^translate$/i }));

    await screen.findByText('Great neighbour!');
    expect(mockApi.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'review',
      content_id: 10,
      source_text: '¡Gran vecina!',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await waitFor(() => expect(screen.getByText('¡Gran vecina!')).toBeInTheDocument());
    expect(screen.queryByText('Great neighbour!')).not.toBeInTheDocument();
  });
});
