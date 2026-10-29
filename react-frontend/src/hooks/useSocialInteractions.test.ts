// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSocialInteractions } from './useSocialInteractions';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { api } from '@/lib/api';
const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const defaultOptions = {
  targetType: 'post',
  targetId: 42,
  enabled: true,
  initialLiked: false,
  initialLikesCount: 5,
  initialCommentsCount: 3,
};

describe('useSocialInteractions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      expect(result.current.isLiked).toBe(false);
      expect(result.current.likesCount).toBe(5);
      expect(result.current.commentsCount).toBe(3);
      expect(result.current.isLiking).toBe(false);
      expect(result.current.commentsLoading).toBe(false);
      expect(result.current.commentsLoaded).toBe(false);
    });

    it('exposes AVAILABLE_REACTIONS array', () => {
      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      expect(result.current.availableReactions).toBeDefined();
      expect(result.current.availableReactions.length).toBeGreaterThan(0);
    });

    it('resets comments when the social target changes', async () => {
      mockApi.get.mockResolvedValue({
        success: true,
        data: { comments: [{ id: 1, content: 'Old comment', replies: [] }], count: 1 },
      });

      const { result, rerender } = renderHook(
        ({ targetId }) => useSocialInteractions({ ...defaultOptions, targetId }),
        { initialProps: { targetId: 42 } },
      );

      await act(async () => { await result.current.loadComments(); });
      expect(result.current.comments).toHaveLength(1);
      expect(result.current.commentsLoaded).toBe(true);

      rerender({ targetId: 43 });

      expect(result.current.comments).toEqual([]);
      expect(result.current.commentsLoaded).toBe(false);
      expect(result.current.commentsCount).toBe(3);
    });
  });

  describe('disabled privacy boundary', () => {
    it('does not issue comment, liker, mention, reaction, or write requests', async () => {
      const { result } = renderHook(() => useSocialInteractions({ ...defaultOptions, enabled: false }));

      await act(async () => {
        await result.current.loadComments();
        await result.current.loadLikers();
        await result.current.searchMentions('member');
        await result.current.toggleLike();
        await result.current.submitComment('Comment');
        await result.current.editComment(1, 'Edited');
        await result.current.deleteComment(1);
        await result.current.toggleReaction(1, 'like');
        await result.current.shareToFeed('Share');
      });

      expect(mockApi.get).not.toHaveBeenCalled();
      expect(mockApi.post).not.toHaveBeenCalled();
      expect(mockApi.put).not.toHaveBeenCalled();
      expect(mockApi.delete).not.toHaveBeenCalled();
      expect(result.current.comments).toEqual([]);
      expect(result.current.commentsLoaded).toBe(false);
    });
  });

  describe('toggleLike', () => {
    it('optimistically updates like state', async () => {
      mockApi.post.mockResolvedValue({
        success: true,
        data: { status: 'liked', likes_count: 6 },
      });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      act(() => {
        void result.current.toggleLike();
      });

      // Optimistic update
      expect(result.current.isLiked).toBe(true);
      expect(result.current.likesCount).toBe(6);

      await waitFor(() => expect(result.current.isLiking).toBe(false));
      expect(result.current.isLiked).toBe(true);
      expect(result.current.likesCount).toBe(6);
    });

    it('optimistically un-likes when already liked', async () => {
      mockApi.post.mockResolvedValue({
        success: true,
        data: { status: 'unliked', likes_count: 4 },
      });

      const { result } = renderHook(() =>
        useSocialInteractions({ ...defaultOptions, initialLiked: true, initialLikesCount: 5 })
      );

      act(() => {
        void result.current.toggleLike();
      });

      expect(result.current.isLiked).toBe(false);
      expect(result.current.likesCount).toBe(4);

      await waitFor(() => expect(result.current.isLiking).toBe(false));
    });

    it('reverts optimistic update on API failure', async () => {
      mockApi.post.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      act(() => {
        void result.current.toggleLike();
      });

      await waitFor(() => expect(result.current.isLiking).toBe(false));
      // Should revert
      expect(result.current.isLiked).toBe(false);
      expect(result.current.likesCount).toBe(5);
    });

    it('reverts optimistic update when API returns success false', async () => {
      mockApi.post.mockResolvedValue({
        success: false,
        error: 'Target not found',
      });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      act(() => {
        void result.current.toggleLike();
      });

      await waitFor(() => expect(result.current.isLiking).toBe(false));
      expect(result.current.isLiked).toBe(false);
      expect(result.current.likesCount).toBe(5);
    });

    it('does not allow double-like while liking in progress', async () => {
      let resolvePost: (v: unknown) => void;
      mockApi.post.mockReturnValue(new Promise((r) => { resolvePost = r; }));

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      act(() => {
        void result.current.toggleLike();
      });

      // Second call while first is in flight
      act(() => {
        void result.current.toggleLike();
      });

      await act(async () => {
        resolvePost!({ success: true, data: { status: 'liked', likes_count: 6 } });
      });

      // API should have been called only once
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadComments', () => {
    it('loads and sets comments', async () => {
      const comments = [
        { id: 1, content: 'First comment', author: { id: 1, name: 'Alice' } },
        { id: 2, content: 'Second comment', author: { id: 2, name: 'Bob' } },
      ];
      mockApi.get.mockResolvedValue({ success: true, data: { comments, count: 2 } });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => {
        await result.current.loadComments();
      });

      expect(result.current.comments).toHaveLength(2);
      expect(result.current.commentsCount).toBe(2);
      expect(result.current.commentsLoaded).toBe(true);
    });

    it('calls correct endpoint with target type and id', async () => {
      mockApi.get.mockResolvedValue({ success: true, data: { comments: [], count: 0 } });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => {
        await result.current.loadComments();
      });

      expect(mockApi.get).toHaveBeenCalledWith('/v2/comments?target_type=post&target_id=42');
    });

    it('handles load failure gracefully', async () => {
      mockApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => {
        await result.current.loadComments();
      });

      expect(result.current.commentsLoaded).toBe(true);
      expect(result.current.comments).toHaveLength(0);
    });
  });

  describe('submitComment', () => {
    it('returns false for empty content', async () => {
      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let success: boolean;
      await act(async () => {
        success = await result.current.submitComment('   ');
      });
      expect(success!).toBe(false);
      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('posts comment and increments count on success', async () => {
      mockApi.post.mockResolvedValue({ success: true });
      mockApi.get.mockResolvedValue({ success: true, data: { comments: [], count: 4 } });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let success: boolean;
      await act(async () => {
        success = await result.current.submitComment('Great post!');
      });

      expect(success!).toBe(true);
      expect(mockApi.post).toHaveBeenCalledWith('/v2/comments', expect.objectContaining({
        content: 'Great post!',
        target_type: 'post',
        target_id: 42,
      }));
    });

    it('includes parent_id for replies', async () => {
      mockApi.post.mockResolvedValue({ success: true });
      mockApi.get.mockResolvedValue({ success: true, data: { comments: [], count: 0 } });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => {
        await result.current.submitComment('Reply here', 99);
      });

      expect(mockApi.post).toHaveBeenCalledWith('/v2/comments', expect.objectContaining({
        parent_id: 99,
      }));
    });
  });

  describe('editComment', () => {
    it('returns false for empty content', async () => {
      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      const success = await act(async () => result.current.editComment(1, '  '));
      expect(success).toBe(false);
    });

    it('updates comment content in state on success', async () => {
      mockApi.get.mockResolvedValue({
        success: true,
        data: { comments: [{ id: 1, content: 'Original', replies: [] }], count: 1 },
      });
      mockApi.put.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => { await result.current.loadComments(); });
      await act(async () => { await result.current.editComment(1, 'Updated content'); });

      expect(result.current.comments[0].content).toBe('Updated content');
      expect(result.current.comments[0].edited).toBe(true);
    });
  });

  describe('deleteComment', () => {
    it('removes comment from state and decrements count', async () => {
      mockApi.get.mockResolvedValue({
        success: true,
        data: { comments: [{ id: 1, content: 'To delete', replies: [] }], count: 1 },
      });
      mockApi.delete.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => { await result.current.loadComments(); });

      expect(result.current.commentsCount).toBe(1);

      await act(async () => { await result.current.deleteComment(1); });

      expect(result.current.comments).toHaveLength(0);
      expect(result.current.commentsCount).toBe(0);
    });

    it('uses deleted_count from the server when removing a thread', async () => {
      mockApi.get.mockResolvedValue({
        success: true,
        data: {
          comments: [
            {
              id: 1,
              content: 'Parent',
              replies: [{ id: 2, content: 'Reply', replies: [] }],
            },
          ],
          count: 2,
        },
      });
      mockApi.delete.mockResolvedValue({ success: true, data: { deleted_count: 2 } });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => { await result.current.loadComments(); });

      await act(async () => { await result.current.deleteComment(1); });

      expect(result.current.comments).toHaveLength(0);
      expect(result.current.commentsCount).toBe(0);
    });
  });

  describe('toggleReaction', () => {
    it('normalizes canonical comment reaction response shape', async () => {
      mockApi.get.mockResolvedValue({
        success: true,
        data: { comments: [{ id: 1, content: 'Reactable', reactions: {}, user_reactions: [], replies: [] }], count: 1 },
      });
      mockApi.post.mockResolvedValue({
        success: true,
        data: {
          action: 'added',
          reaction_type: 'love',
          reactions: {
            counts: { love: 1 },
            total: 1,
            user_reaction: 'love',
          },
        },
      });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => { await result.current.loadComments(); });
      await act(async () => { await result.current.toggleReaction(1, 'love'); });

      expect(result.current.comments[0].reactions).toEqual({ love: 1 });
      expect(result.current.comments[0].user_reactions).toEqual(['love']);
    });
  });

  describe('shareToFeed', () => {
    it('posts to share endpoint', async () => {
      mockApi.post.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let success: boolean;
      await act(async () => {
        success = await result.current.shareToFeed('Check this out');
      });

      expect(success!).toBe(true);
      // FeedSocialController::share reads `comment` (29 Oct 2026: was `content`).
      expect(mockApi.post).toHaveBeenCalledWith('/v2/shares', {
        type: 'post',
        id: 42,
        comment: 'Check this out',
      });
    });

    it('sends no comment field for a plain share', async () => {
      mockApi.post.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      await act(async () => {
        await result.current.shareToFeed('   ');
      });

      expect(mockApi.post).toHaveBeenCalledWith('/v2/shares', { type: 'post', id: 42 });
    });

    it('returns false on error', async () => {
      mockApi.post.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let success: boolean;
      await act(async () => {
        success = await result.current.shareToFeed();
      });
      expect(success!).toBe(false);
    });
  });

  describe('searchMentions', () => {
    it('returns empty array for empty query', async () => {
      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let users: unknown[];
      await act(async () => {
        users = await result.current.searchMentions('   ');
      });
      expect(users!).toEqual([]);
      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('returns users on success', async () => {
      const mockUsers = [{ id: 1, name: 'Alice', avatar_url: null }];
      // searchMentions now tries V2 GET endpoint first
      mockApi.get.mockResolvedValue({ success: true, data: mockUsers });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let users: unknown[];
      await act(async () => {
        users = await result.current.searchMentions('ali');
      });
      expect(users!).toEqual(mockUsers);
    });
  });

  describe('loadLikers', () => {
    it('returns likers data', async () => {
      const mockData = { likers: [{ id: 1, name: 'Bob', avatar_url: null, liked_at: '2026-01-01' }], total_count: 1, has_more: false };
      mockApi.post.mockResolvedValue({ success: true, data: mockData });

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let data: typeof mockData;
      await act(async () => {
        data = await result.current.loadLikers();
      });
      expect(data!.likers).toHaveLength(1);
      expect(data!.total_count).toBe(1);
    });

    it('returns empty result on error', async () => {
      mockApi.post.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useSocialInteractions(defaultOptions));
      let data: { likers: unknown[]; total_count: number; has_more: boolean };
      await act(async () => {
        data = await result.current.loadLikers();
      });
      expect(data!.likers).toEqual([]);
      expect(data!.total_count).toBe(0);
      expect(data!.has_more).toBe(false);
    });
  });
});
