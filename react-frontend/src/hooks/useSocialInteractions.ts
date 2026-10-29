// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { dispatchFeedSync } from '@/lib/feedSync';
import type { FeedComment } from '@/components/feed/types';
import { REACTION_EMOJI_MAP, type ReactionType } from '@/components/social/reactions';

/* ─── Types ─────────────────────────────────────────────────── */

export interface SocialInteractionsOptions {
  targetType: string;
  targetId: number;
  enabled?: boolean;
  initialLiked?: boolean;
  initialLikesCount?: number;
  initialCommentsCount?: number;
}

export interface LikerUser {
  id: number;
  name: string;
  avatar_url: string | null;
  liked_at: string;
  liked_at_formatted?: string;
}

export interface LikersResult {
  likers: LikerUser[];
  total_count: number;
  has_more: boolean;
}

export interface MentionUser {
  id: number;
  name: string;
  username?: string | null;
  avatar_url: string | null;
  is_connection?: boolean;
}

export const AVAILABLE_REACTIONS = ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate'] as const satisfies readonly ReactionType[];
export const COMMENT_REACTION_EMOJI_MAP: Record<(typeof AVAILABLE_REACTIONS)[number], string> = {
  like: REACTION_EMOJI_MAP.like,
  love: REACTION_EMOJI_MAP.love,
  laugh: REACTION_EMOJI_MAP.laugh,
  wow: REACTION_EMOJI_MAP.wow,
  sad: REACTION_EMOJI_MAP.sad,
  celebrate: REACTION_EMOJI_MAP.celebrate,
};

interface CommentReactionResponse {
  action: 'added' | 'updated' | 'removed';
  reaction_type?: string | null;
  reactions:
    | Record<string, number>
    | {
        counts?: Record<string, number>;
        user_reaction?: string | null;
      };
}

function isCanonicalCommentReactionResponse(
  reactions: CommentReactionResponse['reactions'],
): reactions is { counts?: Record<string, number>; user_reaction?: string | null } {
  return 'counts' in reactions || 'user_reaction' in reactions;
}

function normalizeCommentReactionResponse(data: CommentReactionResponse): {
  reactions: Record<string, number>;
  userReactions: string[];
} {
  const raw = data.reactions;
  const isCanonical = isCanonicalCommentReactionResponse(raw);
  const counts = isCanonical ? raw.counts ?? {} : raw;
  const userReaction = isCanonical ? raw.user_reaction : data.reaction_type;

  return {
    reactions: counts,
    userReactions: data.action === 'removed' || !userReaction ? [] : [userReaction],
  };
}

/* ─── Hook ──────────────────────────────────────────────────── */

export function useSocialInteractions(options: SocialInteractionsOptions) {
  const {
    targetType,
    targetId,
    enabled = false,
    initialLiked = false,
    initialLikesCount = 0,
    initialCommentsCount = 0,
  } = options;

  // Like state
  const [isLiked, setIsLiked] = useState(initialLiked);
  const [likesCount, setLikesCount] = useState(initialLikesCount);
  const [isLiking, setIsLiking] = useState(false);

  // Comments state
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentsCount, setCommentsCount] = useState(initialCommentsCount);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);

  // Guard against double-loading
  const loadingRef = useRef(false);
  const targetKey = `${targetType}:${targetId}`;
  const previousTargetKeyRef = useRef(targetKey);

  // Sync state when initial values change (e.g. after API data loads). Done
  // during render with a prev-prop comparison (not useEffect) so consumers
  // never see a stale frame between the prop change and the synced state.
  const [prevSyncDeps, setPrevSyncDeps] = useState({
    targetKey,
    initialLiked,
    initialLikesCount,
    initialCommentsCount,
  });
  if (
    prevSyncDeps.targetKey !== targetKey ||
    prevSyncDeps.initialLiked !== initialLiked ||
    prevSyncDeps.initialLikesCount !== initialLikesCount ||
    prevSyncDeps.initialCommentsCount !== initialCommentsCount
  ) {
    setPrevSyncDeps({ targetKey, initialLiked, initialLikesCount, initialCommentsCount });

    if (previousTargetKeyRef.current !== targetKey) {
      previousTargetKeyRef.current = targetKey;
      loadingRef.current = false;
      setComments([]);
      setCommentsLoading(false);
      setCommentsLoaded(false);
    }

    setIsLiked(initialLiked);
    setLikesCount(initialLikesCount);
    setCommentsCount(initialCommentsCount);
  }

  /* ───── Like ───── */

  const toggleLike = useCallback(async () => {
    if (!enabled || isLiking) return;
    // Optimistic update
    const wasLiked = isLiked;
    const previousLikesCount = likesCount;
    setIsLiked(!wasLiked);
    setLikesCount((prev) => wasLiked ? Math.max(0, prev - 1) : prev + 1);
    setIsLiking(true);
    try {
      const res = await api.post<{ status: string; action?: string; likes_count: number }>('/v2/feed/like', {
        target_type: targetType,
        target_id: targetId,
      });
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Like request failed');
      }

      const newIsLiked = res.data.status === 'liked' || res.data.action === 'liked';
      const newCount = res.data.likes_count;
      setIsLiked(newIsLiked);
      setLikesCount(newCount);
      // Sync the feed page so the card reflects this change immediately
      dispatchFeedSync({ targetType, targetId, patch: { is_liked: newIsLiked, likes_count: newCount } });
    } catch (err) {
      // Revert on error
      setIsLiked(wasLiked);
      setLikesCount(previousLikesCount);
      logError('Failed to toggle like', err);
    } finally {
      setIsLiking(false);
    }
  }, [targetType, targetId, enabled, isLiked, isLiking, likesCount]);

  /* ───── Comments ───── */

  const loadComments = useCallback(async () => {
    if (!enabled || loadingRef.current) return;
    loadingRef.current = true;
    setCommentsLoading(true);
    try {
      const res = await api.get<{ comments: FeedComment[]; count: number }>(
        `/v2/comments?target_type=${encodeURIComponent(targetType)}&target_id=${targetId}`
      );
      if (res.success && res.data) {
        setComments(res.data.comments ?? []);
        setCommentsCount(res.data.count ?? res.data.comments?.length ?? 0);
      }
    } catch (err) {
      logError('Failed to load comments', err);
    } finally {
      setCommentsLoading(false);
      setCommentsLoaded(true);
      loadingRef.current = false;
    }
  }, [targetType, targetId, enabled]);

  const submitComment = useCallback(async (content: string, parentId?: number): Promise<boolean> => {
    if (!enabled || !content.trim()) return false;
    try {
      const res = await api.post('/v2/comments', {
        target_type: targetType,
        target_id: targetId,
        content: content.trim(),
        ...(parentId ? { parent_id: parentId } : {}),
      });
      if (res.success) {
        setCommentsCount((prev) => prev + 1);
        dispatchFeedSync({ targetType, targetId, patch: { comments_count_delta: +1 } });
        // Reload to get server-rendered comment with author info
        loadingRef.current = false;
        await loadComments();
        return true;
      }
      return false;
    } catch (err) {
      logError('Failed to submit comment', err);
      return false;
    }
  }, [targetType, targetId, enabled, loadComments]);

  const editComment = useCallback(async (commentId: number, content: string): Promise<boolean> => {
    if (!enabled || !content.trim()) return false;
    try {
      const res = await api.put<{ content?: string }>(`/v2/comments/${commentId}`, { content: content.trim() });
      if (res.success) {
        const savedContent = res.data?.content ?? content.trim();
        // Update locally
        const updateInTree = (list: FeedComment[]): FeedComment[] =>
          list.map((c) => {
            if (c.id === commentId) return { ...c, content: savedContent, edited: true };
            if (c.replies?.length) return { ...c, replies: updateInTree(c.replies) };
            return c;
          });
        setComments(updateInTree);
        return true;
      }
      return false;
    } catch (err) {
      logError('Failed to edit comment', err);
      return false;
    }
  }, [enabled]);

  const deleteComment = useCallback(async (commentId: number): Promise<boolean> => {
    if (!enabled) return false;
    try {
      const res = await api.delete<{ deleted_count?: number }>(`/v2/comments/${commentId}`);
      if (res.success) {
        // Remove from tree locally
        const countRemovedFromTree = (list: FeedComment[]): number =>
          list.reduce((total, c) => {
            if (c.id === commentId) {
              return total + 1 + (c.replies?.length ? countRemovedFromTree(c.replies) : 0);
            }
            return total + (c.replies?.length ? countRemovedFromTree(c.replies) : 0);
          }, 0);
        const removedCount = countRemovedFromTree(comments);
        const removeFromTree = (list: FeedComment[]): FeedComment[] =>
          list
            .filter((c) => c.id !== commentId)
            .map((c) => (c.replies?.length ? { ...c, replies: removeFromTree(c.replies) } : c));
        setComments(removeFromTree);
        const delta = Math.max(1, res.data?.deleted_count ?? removedCount);
        setCommentsCount((prev) => Math.max(0, prev - delta));
        dispatchFeedSync({ targetType, targetId, patch: { comments_count_delta: -delta } });
        return true;
      }
      return false;
    } catch (err) {
      logError('Failed to delete comment', err);
      return false;
    }
  }, [comments, enabled, targetId, targetType]);

  /* ───── Reactions ───── */

  const toggleReaction = useCallback(async (commentId: number, reactionType: string) => {
    if (!enabled) return;
    try {
      const res = await api.post<CommentReactionResponse>(
        `/v2/comments/${commentId}/reactions`,
        { reaction_type: reactionType }
      );
      if (res.success && res.data) {
        const { reactions: updatedReactions, userReactions } = normalizeCommentReactionResponse(res.data);
        const updateInTree = (list: FeedComment[]): FeedComment[] =>
          list.map((c) => {
            if (c.id === commentId) {
              return { ...c, reactions: updatedReactions, user_reactions: userReactions };
            }
            if (c.replies?.length) return { ...c, replies: updateInTree(c.replies) };
            return c;
          });
        setComments(updateInTree);
      }
    } catch (err) {
      logError('Failed to toggle reaction', err);
    }
  }, [enabled]);

  /* ───── Share ───── */

  const shareToFeed = useCallback(async (content?: string): Promise<boolean> => {
    if (!enabled) return false;
    try {
      // FeedSocialController::share reads `comment`; this sent `content` until
      // 29 Oct 2026, so the member's words were silently dropped.
      const comment = content?.trim() ?? '';
      const res = await api.post('/v2/shares', {
        type: targetType,
        id: targetId,
        ...(comment ? { comment } : {}),
      });
      return res.success ?? (res as unknown as { status?: string }).status === 'success';
    } catch (err) {
      logError('Failed to share', err);
      return false;
    }
  }, [targetType, targetId, enabled]);

  /* ───── Mention Search ───── */

  const searchMentions = useCallback(async (query: string): Promise<MentionUser[]> => {
    if (!enabled || !query.trim()) return [];
    try {
      // Try V2 endpoint first (GET /v2/mentions/search?q=...)
      const res = await api.get<MentionUser[]>(`/v2/mentions/search?q=${encodeURIComponent(query.trim())}`);
      if (res.success && res.data) return Array.isArray(res.data) ? res.data : [];
      // Fallback to legacy V1 endpoint
      const legacyRes = await api.post<{ users: MentionUser[] }>('/social/mention-search', { query: query.trim() });
      if (legacyRes.success && legacyRes.data) return legacyRes.data.users ?? [];
      const raw = legacyRes as unknown as { users?: MentionUser[] };
      return raw.users ?? [];
    } catch (err) {
      logError('Failed to search mentions', err);
      return [];
    }
  }, [enabled]);

  /* ───── Likers ───── */

  const loadLikers = useCallback(async (page = 1): Promise<LikersResult> => {
    if (!enabled) return { likers: [], total_count: 0, has_more: false };
    try {
      const res = await api.post<LikersResult>('/social/likers', {
        target_type: targetType,
        target_id: targetId,
        page,
        limit: 20,
      });
      if (res.success && res.data) return res.data;
      // V1 shape fallback
      const raw = res as unknown as LikersResult;
      return { likers: raw.likers ?? [], total_count: raw.total_count ?? 0, has_more: raw.has_more ?? false };
    } catch (err) {
      logError('Failed to load likers', err);
      return { likers: [], total_count: 0, has_more: false };
    }
  }, [targetType, targetId, enabled]);

  return {
    // Like
    isLiked,
    likesCount,
    isLiking,
    toggleLike,

    // Comments
    comments: enabled ? comments : [],
    commentsCount,
    commentsLoading,
    commentsLoaded: enabled ? commentsLoaded : false,
    loadComments,
    submitComment,
    editComment,
    deleteComment,

    // Reactions
    availableReactions: AVAILABLE_REACTIONS,
    toggleReaction,

    // Share
    shareToFeed,

    // Mentions
    searchMentions,

    // Likers
    loadLikers,
  };
}
