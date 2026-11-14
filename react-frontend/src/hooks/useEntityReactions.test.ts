// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { applyReaction, useEntityReactions } from './useEntityReactions';
import { FEED_SYNC_EVENT, type FeedSyncPayload } from '@/lib/feedSync';
import { loadReactions } from '@/lib/reactionsBatch';

const stored = { counts: { like: 2, love: 1 }, total: 3, user_reaction: 'love', top_reactors: [] };

describe('applyReaction', () => {
  it('adds a first reaction', () => {
    expect(applyReaction({ counts: {}, total: 0, user_reaction: null }, 'like')).toMatchObject({
      counts: { like: 1 }, total: 1, user_reaction: 'like',
    });
  });

  it('takes the same reaction back off', () => {
    expect(applyReaction({ counts: { like: 1 }, total: 1, user_reaction: 'like' }, 'like')).toMatchObject({
      counts: {}, total: 0, user_reaction: null,
    });
  });

  it('swaps one reaction for another without changing the total', () => {
    expect(applyReaction(stored, 'like')).toMatchObject({
      counts: { like: 3 }, total: 3, user_reaction: 'like',
    });
  });
});

describe('reactionsBatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('asks for everything on the page in one request', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { 'poll:1': { counts: { wow: 1 }, total: 1, user_reaction: null } },
    });

    const [first, second, repeat] = await Promise.all([
      loadReactions('poll', 1),
      loadReactions('poll', 2),
      loadReactions('poll', 1),
    ]);

    expect(mockApi.get).toHaveBeenCalledTimes(1);
    expect(mockApi.get).toHaveBeenCalledWith(`/v2/reactions/batch?items=${encodeURIComponent('poll:1,poll:2')}`);
    expect(first?.total).toBe(1);
    expect(repeat?.total).toBe(1);
    // Not in the answer: nothing the viewer may see, which is the empty state.
    expect(second).toMatchObject({ counts: {}, total: 0, user_reaction: null });
  });

  it('answers "unknown" rather than "none" when the request fails', async () => {
    mockApi.get.mockRejectedValue(new Error('offline'));

    await expect(loadReactions('poll', 1)).resolves.toBeNull();
  });

  it('does not ask about an item with no id', async () => {
    await expect(loadReactions('poll', 0)).resolves.toBeNull();
    expect(mockApi.get).not.toHaveBeenCalled();
  });
});

describe('useEntityReactions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: { 'event:7': stored } });
  });

  it('loads what the store already holds, including the member\'s own reaction', async () => {
    const { result } = renderHook(() => useEntityReactions({ targetType: 'event', targetId: 7, viewerId: 1 }));

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.reactions).toEqual(stored);
  });

  it('reacts, shows the server\'s answer and tells the rest of the page', async () => {
    const server = { counts: { like: 3 }, total: 3, user_reaction: 'like', top_reactors: [] };
    mockApi.post.mockResolvedValue({ success: true, data: { action: 'updated', reactions: server } });
    const heard: FeedSyncPayload[] = [];
    const listener = (event: Event) => heard.push((event as CustomEvent<FeedSyncPayload>).detail);
    window.addEventListener(FEED_SYNC_EVENT, listener);

    const { result } = renderHook(() => useEntityReactions({ targetType: 'event', targetId: 7, viewerId: 1 }));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.react('like');
    });
    window.removeEventListener(FEED_SYNC_EVENT, listener);

    expect(mockApi.post).toHaveBeenCalledWith('/v2/reactions', {
      target_type: 'event', target_id: 7, reaction_type: 'like',
    });
    expect(result.current.reactions).toEqual(server);
    expect(heard).toEqual([{ targetType: 'event', targetId: 7, patch: { reactions: server } }]);
  });

  it('puts things back when the server refuses', async () => {
    mockApi.post.mockResolvedValue({ success: false, error: 'blocked' });

    const { result } = renderHook(() => useEntityReactions({ targetType: 'event', targetId: 7, viewerId: 1 }));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.react('wow');
    });

    expect(result.current.reactions).toEqual(stored);
    expect(result.current.failed).toBe(true);
  });

  it('never asks the members-only store for a visitor, and shows the page\'s own count', async () => {
    const { result } = renderHook(() =>
      useEntityReactions({ targetType: 'event', targetId: 7, viewerId: null, enabled: false, visitorTotal: 4 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockApi.get).not.toHaveBeenCalled();
    expect(result.current.reactions).toMatchObject({ counts: { like: 4 }, total: 4, user_reaction: null });

    await act(async () => {
      await result.current.react('like');
    });
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('ignores a change to a different item', async () => {
    const { result } = renderHook(() => useEntityReactions({ targetType: 'event', targetId: 7, viewerId: 1 }));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent<FeedSyncPayload>(FEED_SYNC_EVENT, {
        detail: { targetType: 'event', targetId: 8, patch: { reactions: { counts: {}, total: 0, user_reaction: null } } },
      }));
    });

    expect(result.current.reactions).toEqual(stored);
  });
});
