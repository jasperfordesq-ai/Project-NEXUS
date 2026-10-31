// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID feedback (30 Oct 2026): group discussions and their replies could not be
 * translated. The opening post and each reply now carry the shared Translate
 * button; the rich text is sent as words and the translation shown as plain
 * text until "Show original".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import type { Discussion, DiscussionDetail } from './GroupDiscussionTab';

// The shared Translate button calls the API itself; this file only watches that
// call, so it mocks the client without importing it (pages/groups keeps direct
// client imports to an allowlist — directClientBoundary.test.ts).
const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: mockPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/components/social/SocialInteractionPanel', () => ({
  SocialInteractionPanel: () => <div data-testid="social-panel" />,
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, layout: _layout, ...rest }: React.HTMLAttributes<HTMLDivElement> & { layout?: boolean }) => (
      <div {...rest}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { GroupDiscussionTab } from './GroupDiscussionTab';

const discussion: Discussion = {
  id: 3,
  title: 'Huerto comunitario',
  content: '<p>¿Quién quiere <strong>plantar</strong> el sábado?</p>',
  author: { id: 10, name: 'Ana', avatar_url: null },
  reply_count: 1,
  created_at: '2026-10-30T10:00:00Z',
};

const expanded: DiscussionDetail = {
  ...discussion,
  messagesHasMore: false,
  messages: [{
    id: 100,
    content: '<p>Yo puedo ir por la mañana</p>',
    author: { id: 20, name: 'Luis', avatar_url: null },
    is_own: false,
    created_at: '2026-10-30T11:00:00Z',
  }],
};

const props = {
  isMember: true,
  isJoining: false,
  discussions: [discussion],
  discussionsLoading: false,
  discussionsHasMore: false,
  expandedDiscussionId: 3,
  expandedDiscussion: expanded,
  expandedLoading: false,
  loadingEarlierReplies: false,
  replyContent: '',
  sendingReply: false,
  onJoinLeave: vi.fn(),
  onShowNewDiscussion: vi.fn(),
  onExpandDiscussion: vi.fn(),
  onLoadMoreDiscussions: vi.fn(),
  onLoadEarlierReplies: vi.fn(),
  onReplyContentChange: vi.fn(),
  onSendReply: vi.fn(),
};

describe('GroupDiscussionTab — Translate on discussions and replies', () => {
  beforeEach(() => mockPost.mockReset());

  it('offers Translate on the opening post and on each reply', async () => {
    render(<GroupDiscussionTab {...props} />);
    await screen.findByText('Yo puedo ir por la mañana');
    expect(screen.getAllByRole('button', { name: /^translate/i })).toHaveLength(2);
  });

  it('sends the post as words, shows the translation, and restores the formatted original', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { translated_text: 'Who wants to plant on Saturday?', source_locale: 'auto', target_locale: 'en', cached: false },
    });
    render(<GroupDiscussionTab {...props} />);
    await screen.findByText('plantar');

    fireEvent.click(screen.getAllByRole('button', { name: /^translate/i })[0]!);

    await screen.findByText('Who wants to plant on Saturday?');
    expect(mockPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'group_discussion',
      content_id: 3,
      source_text: '¿Quién quiere plantar el sábado?',
    }));

    fireEvent.click(screen.getByRole('button', { name: /show original/i }));
    await waitFor(() => expect(screen.getByText('plantar').tagName).toBe('STRONG'));
  });

  it('translates a reply on its own', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { translated_text: 'I can go in the morning', source_locale: 'auto', target_locale: 'en', cached: false },
    });
    render(<GroupDiscussionTab {...props} />);
    await screen.findByText('Yo puedo ir por la mañana');

    fireEvent.click(screen.getAllByRole('button', { name: /^translate/i })[1]!);

    await screen.findByText('I can go in the morning');
    expect(mockPost).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'group_discussion_reply',
      content_id: 100,
    }));
    expect(screen.getByText('plantar')).toBeInTheDocument();
  });
});
