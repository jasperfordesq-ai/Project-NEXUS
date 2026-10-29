// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GROUP_API_MESSAGE_KEYS } from './core';
import {
  createGroupAnnouncement,
  deleteGroupAnnouncement,
  getPinnedAnnouncements,
  listGroupAnnouncements,
  updateGroupAnnouncement,
} from './announcements';

const { mockDelete, mockGet, mockPost, mockPut } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    delete: mockDelete,
    get: mockGet,
    post: mockPost,
    put: mockPut,
  },
}));

const makeAnnouncement = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Important update',
  content: 'Please read this announcement.',
  author: { id: 4, name: 'Admin User' },
  created_at: '2026-07-11T10:00:00Z',
  is_pinned: true,
  ...overrides,
});

describe('getPinnedAnnouncements', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses the pinned endpoint, forwards cancellation, and normalizes envelope items', async () => {
    const controller = new AbortController();
    mockGet.mockResolvedValue({
      success: true,
      data: {
        items: [
          makeAnnouncement({ id: 1, title: 'Pinned' }),
          makeAnnouncement({ id: 2, title: 'Not pinned', is_pinned: false }),
        ],
      },
    });

    await expect(getPinnedAnnouncements(42, { signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ id: 1, title: 'Pinned' }),
    ]);
    expect(mockGet).toHaveBeenCalledWith(
      '/v2/groups/42/announcements?pinned=1',
      { signal: controller.signal },
    );
  });

  it('supports the legacy announcements envelope and direct array payload', async () => {
    const nested = makeAnnouncement({ title: 'Nested' });
    const direct = makeAnnouncement({ id: 2, title: 'Direct' });
    mockGet
      .mockResolvedValueOnce({ success: true, data: { announcements: [nested] } })
      .mockResolvedValueOnce({ success: true, data: [direct] });

    await expect(getPinnedAnnouncements(1)).resolves.toEqual([nested]);
    await expect(getPinnedAnnouncements(1)).resolves.toEqual([direct]);
  });

  it('turns resolved success:false responses into a stable Groups error', async () => {
    mockGet.mockResolvedValue({
      success: false,
      code: 'HTTP_403',
      error: 'Raw backend message',
    });

    await expect(getPinnedAnnouncements(5)).rejects.toMatchObject({
      name: 'GroupApiError',
      code: 'FORBIDDEN',
      status: 403,
      messageKey: GROUP_API_MESSAGE_KEYS.forbidden,
      retryable: false,
    });
  });

  it.each([
    [new TypeError('Failed to fetch private data'), 'NETWORK_ERROR', GROUP_API_MESSAGE_KEYS.network, true],
    [Object.assign(new Error('Request aborted'), { name: 'AbortError' }), 'CANCELLED', GROUP_API_MESSAGE_KEYS.cancelled, false],
  ] as const)(
    'normalizes thrown transport and cancellation failures',
    async (failure, code, messageKey, retryable) => {
      mockGet.mockRejectedValue(failure);

      await expect(getPinnedAnnouncements(5)).rejects.toMatchObject({
        code,
        messageKey,
        retryable,
      });
    },
  );
});

describe('full announcement contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists announcements, forwards cancellation, and supports collection envelopes', async () => {
    const controller = new AbortController();
    const announcement = makeAnnouncement({ id: 8 });
    mockGet.mockResolvedValue({ success: true, data: { items: [announcement] } });

    await expect(listGroupAnnouncements(23, { signal: controller.signal })).resolves.toEqual([
      announcement,
    ]);
    expect(mockGet).toHaveBeenCalledWith('/v2/groups/23/announcements?limit=100', {
      signal: controller.signal,
    });
  });

  it('follows the cursor so a group with many announcements is listed in full', async () => {
    const first = makeAnnouncement({ id: 1 });
    const second = makeAnnouncement({ id: 2 });
    mockGet
      .mockResolvedValueOnce({ success: true, data: { items: [first], cursor: 'next-1', has_more: true } })
      .mockResolvedValueOnce({ success: true, data: { items: [second], cursor: null, has_more: false } });

    await expect(listGroupAnnouncements(23)).resolves.toEqual([first, second]);
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v2/groups/23/announcements?limit=100&cursor=next-1', { signal: undefined });
  });

  it.each([{ unexpected: [] }, null])(
    'rejects a malformed successful list payload instead of treating it as empty',
    async (payload) => {
      mockGet.mockResolvedValue({ success: true, data: payload });

      await expect(listGroupAnnouncements(23)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        messageKey: GROUP_API_MESSAGE_KEYS.invalidResponse,
      });
    },
  );

  it('routes create, update, and delete mutations through their typed endpoints', async () => {
    const announcement = makeAnnouncement({ id: 19 });
    mockPost.mockResolvedValue({ success: true, data: announcement });
    mockPut.mockResolvedValue({ success: true, data: { ...announcement, is_pinned: false } });
    mockDelete.mockResolvedValue({ success: true });

    await expect(createGroupAnnouncement(3, {
      title: 'Important',
      content: 'Read this.',
      is_pinned: true,
    })).resolves.toEqual(announcement);
    await expect(updateGroupAnnouncement(3, 19, { is_pinned: false })).resolves.toEqual({
      ...announcement,
      is_pinned: false,
    });
    await expect(deleteGroupAnnouncement(3, 19)).resolves.toBeUndefined();

    expect(mockPost).toHaveBeenCalledWith('/v2/groups/3/announcements', {
      title: 'Important',
      content: 'Read this.',
      is_pinned: true,
    });
    expect(mockPut).toHaveBeenCalledWith('/v2/groups/3/announcements/19', {
      is_pinned: false,
    });
    expect(mockDelete).toHaveBeenCalledWith('/v2/groups/3/announcements/19');
  });

  it.each([
    ['create', () => createGroupAnnouncement(3, { title: 'A', content: 'B', is_pinned: false }), () => mockPost],
    ['update', () => updateGroupAnnouncement(3, 19, { is_pinned: true }), () => mockPut],
    ['delete', () => deleteGroupAnnouncement(3, 19), () => mockDelete],
  ] as const)('turns resolved success:false %s responses into errors', async (_name, action, getMock) => {
    getMock().mockResolvedValue({ success: false, code: 'HTTP_403', error: 'Forbidden' });

    await expect(action()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      messageKey: GROUP_API_MESSAGE_KEYS.forbidden,
    });
  });
});
