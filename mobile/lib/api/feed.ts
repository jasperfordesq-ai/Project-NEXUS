// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type FeedItemType =
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
  | 'resource'
  | 'badge_earned'
  | 'level_up';

export type FeedFilter =
  | 'all'
  | 'following'
  | 'saved'
  | 'posts'
  | 'listings'
  | 'events'
  | 'polls'
  | 'goals'
  | 'jobs'
  | 'challenges'
  | 'volunteering'
  | 'blogs'
  | 'discussions';

export type FeedMode = 'ranking' | 'recent';

/**
 * 🔴 The tallies are nullable, and the app has to cope with that.
 *
 * `FeedService` withholds results from everyone except the poll's creator while the poll
 * is open, so `total_votes`, `vote_count` and `percentage` all arrive as `null`. They were
 * typed as plain `number` here, which is why `PollCard` did arithmetic on them and drew a
 * chart out of nothing (fixed 2026-08-22).
 */
export interface PollOption {
  id: number;
  text: string;
  vote_count: number | null;
  percentage: number | null;
}

export interface PollData {
  id: number;
  question: string;
  options: PollOption[];
  total_votes: number | null;
  user_vote_option_id: number | null;
  is_active: boolean;
  /**
   * 🔴 Two endpoints say "results are withheld" in two different ways, and a client has to
   * accept both. `PollService` (the vote endpoint) sends `results_visible: false` and still
   * sends a real `total_votes` — participation volume is deliberately public, only the
   * distribution is secret. `FeedService` sends no such flag and nulls `total_votes`
   * instead. Trusting only the null is what made the card show "2 votes" beside 0% and 0%.
   */
  results_visible?: boolean;
}

export interface FeedItem {
  id: number;
  type: FeedItemType;
  title: string;
  content: string | null;
  image_url: string | null;
  user_id?: number;
  author_id?: number;
  author_name?: string | null;
  author_avatar?: string | null;
  author?: {
    id: number;
    name: string;
    avatar_url?: string | null;
  } | null;
  user?: {
    id: number;
    name: string;
    avatar_url?: string | null;
    avatar?: string | null;
  } | null;
  is_liked?: boolean;
  likes_count: number;
  comments_count: number;
  created_at: string;
  location: string | null;
  rating: number | null;
  views_count?: number;
  share_count?: number;
  is_bookmarked?: boolean;
  is_shared?: boolean;
  is_official?: boolean;
  content_truncated?: boolean;
  slug?: string | null;
  start_date: string | null;
  job_type: string | null;
  commitment: string | null;
  submission_deadline: string | null;
  receiver: { id: number; name: string } | null;
  organization?: string | null;
  credits_offered?: number | null;
  ideas_count?: number | null;
  badge_name?: string | null;
  badge_icon?: string | null;
  new_level?: number | null;
  reactions?: ReactionsSummary;
  link_previews?: {
    url: string;
    title?: string | null;
    description?: string | null;
    image_url?: string | null;
    site_name?: string | null;
    domain?: string | null;
  }[];
  poll_data?: PollData | null;
  media?: {
    id: number;
    media_type: 'image' | 'video';
    file_url: string;
    thumbnail_url: string | null;
    alt_text: string | null;
    width: number | null;
    height: number | null;
    display_order: number;
  }[];
}

export function getFeedAuthor(item: FeedItem, fallbackName: string) {
  return {
    id: item.user_id ?? item.author_id ?? item.author?.id ?? item.user?.id ?? 0,
    name: item.author_name ?? item.author?.name ?? item.user?.name ?? fallbackName,
    avatar: item.author_avatar ?? item.author?.avatar_url ?? item.user?.avatar_url ?? item.user?.avatar ?? null,
  };
}

export interface FeedQueryOptions {
  cursor?: string | null;
  filter?: FeedFilter;
  mode?: FeedMode;
  subtype?: string | null;
  perPage?: number;
}

export interface FeedResponse {
  data: FeedItem[];
  meta: {
    per_page: number;
    has_more: boolean;
    cursor: string | null;
    base_url?: string;
  };
}

export interface HashtagItem {
  tag: string;
  post_count: number;
  trend_direction?: 'up' | 'down' | 'stable';
}

export interface HashtagFeedResponse {
  data: FeedItem[];
  meta?: {
    has_more?: boolean;
    cursor?: string | null;
    total_items?: number;
  };
}

const POLYMORPHIC_FEED_TYPES = new Set<FeedItemType>([
  'post',
  'listing',
  'event',
  'poll',
  'goal',
  'job',
  'challenge',
  'volunteer',
  'review',
  'blog',
  'discussion',
  'resource',
]);

/**
 * GET /api/v2/feed — personalised activity feed for the current tenant.
 *
 * Pass `cursor` for cursor-based pagination (preferred). If `cursor` is
 * provided it takes precedence and `page` is ignored by the server.
 */
export function getFeed(page = 1, cursor?: string | null, options: Omit<FeedQueryOptions, 'cursor'> = {}): Promise<FeedResponse> {
  const params: Record<string, string> = {
    page: String(page),
    per_page: String(options.perPage ?? 20),
    mode: options.mode === 'recent' ? 'chronological' : 'ranked',
    personalised: options.mode === 'recent' ? 'false' : 'true',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const filter = options.filter ?? 'all';
  if (filter !== 'all') {
    params['type'] = filter;
  }
  if (options.subtype) {
    params['subtype'] = options.subtype;
  }
  if (cursor) {
    params['cursor'] = cursor;
  }
  return api.get<FeedResponse>(`${API_V2}/feed`, params);
}

export function getFeedItem(type: FeedItemType, id: number): Promise<{ data: FeedItem }> {
  const safeType = POLYMORPHIC_FEED_TYPES.has(type) ? type : 'post';
  const path = safeType === 'post'
    ? `${API_V2}/feed/posts/${id}`
    : `${API_V2}/feed/items/${safeType}/${id}`;

  return api.get<{ data: FeedItem }>(path);
}

export function getTrendingHashtags(limit = 50): Promise<{ data?: HashtagItem[] } | HashtagItem[]> {
  return api.get<{ data?: HashtagItem[] } | HashtagItem[]>(`${API_V2}/feed/hashtags/trending`, {
    limit: String(limit),
  });
}

export function searchHashtags(query: string): Promise<{ data?: HashtagItem[] } | HashtagItem[]> {
  return api.get<{ data?: HashtagItem[] } | HashtagItem[]>(`${API_V2}/feed/hashtags/search`, {
    q: query,
  });
}

export function getHashtagFeed(tag: string, cursor?: string | null, perPage = 20): Promise<HashtagFeedResponse> {
  const params: Record<string, string> = {
    per_page: String(perPage),
  };
  if (cursor) {
    params.cursor = cursor;
  }
  return api.get<HashtagFeedResponse>(`${API_V2}/feed/hashtags/${encodeURIComponent(tag)}`, params);
}

/** Mirrors App\Services\ReactionService::VALID_TYPES (and the web ReactionPicker). */
export type ReactionType = 'love' | 'like' | 'laugh' | 'wow' | 'sad' | 'celebrate' | 'clap' | 'time_credit';

export interface ReactionsSummary {
  counts: Record<string, number>;
  total: number;
  user_reaction: string | null;
  top_reactors?: { id: number; name: string | null; avatar_url?: string | null }[];
}

export interface ReactionToggleResult {
  action: 'added' | 'removed' | 'updated';
  reaction_type: ReactionType | null;
  reactions: ReactionsSummary;
}

/**
 * POST /api/v2/reactions — toggle an emoji reaction on any reactable entity.
 * Polymorphic: target_type must be one of ReactionService::VALID_TARGET_TYPES
 * (post, listing, event, goal, poll, review, volunteer, challenge, resource,
 * job, blog, discussion, comment).
 */
export function toggleReaction(
  targetType: string,
  targetId: number,
  reactionType: ReactionType,
): Promise<{ data: ReactionToggleResult }> {
  return api.post<{ data: ReactionToggleResult }>(`${API_V2}/reactions`, {
    target_type: targetType,
    target_id: targetId,
    reaction_type: reactionType,
  });
}

export interface ReactorUser {
  id: number;
  name: string;
  avatar_url: string | null;
  reacted_at?: string;
}

/**
 * GET /api/v2/reactions/{type}/{id}/users/{reactionType} — paginated list of
 * users who reacted with a specific type (for the reactors sheet).
 */
export function getReactors(
  targetType: string,
  targetId: number,
  reactionType: ReactionType,
  page = 1,
  perPage = 30,
): Promise<{ data: ReactorUser[]; meta?: { total?: number } }> {
  return api.get<{ data: ReactorUser[]; meta?: { total?: number } }>(
    `${API_V2}/reactions/${encodeURIComponent(targetType)}/${targetId}/users/${encodeURIComponent(reactionType)}`,
    { page: String(page), per_page: String(perPage) },
  );
}

export interface LikeResult {
  /** The API returns action: 'liked' | 'unliked' — there is NO boolean
   *  `liked` field. Reading `.liked` returned undefined and un-highlighted
   *  the button the moment the server responded (2026-06-11 bug). */
  action: 'liked' | 'unliked';
  likes_count: number;
}

/**
 * POST /api/v2/feed/like — toggle like on a feed item.
 * target_type maps the feed item type to the like target:
 *   post → 'post', listing → 'listing', event → 'event'
 */
export function toggleLike(targetType: string, targetId: number): Promise<{ data: LikeResult }> {
  return api.post<{ data: LikeResult }>(`${API_V2}/feed/like`, {
    target_type: targetType,
    target_id: targetId,
  });
}

export interface BookmarkResult {
  bookmarked: boolean;
}

/**
 * POST /api/v2/bookmarks — toggle bookmark/save on a feed item.
 */
export function toggleBookmark(targetType: string, targetId: number): Promise<{ data: BookmarkResult }> {
  return api.post<{ data: BookmarkResult }>(`${API_V2}/bookmarks`, {
    type: targetType,
    id: targetId,
  });
}

/**
 * GET /api/v2/feed/polls/:pollId — fetch current poll state.
 */
export function getFeedPoll(pollId: number): Promise<{ data: PollData }> {
  return api.get<{ data: PollData }>(`${API_V2}/feed/polls/${pollId}`);
}

/**
 * POST /api/v2/feed/polls/:pollId/vote — cast a vote on a poll option.
 */
export function voteFeedPoll(pollId: number, optionId: number): Promise<{ data: PollData }> {
  return api.post<{ data: PollData }>(`${API_V2}/feed/polls/${pollId}/vote`, { option_id: optionId });
}
