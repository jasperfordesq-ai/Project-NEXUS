// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The type matters, and the reason is mandatory.
 *
 * The feed carries posts, listings, events and volunteering entries, and their ids come from
 * different tables. `hide` and `not-interested` take a `type` so the server knows which row
 * an id belongs to — send the wrong one and the member hides something they never saw.
 *
 * `report` requires a non-empty reason (the server answers 400 without one) and answers 409
 * when this member has already reported the item. Both are asserted here because a report
 * that silently fails is the worst outcome for the person reporting something.
 */

// The mock functions are created inside the factory: jest hoists `jest.mock` above the
// imports, so an outer `const` is still uninitialised when the module under test loads.
jest.mock('./client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  ApiResponseError: class ApiResponseError extends Error {},
}));

import { api } from './client';

const mockApi = api as unknown as { post: jest.Mock };

import {
  hideFeedItem,
  markFeedItemNotInterested,
  muteFeedAuthor,
  reportFeedItem,
} from './feedModeration';

describe('feed moderation client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.post.mockResolvedValue({ data: {} });
  });

  it('sends the target type when hiding, so the right row is hidden', async () => {
    await hideFeedItem(181);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v2/feed/posts/181/hide', { type: 'post' });

    await hideFeedItem(513, 'listing');
    expect(mockApi.post).toHaveBeenLastCalledWith('/api/v2/feed/posts/513/hide', {
      type: 'listing',
    });
  });

  it('sends the target type when marking not interested', async () => {
    await markFeedItemNotInterested(162, 'event');
    expect(mockApi.post).toHaveBeenCalledWith('/api/v2/feed/posts/162/not-interested', {
      type: 'event',
    });
  });

  it('sends the reason and the target type when reporting', async () => {
    await reportFeedItem(181, 'safety_concern');

    expect(mockApi.post).toHaveBeenCalledWith('/api/v2/feed/posts/181/report', {
      reason: 'safety_concern',
      target_type: 'post',
    });
  });

  it('mutes a member, not a post', async () => {
    await muteFeedAuthor(675);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v2/feed/users/675/mute', {});
  });

  it('does not swallow a refusal — the caller has to distinguish 409 from a failure', async () => {
    const boom = new Error('already reported');
    mockApi.post.mockRejectedValueOnce(boom);

    await expect(reportFeedItem(181, 'spam')).rejects.toBe(boom);
  });
});
