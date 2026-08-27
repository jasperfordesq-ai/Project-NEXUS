// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for feed types and getAuthor helper
 */

import { describe, it, expect } from 'vitest';
import {
  getAuthor,
  getItemDetailPath,
  getItemDetailLabel,
  isGamificationMilestone,
  excludeGamificationMilestones,
} from './types';
import type { FeedItem } from './types';

describe('getAuthor', () => {
  it('extracts author from flat fields', () => {
    const item: FeedItem = {
      id: 1,
      content: 'test',
      author_id: 10,
      author_name: 'Jane',
      author_avatar: '/jane.png',
      created_at: '2026-01-01',
      type: 'post',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    const author = getAuthor(item);
    expect(author.id).toBe(10);
    expect(author.name).toBe('Jane');
    expect(author.avatar).toBe('/jane.png');
  });

  it('extracts author from nested author object', () => {
    const item: FeedItem = {
      id: 1,
      content: 'test',
      author: { id: 20, name: 'Bob', avatar_url: '/bob.png' },
      created_at: '2026-01-01',
      type: 'post',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    const author = getAuthor(item);
    expect(author.id).toBe(20);
    expect(author.name).toBe('Bob');
    expect(author.avatar).toBe('/bob.png');
  });

  it('prefers flat fields over nested object', () => {
    const item: FeedItem = {
      id: 1,
      content: 'test',
      author_id: 10,
      author_name: 'Flat',
      author_avatar: '/flat.png',
      author: { id: 20, name: 'Nested', avatar_url: '/nested.png' },
      created_at: '2026-01-01',
      type: 'post',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    const author = getAuthor(item);
    expect(author.id).toBe(10);
    expect(author.name).toBe('Flat');
    expect(author.avatar).toBe('/flat.png');
  });

  it('returns defaults when no author data', () => {
    const item: FeedItem = {
      id: 1,
      content: 'test',
      created_at: '2026-01-01',
      type: 'post',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    const author = getAuthor(item);
    expect(author.id).toBe(0);
    expect(author.name).toBe('');
    expect(author.avatar).toBeNull();
  });

  it('treats empty-string name/avatar as missing (nameless gamification card regression)', () => {
    // The API can serve author_name: '' for users whose NOT NULL name column
    // is empty — the card must fall back instead of rendering nameless with
    // an initials-less avatar.
    const item: FeedItem = {
      id: 42,
      content: 'Reached Level 2!',
      author_id: 42,
      author_name: '',
      author_avatar: '',
      author: { id: 42, name: '', avatar_url: '' },
      created_at: '2026-01-01',
      type: 'level_up',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    const author = getAuthor(item, 'Unknown member');
    expect(author.name).toBe('Unknown member');
    expect(author.avatar).toBeNull();
  });

  it('falls back to nested name when flat name is empty', () => {
    const item: FeedItem = {
      id: 1,
      content: 'test',
      author_id: 10,
      author_name: '',
      author: { id: 10, name: 'Nested Name', avatar_url: null },
      created_at: '2026-01-01',
      type: 'post',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    expect(getAuthor(item).name).toBe('Nested Name');
  });

  it('handles null avatar gracefully', () => {
    const item: FeedItem = {
      id: 1,
      content: 'test',
      author_id: 10,
      author_name: 'Jane',
      created_at: '2026-01-01',
      type: 'post',
      likes_count: 0,
      comments_count: 0,
      is_liked: false,
    };
    const author = getAuthor(item);
    expect(author.avatar).toBeNull();
  });
});

describe('getItemDetailPath', () => {
  const base: FeedItem = {
    id: 42,
    content: 'test',
    created_at: '2026-01-01',
    type: 'post',
    likes_count: 0,
    comments_count: 0,
    is_liked: false,
  };

  it('returns listings detail path', () => {
    expect(getItemDetailPath({ ...base, type: 'listing' })).toBe('/listings/42');
  });

  it('returns events detail path', () => {
    expect(getItemDetailPath({ ...base, type: 'event' })).toBe('/events/42');
  });

  it('returns goals detail path', () => {
    expect(getItemDetailPath({ ...base, type: 'goal' })).toBe('/goals/42');
  });

  it('returns receiver profile for review', () => {
    expect(getItemDetailPath({ ...base, type: 'review', receiver: { id: 7, name: 'Bob' } })).toBe('/profile/7');
  });

  it('returns null for review without receiver', () => {
    expect(getItemDetailPath({ ...base, type: 'review' })).toBeNull();
  });

  it('returns null for post', () => {
    expect(getItemDetailPath({ ...base, type: 'post' })).toBeNull();
  });

  it('returns null for poll', () => {
    expect(getItemDetailPath({ ...base, type: 'poll' })).toBeNull();
  });
});

describe('getItemDetailLabel', () => {
  const base: FeedItem = {
    id: 1,
    content: 'test',
    created_at: '2026-01-01',
    type: 'post',
    likes_count: 0,
    comments_count: 0,
    is_liked: false,
  };

  it('returns correct labels for typed items', () => {
    expect(getItemDetailLabel({ ...base, type: 'listing' })).toBe('card.detail_listing');
    expect(getItemDetailLabel({ ...base, type: 'event' })).toBe('card.detail_event');
    expect(getItemDetailLabel({ ...base, type: 'goal' })).toBe('card.detail_goals');
    expect(getItemDetailLabel({ ...base, type: 'review' })).toBe('card.detail_profile');
  });

  it('returns null for post and poll', () => {
    expect(getItemDetailLabel({ ...base, type: 'post' })).toBeNull();
    expect(getItemDetailLabel({ ...base, type: 'poll' })).toBeNull();
  });
});

/*
 * Gamification milestones were removed from the feed on the owner's instruction
 * (2026-08-27). Every feed list filters through excludeGamificationMilestones,
 * so this is the shared guard the whole React client depends on.
 */
describe('gamification milestone helpers', () => {
  const base: FeedItem = {
    id: 1,
    content: 'test',
    created_at: '2026-01-01',
    type: 'post',
    likes_count: 0,
    comments_count: 0,
    is_liked: false,
  };

  it('identifies badge and level milestones', () => {
    expect(isGamificationMilestone({ ...base, type: 'badge_earned' })).toBe(true);
    expect(isGamificationMilestone({ ...base, type: 'level_up' })).toBe(true);
  });

  it('leaves real content types alone', () => {
    expect(isGamificationMilestone({ ...base, type: 'post' })).toBe(false);
    expect(isGamificationMilestone({ ...base, type: 'challenge' })).toBe(false);
    expect(isGamificationMilestone({ ...base, type: 'goal' })).toBe(false);
  });

  it('drops milestones from a feed list and keeps the order of the rest', () => {
    const items: FeedItem[] = [
      { ...base, id: 1, type: 'post' },
      { ...base, id: 2, type: 'badge_earned' },
      { ...base, id: 3, type: 'listing' },
      { ...base, id: 4, type: 'level_up' },
      { ...base, id: 5, type: 'event' },
    ];

    expect(excludeGamificationMilestones(items).map((item) => item.id)).toEqual([1, 3, 5]);
  });

  it('returns an empty list when every item is a milestone', () => {
    const items: FeedItem[] = [
      { ...base, id: 1, type: 'badge_earned' },
      { ...base, id: 2, type: 'level_up' },
    ];

    expect(excludeGamificationMilestones(items)).toEqual([]);
  });
});
