// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FEED_SYNC_EVENT,
  applyFeedSyncToItem,
  dispatchFeedSync,
  type FeedSyncPayload,
} from './feedSync';

interface Item {
  id: number;
  type: string;
  is_liked?: boolean;
  likes_count?: number;
  is_bookmarked?: boolean;
  is_shared?: boolean;
  share_count?: number;
  comments_count?: number;
  reactions?: FeedSyncPayload['patch']['reactions'];
  unrelated?: string;
}

const item = (over: Partial<Item> = {}): Item => ({
  id: 42,
  type: 'listing',
  is_liked: false,
  likes_count: 3,
  comments_count: 2,
  unrelated: 'keep-me',
  ...over,
});

describe('applyFeedSyncToItem', () => {
  it('returns the same reference when the type does not match', () => {
    const it0 = item();
    const out = applyFeedSyncToItem(it0, { targetType: 'event', targetId: 42, patch: { is_liked: true } });
    expect(out).toBe(it0);
  });

  it('returns the same reference when the id does not match', () => {
    const it0 = item();
    const out = applyFeedSyncToItem(it0, { targetType: 'listing', targetId: 99, patch: { is_liked: true } });
    expect(out).toBe(it0);
  });

  it('applies like state and count while preserving unrelated fields', () => {
    const out = applyFeedSyncToItem(item(), {
      targetType: 'listing',
      targetId: 42,
      patch: { is_liked: true, likes_count: 4 },
    });
    expect(out.is_liked).toBe(true);
    expect(out.likes_count).toBe(4);
    expect(out.unrelated).toBe('keep-me');
  });

  it('clamps negative likes_count and share_count to zero', () => {
    const out = applyFeedSyncToItem(item(), {
      targetType: 'listing',
      targetId: 42,
      patch: { likes_count: -5, share_count: -1 },
    });
    expect(out.likes_count).toBe(0);
    expect(out.share_count).toBe(0);
  });

  it('applies a positive comments_count delta', () => {
    const out = applyFeedSyncToItem(item({ comments_count: 2 }), {
      targetType: 'listing',
      targetId: 42,
      patch: { comments_count_delta: 1 },
    });
    expect(out.comments_count).toBe(3);
  });

  it('clamps a comments_count delta that would go negative', () => {
    const out = applyFeedSyncToItem(item({ comments_count: 0 }), {
      targetType: 'listing',
      targetId: 42,
      patch: { comments_count_delta: -1 },
    });
    expect(out.comments_count).toBe(0);
  });

  it('treats a missing comments_count as zero before applying the delta', () => {
    const out = applyFeedSyncToItem(item({ comments_count: undefined }), {
      targetType: 'listing',
      targetId: 42,
      patch: { comments_count_delta: 2 },
    });
    expect(out.comments_count).toBe(2);
  });

  it('replaces the reactions object wholesale', () => {
    const reactions = { counts: { '👍': 2 }, total: 2, user_reaction: '👍' };
    const out = applyFeedSyncToItem(item(), {
      targetType: 'listing',
      targetId: 42,
      patch: { reactions },
    });
    expect(out.reactions).toEqual(reactions);
    // One store: the like fields are derived from the reactions summary.
    expect(out.is_liked).toBe(true);
    expect(out.likes_count).toBe(2);
  });

  it('applies bookmark and share flags', () => {
    const out = applyFeedSyncToItem(item(), {
      targetType: 'listing',
      targetId: 42,
      patch: { is_bookmarked: true, is_shared: true, share_count: 7 },
    });
    expect(out.is_bookmarked).toBe(true);
    expect(out.is_shared).toBe(true);
    expect(out.share_count).toBe(7);
  });

  it('does not mutate the original item', () => {
    const it0 = item();
    applyFeedSyncToItem(it0, { targetType: 'listing', targetId: 42, patch: { is_liked: true } });
    expect(it0.is_liked).toBe(false);
  });
});

describe('dispatchFeedSync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dispatches a CustomEvent carrying the payload', () => {
    const handler = vi.fn();
    window.addEventListener(FEED_SYNC_EVENT, handler as EventListener);
    const payload: FeedSyncPayload = {
      targetType: 'post',
      targetId: 1,
      patch: { is_liked: true },
    };
    dispatchFeedSync(payload);
    window.removeEventListener(FEED_SYNC_EVENT, handler as EventListener);

    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent<FeedSyncPayload>;
    expect(evt.detail).toEqual(payload);
  });
});
