// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GROUP_API_MESSAGE_KEYS } from './core';
import { getRecommendedGroups, joinRecommendedGroup } from './recommendations';

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: mockGet,
    post: mockPost,
  },
}));

describe('Groups recommendations API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads at most three valid group matches and forwards cancellation', async () => {
    const controller = new AbortController();
    mockGet.mockResolvedValue({
      success: true,
      data: {
        matches: [
          { module: 'group', group_id: 1, title: 'Garden Crew', match_score: 88, match_reasons: ['Shared interests'] },
          { module: 'group', title: 'Missing identifier', match_score: 80 },
          { module: 'group', group_id: 2, title: 'Book Club', match_score: 72, image_url: null },
          { module: 'group', group_id: 3, title: 'Walking Group', match_score: 65 },
          { module: 'group', group_id: 4, title: 'Fourth valid group', match_score: 60 },
        ],
      },
    });

    const matches = await getRecommendedGroups({ signal: controller.signal });

    expect(mockGet).toHaveBeenCalledWith(
      '/v2/matches/all?modules=groups&limit=3&min_score=50',
      { signal: controller.signal },
    );
    expect(matches.map((match) => match.group_id)).toEqual([1, 2, 3]);
  });

  it('keeps the description written for a recommended group picture', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: {
        matches: [
          { module: 'group', group_id: 1, title: 'Garden Crew', match_score: 88, image_url: '/g.jpg', image_alt: 'Three people planting leeks' },
          { module: 'group', group_id: 2, title: 'Book Club', match_score: 72, image_url: '/b.jpg', image_alt: null },
        ],
      },
    });

    const matches = await getRecommendedGroups();

    expect(matches[0]?.image_alt).toBe('Three people planting leeks');
    expect(matches[1]?.image_alt).toBeNull();
  });

  it('rejects a recommendation whose picture description is not text', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: { matches: [{ module: 'group', group_id: 1, title: 'Garden Crew', match_score: 88, image_alt: 42 }] },
    });

    await expect(getRecommendedGroups()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('returns an empty list for a valid empty match envelope', async () => {
    mockGet.mockResolvedValue({ success: true, data: { matches: [] } });

    await expect(getRecommendedGroups()).resolves.toEqual([]);
  });

  it('normalizes resolved and malformed recommendation failures', async () => {
    mockGet.mockResolvedValueOnce({ success: false, code: 'HTTP_403', error: 'Raw copy' });

    await expect(getRecommendedGroups()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      messageKey: GROUP_API_MESSAGE_KEYS.forbidden,
    });

    mockGet.mockResolvedValueOnce({ success: true, data: {} });

    await expect(getRecommendedGroups()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: GROUP_API_MESSAGE_KEYS.invalidResponse,
    });
  });

  it('normalizes cancellation from the recommendation read', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(getRecommendedGroups()).rejects.toMatchObject({
      code: 'CANCELLED',
      messageKey: GROUP_API_MESSAGE_KEYS.cancelled,
      retryable: false,
    });
  });

  it('joins a recommended group with the exact payload and result contract', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { status: 'pending', message: 'Request sent' },
    });

    await expect(joinRecommendedGroup(42)).resolves.toEqual({
      status: 'pending',
      message: 'Request sent',
    });
    expect(mockPost).toHaveBeenCalledWith('/v2/groups/42/join', {});
  });

  it('does not accept resolved or malformed join responses as success', async () => {
    mockPost.mockResolvedValueOnce({ success: false, code: 'HTTP_409', error: 'Already joined' });

    await expect(joinRecommendedGroup(42)).rejects.toMatchObject({ code: 'CONFLICT' });

    mockPost.mockResolvedValueOnce({ success: true, data: { status: 'active' } });

    await expect(joinRecommendedGroup(42)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
