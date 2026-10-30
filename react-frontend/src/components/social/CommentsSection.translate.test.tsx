// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID feedback (30 Oct 2026): comments and replies could not be translated —
 * the Spanish accessibility report named them directly. Every comment and reply
 * now has the shared Translate button, swapping the text in place.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { FeedComment } from '@/components/feed/types';
import { CommentsSection, type CommentsSectionProps } from './CommentsSection';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url?: string | null) => url ?? '',
  formatRelativeTime: () => '5 minutes ago',
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() }),
  })
);

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...(rest as object)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./UserHoverCard', () => ({
  UserHoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useSocialInteractions', () => ({
  AVAILABLE_REACTIONS: ['like'],
  COMMENT_REACTION_EMOJI_MAP: { like: '👍' },
}));

import { api } from '@/lib/api';

const author = { id: 7, name: 'Estefanía', avatar: null };
const reply = { id: 12, content: 'Gracias, muy útil', created_at: '2026-10-30T10:00:00Z', author, replies: [], reactions: {} };
const comment = {
  id: 11,
  content: '¿Alguien sabe cómo cuidar los tomates?',
  created_at: '2026-10-30T09:00:00Z',
  author,
  replies: [reply],
  reactions: {},
} as unknown as FeedComment;

function props(): CommentsSectionProps {
  return {
    comments: [comment],
    commentsCount: 2,
    commentsLoading: false,
    commentsLoaded: true,
    loadComments: vi.fn(async () => {}),
    submitComment: vi.fn(async () => true),
    editComment: vi.fn(async () => true),
    deleteComment: vi.fn(async () => true),
    toggleReaction: vi.fn(async () => {}),
    isAuthenticated: true,
    currentUserId: 1,
    currentUserName: 'Test User',
  };
}

describe('CommentsSection — Translate on comments and replies', () => {
  beforeEach(() => vi.mocked(api.post).mockReset());

  it('offers Translate on every comment and reply', async () => {
    render(<CommentsSection {...props()} />);
    await screen.findByText('¿Alguien sabe cómo cuidar los tomates?');
    expect(screen.getAllByRole('button', { name: /^translate/i })).toHaveLength(2);
  });

  it('translates a comment in place and brings the original back', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      success: true,
      data: { translated_text: 'Does anyone know how to look after tomatoes?', source_locale: 'auto', target_locale: 'en', cached: false },
    });
    render(<CommentsSection {...props()} />);
    await screen.findByText('¿Alguien sabe cómo cuidar los tomates?');

    fireEvent.click(screen.getAllByRole('button', { name: /^translate/i })[0]!);

    await screen.findByText('Does anyone know how to look after tomatoes?');
    expect(screen.queryByText('¿Alguien sabe cómo cuidar los tomates?')).toBeNull();
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'comment',
      content_id: 11,
      source_text: '¿Alguien sabe cómo cuidar los tomates?',
    }));
    // The reply is untouched.
    expect(screen.getByText('Gracias, muy útil')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await waitFor(() => expect(screen.getByText('¿Alguien sabe cómo cuidar los tomates?')).toBeInTheDocument());
  });
});
