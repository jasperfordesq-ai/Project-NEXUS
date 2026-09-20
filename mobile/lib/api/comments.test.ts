// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  deleteComment,
  editComment,
  getComments,
  normalizeCommentReactions,
  submitComment,
  toggleCommentReaction,
} from './comments';
import { api } from '@/lib/api/client';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('comments api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads comments for polymorphic feed targets', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { comments: [], count: 0 } });

    await getComments('poll', 42);

    expect(api.get).toHaveBeenCalledWith('/api/v2/comments', {
      target_type: 'poll',
      target_id: '42',
    });
  });

  it('submits comments for polymorphic feed targets', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 99, content: 'Looks good' } });

    await submitComment('listing', 5, 'Looks good');

    expect(api.post).toHaveBeenCalledWith('/api/v2/comments', {
      target_type: 'listing',
      target_id: 5,
      content: 'Looks good',
    });
  });

  it('submits threaded replies with parent_id', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 100 } });

    await submitComment('listing', 5, 'A reply', 99);

    expect(api.post).toHaveBeenCalledWith('/api/v2/comments', {
      target_type: 'listing',
      target_id: 5,
      content: 'A reply',
      parent_id: 99,
    });
  });

  it('edits own comments via PUT', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { id: 12, content: 'Fixed typo', edited: true } });

    await editComment(12, 'Fixed typo');

    expect(api.put).toHaveBeenCalledWith('/api/v2/comments/12', { content: 'Fixed typo' });
  });

  it('deletes own comments via DELETE', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: { deleted: true, id: 12, deleted_count: 2 } });

    await deleteComment(12);

    expect(api.delete).toHaveBeenCalledWith('/api/v2/comments/12');
  });

  it('toggles comment reactions with reaction_type', async () => {
    const response = { data: { action: 'added', reaction_type: 'like', reactions: { counts: { like: 1 }, total: 1, user_reaction: 'like' } } };
    (api.post as jest.Mock).mockResolvedValue(response);

    await expect(toggleCommentReaction(12, 'like')).resolves.toEqual(response);

    expect(api.post).toHaveBeenCalledWith('/api/v2/comments/12/reactions', { reaction_type: 'like' });
  });

  it('normalizes backend reaction maps defensively', () => {
    // PHP serializes empty maps as [] on some paths and {} on others.
    expect(normalizeCommentReactions(undefined)).toEqual({});
    expect(normalizeCommentReactions([])).toEqual({});
    expect(normalizeCommentReactions({})).toEqual({});
    expect(normalizeCommentReactions({ love: 2, like: '1' as unknown as number })).toEqual({ love: 2, like: 1 });
    expect(normalizeCommentReactions({ love: 0 })).toEqual({});
  });
});
