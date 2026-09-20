// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import type { ReactionToggleResult } from '@/lib/api/feed';

export type CommentTargetType =
  | 'post'
  | 'listing'
  | 'event'
  | 'poll'
  | 'goal'
  | 'job'
  | 'challenge'
  | 'volunteer'
  | 'review'
  | 'blog'
  | 'discussion'
  | 'resource';

/** Valid reaction alphabet — mirrors ReactionService::VALID_TYPES on the backend. */
export type CommentReactionType =
  | 'love'
  | 'like'
  | 'laugh'
  | 'wow'
  | 'sad'
  | 'celebrate'
  | 'clap'
  | 'time_credit';

export interface CommentItem {
  id: number;
  content: string;
  created_at: string;
  edited?: boolean;
  is_own?: boolean;
  author: {
    id: number;
    name: string;
    avatar_url?: string | null;
    avatar?: string | null;
  };
  /**
   * Map of reaction type → count. The backend serializes an empty map as `{}`
   * (PHP `(object) []`), but legacy paths may emit `[]` — always read through
   * normalizeCommentReactions().
   */
  reactions?: Record<string, number> | unknown[];
  /** Reaction types the current viewer has set on this comment. */
  user_reactions?: string[];
  replies?: CommentItem[];
}

/** Defensive normalization: PHP empty maps can arrive as `[]` instead of `{}`. */
export function normalizeCommentReactions(value: CommentItem['reactions']): Record<string, number> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [type, count] of Object.entries(value)) {
    const numeric = Number(count);
    if (Number.isFinite(numeric) && numeric > 0) result[type] = numeric;
  }
  return result;
}

export interface CommentsResponse {
  comments: CommentItem[];
  count: number;
}

export function getComments(targetType: CommentTargetType, targetId: number): Promise<{ data?: CommentsResponse } | CommentsResponse> {
  return api.get<{ data?: CommentsResponse } | CommentsResponse>(`${API_V2}/comments`, {
    target_type: targetType,
    target_id: String(targetId),
  });
}

export function submitComment(
  targetType: CommentTargetType,
  targetId: number,
  content: string,
  parentId?: number,
): Promise<{ data?: CommentItem }> {
  return api.post<{ data?: CommentItem }>(`${API_V2}/comments`, {
    target_type: targetType,
    target_id: targetId,
    content,
    ...(parentId ? { parent_id: parentId } : {}),
  });
}

export function editComment(
  commentId: number,
  content: string,
): Promise<{ data?: { id: number; content: string; edited: boolean } }> {
  return api.put<{ data?: { id: number; content: string; edited: boolean } }>(`${API_V2}/comments/${commentId}`, {
    content,
  });
}

export function deleteComment(
  commentId: number,
): Promise<{ data?: { deleted: boolean; id: number; deleted_count: number } }> {
  return api.delete<{ data?: { deleted: boolean; id: number; deleted_count: number } }>(`${API_V2}/comments/${commentId}`);
}

export function toggleCommentReaction(
  commentId: number,
  reactionType: CommentReactionType,
): Promise<{ data?: ReactionToggleResult }> {
  return api.post<{ data?: ReactionToggleResult }>(
    `${API_V2}/comments/${commentId}/reactions`,
    { reaction_type: reactionType },
  );
}
