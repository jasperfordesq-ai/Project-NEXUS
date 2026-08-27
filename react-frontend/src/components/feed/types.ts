// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

export type FeedFilter = 'all' | 'posts' | 'listings' | 'events' | 'polls' | 'goals' | 'jobs' | 'challenges' | 'volunteering' | 'blogs' | 'discussions' | 'saved' | 'following';
export type PostMode = 'text' | 'poll';

/** A single media attachment (image/video) on a post. */
export interface PostMedia {
  id: number;
  media_type: 'image' | 'video';
  file_url: string;
  thumbnail_url: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
  display_order: number;
}

export interface FeedItem {
  id: number;
  tenant_id?: number;
  content: string;
  content_truncated?: boolean;
  title?: string;
  slug?: string;
  /** Podcast episode activity: owning show slug used to build its canonical route. */
  show_slug?: string;
  author_name?: string;
  author_avatar?: string;
  author_id?: number;
  author?: {
    id: number;
    name: string;
    avatar_url?: string;
  };
  created_at: string;
  updated_at?: string;
  type: 'post' | 'listing' | 'event' | 'poll' | 'goal' | 'review' | 'job' | 'challenge' | 'volunteer' | 'volunteer_hours' | 'blog' | 'discussion' | 'resource' | 'badge_earned' | 'level_up' | 'course' | 'podcast_show' | 'podcast_episode';
  likes_count: number;
  comments_count: number;
  views_count?: number;
  share_count?: number;
  is_liked: boolean;
  is_shared?: boolean;
  is_bookmarked?: boolean;
  image_url?: string;
  /** Multi-image media attachments (carousel). */
  media?: PostMedia[];
  poll_data?: PollData;
  rating?: number;
  receiver?: {
    id: number;
    name: string;
  };
  /** Event-specific: start date/time */
  start_date?: string;
  /** Event/Job/Volunteer-specific: location name */
  location?: string;
  /** Job-specific: job type (paid, volunteer, timebank) */
  job_type?: string;
  /** Job-specific: commitment level */
  commitment?: string;
  /** Challenge-specific: submission deadline */
  submission_deadline?: string;
  /** Challenge-specific: number of ideas submitted */
  ideas_count?: number;
  /** Volunteer-specific: time credits offered */
  credits_offered?: number;
  /** Volunteer-specific: organization name */
  organization?: string;
  /** Volunteer-hours-specific: approved hours logged */
  hours?: number | null;
  /** Badge-earned-specific: badge key */
  badge_key?: string;
  /** Badge-earned-specific: badge name */
  badge_name?: string;
  /** Badge-earned-specific: badge icon (emoji) */
  badge_icon?: string;
  /** Level-up-specific: new level number */
  new_level?: number;
  /** Scheduling: publish status (published, scheduled, draft) */
  publish_status?: 'published' | 'scheduled' | 'draft';
  /** Scheduling: when the post is scheduled to be published */
  scheduled_at?: string;
  /** AG14: true when posted by a municipality_announcer — renders an official badge */
  is_official?: boolean;
  /**
   * When the viewer sees this item because someone they know reposted it,
   * the backend populates this field so the card can render a "Shared by X" header.
   * Not populated for original content.
   */
  shared_by?: {
    id: number;
    name: string;
    avatar_url?: string | null;
    shared_at: string;
  };
  /** Reaction data (replaces simple like system) */
  reactions?: {
    counts: Record<string, number>;
    total: number;
    user_reaction: string | null;
    top_reactors?: Array<{ id: number; name: string; avatar_url?: string | null }>;
  };
  /** Link previews attached to posts */
  link_previews?: Array<{
    url: string;
    title?: string | null;
    description?: string | null;
    image_url?: string | null;
    site_name?: string | null;
    favicon_url?: string | null;
    domain?: string | null;
    content_type?: string | null;
    embed_html?: string | null;
  }>;
  /** Server-provided ranking reasons (when available) */
  ranking_reasons?: string[];
  /**
   * @internal EdgeRank score attached by the backend (float).
   * Server-side stripping is the authoritative fix; on the frontend this field
   * MUST NOT be rendered in any UI element — doing so leaks algorithm signals
   * and could enable gaming. Read-only diagnostic use in dev tooling only.
   */
  _edge_rank?: number;
  /** Quoted post (quote repost) — embedded original post */
  quoted_post?: {
    id: number;
    content: string;
    content_truncated?: boolean;
    image_url?: string | null;
    created_at: string;
    author: {
      id: number;
      name: string;
      avatar_url?: string | null;
    };
    media?: Array<{
      id: number;
      media_type: 'image' | 'video';
      file_url: string;
      thumbnail_url?: string | null;
      alt_text?: string | null;
    }>;
  };
}

export interface PollData {
  id: number;
  question: string;
  options: PollOption[];
  total_votes: number | null;
  user_vote_option_id: number | null;
  is_active: boolean;
  expires_at?: string | null;
}

export interface PollOption {
  id: number;
  text: string;
  vote_count: number | null;
  percentage: number | null;
}

export interface FeedCommentAuthor {
  id: number;
  name: string;
  avatar: string | null;
}

export interface FeedComment {
  id: number;
  content: string;
  created_at: string;
  edited: boolean;
  is_own: boolean;
  author: FeedCommentAuthor;
  reactions: Record<string, number>;
  user_reactions: string[];
  replies: FeedComment[];
}

/** Normalize author fields from API (supports both flat and nested) */
export function getAuthor(item: FeedItem, fallbackName = '') {
  // `||` (not `??`) on name/avatar: the API can serve an empty string for
  // users whose name column is '' — `??` would accept it and render a
  // nameless post with an initials-less avatar.
  return {
    id: item.author_id ?? item.author?.id ?? 0,
    name: item.author_name || item.author?.name || fallbackName,
    avatar: item.author_avatar || item.author?.avatar_url || null,
  };
}

/**
 * Get the detail page path for a feed item, or null if no detail page exists.
 * Posts and polls live exclusively in the feed — no detail page.
 */
export function getItemDetailPath(item: FeedItem): string | null {
  switch (item.type) {
    case 'listing':
      return `/listings/${item.id}`;
    case 'event':
      return `/events/${item.id}`;
    case 'goal':
      return `/goals/${item.id}`;
    case 'review':
      return item.receiver ? `/profile/${item.receiver.id}` : null;
    case 'job':
      return `/jobs/${item.id}`;
    case 'challenge':
      return `/ideation/${item.id}`;
    case 'volunteer':
      return `/volunteering/opportunities/${item.id}`;
    case 'volunteer_hours':
      // An hour-log has no standalone detail page; link to the member's hours.
      return null;
    case 'blog':
      return item.slug ? `/blog/${item.slug}` : `/feed/item/blog/${item.id}`;
    case 'course':
      return item.slug ? `/courses/${item.slug}` : `/courses/${item.id}`;
    case 'podcast_show':
      return item.slug ? `/podcasts/${item.slug}` : '/podcasts';
    case 'podcast_episode':
      return item.slug && item.show_slug
        ? `/podcasts/${item.show_slug}/${item.slug}`
        : '/podcasts';
    case 'discussion':
    case 'resource':
    case 'badge_earned':
    case 'level_up':
      return null;
    case 'post':
    case 'poll':
      return null;
    default: {
      const _exhaustiveCheck: never = item.type;
      void _exhaustiveCheck;
      return null;
    }
  }
}

/** Human-readable label for the "View ..." CTA */
export function getItemDetailLabel(item: FeedItem): string | null {
  switch (item.type) {
    case 'listing':
      return 'card.detail_listing';
    case 'event':
      return 'card.detail_event';
    case 'goal':
      return 'card.detail_goals';
    case 'review':
      return 'card.detail_profile';
    case 'job':
      return 'card.detail_job';
    case 'challenge':
      return 'card.detail_challenge';
    case 'volunteer':
      return 'card.detail_volunteer';
    case 'blog':
      return 'card.detail_blog';
    case 'course':
      return 'card.detail_course';
    case 'podcast_show':
      return 'card.detail_podcast_show';
    case 'podcast_episode':
      return 'card.detail_podcast_episode';
    default:
      return null;
  }
}

/**
 * Gamification milestone feed types — never shown in the feed.
 *
 * `badge_earned` and `level_up` used to render as full-width celebratory cards
 * in every client. Removed on the owner's instruction (2026-08-27) because they
 * crowded out member content.
 *
 * The API no longer serves them (`GamificationService` stops recording the rows,
 * `FeedService::EXCLUDED_SOURCE_TYPES` hides historical ones), so these helpers
 * are the client's own belt and braces against a cached or stale payload. The
 * type stays in the union above on purpose: a stale response must still be
 * type-checkable so it can be filtered, rather than cast away.
 *
 * Nothing else about gamification changes — badges and levels are still awarded,
 * notified, and shown on the achievements page and member profiles.
 */
export const GAMIFICATION_MILESTONE_TYPES: ReadonlySet<string> = new Set([
  'badge_earned',
  'level_up',
]);

/** True when a feed item is a gamification milestone card. */
export function isGamificationMilestone(item: { type: string }): boolean {
  return GAMIFICATION_MILESTONE_TYPES.has(item.type);
}

/**
 * Drop gamification milestones from a feed list.
 *
 * Filtering the list (rather than relying only on `FeedCard` rendering `null`)
 * keeps the surrounding layout clean: a card that renders nothing still leaves
 * its animation wrapper and the list's row gap behind.
 */
export function excludeGamificationMilestones<T extends { type: string }>(items: T[]): T[] {
  return items.filter((item) => !isGamificationMilestone(item));
}
