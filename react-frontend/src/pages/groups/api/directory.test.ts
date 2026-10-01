// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import type { Group } from '@/types/api';
import { GroupApiError } from './core';
import { listGroupDirectory, listGroupDirectoryTypes } from './directory';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const group: Group = {
  id: 42,
  name: 'Garden Crew',
  description: 'Grow food together.',
  members_count: 12,
  is_member: true,
  visibility: 'public',
  created_at: '2026-01-01T00:00:00Z',
};

describe('listGroupDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps directory filters and cursor metadata to a typed page', async () => {
    const controller = new AbortController();
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [group],
      meta: {
        per_page: 20,
        has_more: true,
        next_cursor: 'next-page',
        total_items: 45,
      },
    });

    const page = await listGroupDirectory({
      search: 'garden club',
      visibility: 'public',
      perPage: 20,
      cursor: 'current-page',
      signal: controller.signal,
    });

    expect(api.get).toHaveBeenCalledWith(
      '/v2/groups?q=garden+club&visibility=public&per_page=20&cursor=current-page',
      { signal: controller.signal },
    );
    expect(page).toEqual({
      groups: [group],
      nextCursor: 'next-page',
      hasMore: true,
      totalCount: 45,
    });
  });

  it('maps the joined-groups filter to the membership user query', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [group],
      meta: { per_page: 20, has_more: false },
    });

    const page = await listGroupDirectory({ memberUserId: 7, perPage: 20 });

    expect(api.get).toHaveBeenCalledWith(
      '/v2/groups?user_id=7&per_page=20',
      { signal: undefined },
    );
    expect(page.groups[0]?.is_member).toBe(true);
  });

  it('maps the group type filter to the type_id query', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [group],
      meta: { per_page: 20, has_more: false },
    });

    await listGroupDirectory({ typeId: 5, perPage: 20 });

    expect(api.get).toHaveBeenCalledWith(
      '/v2/groups?type_id=5&per_page=20',
      { signal: undefined },
    );
  });

  it('rejects a resolved success:false envelope as a domain error', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: false,
      code: 'HTTP_403',
      error: 'Raw server copy',
    });

    const request = listGroupDirectory({ perPage: 20 });

    await expect(request).rejects.toBeInstanceOf(GroupApiError);
    await expect(request).rejects.toMatchObject({
      code: 'FORBIDDEN',
      messageKey: 'api_errors.forbidden',
    });
  });

  it('normalizes thrown transport failures and malformed success data', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new TypeError('Private transport detail'));

    await expect(listGroupDirectory({ perPage: 20 })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      messageKey: 'api_errors.network',
      retryable: true,
    });

    vi.mocked(api.get).mockResolvedValueOnce({ success: true });

    await expect(listGroupDirectory({ perPage: 20 })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'api_errors.invalid_response',
      retryable: true,
    });
  });
});

describe('listGroupDirectoryTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the active types and drops malformed rows', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        { id: 3, name: 'Hobby', description: 'Shared pastimes', color: '#10b981' },
        { id: 4, name: 'Support', description: null, color: null },
        { id: 'bad', name: 'Broken' },
      ],
    });

    await expect(listGroupDirectoryTypes()).resolves.toEqual([
      { id: 3, name: 'Hobby', description: 'Shared pastimes', color: '#10b981' },
      { id: 4, name: 'Support', description: null, color: null },
    ]);
    expect(api.get).toHaveBeenCalledWith('/v2/groups/types', { signal: undefined });
  });

  it('rejects a non-list payload as an invalid response', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { id: 3 } });

    await expect(listGroupDirectoryTypes()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
