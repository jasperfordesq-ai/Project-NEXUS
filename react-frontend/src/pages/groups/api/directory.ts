// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import type { Group, GroupVisibility } from '@/types/api';
import {
  normalizeGroupApiError,
  unwrapGroupResponse,
} from './core';

type DirectoryVisibility = Extract<GroupVisibility, 'public' | 'private'>;

export interface GroupDirectoryQuery {
  search?: string;
  visibility?: DirectoryVisibility;
  memberUserId?: number;
  typeId?: number;
  perPage: number;
  cursor?: string | null;
  signal?: AbortSignal;
}

export interface GroupDirectoryPage {
  groups: Group[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number | null;
}

function buildDirectoryParams(query: GroupDirectoryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search) params.set('q', query.search);
  if (query.visibility) params.set('visibility', query.visibility);
  if (query.memberUserId !== undefined) {
    params.set('user_id', String(query.memberUserId));
  }
  if (query.typeId !== undefined) params.set('type_id', String(query.typeId));
  params.set('per_page', String(query.perPage));
  if (query.cursor) params.set('cursor', query.cursor);
  return params;
}

/** Fetch one cursor page from the Groups directory. */
export async function listGroupDirectory(
  query: GroupDirectoryQuery,
): Promise<GroupDirectoryPage> {
  try {
    const params = buildDirectoryParams(query);
    const response = await api.get<Group[]>(`/v2/groups?${params.toString()}`, {
      signal: query.signal,
    });
    const groups = unwrapGroupResponse(response);

    if (!Array.isArray(groups)) {
      throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
    }

    return {
      groups,
      nextCursor: response.meta?.cursor ?? response.meta?.next_cursor ?? null,
      hasMore: response.meta?.has_more ?? false,
      totalCount: response.meta?.total_items ?? null,
    };
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export interface GroupDirectoryType {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
}

/** Active group types the directory can be filtered by, in admin-defined order. */
export async function listGroupDirectoryTypes(
  options: { signal?: AbortSignal } = {},
): Promise<GroupDirectoryType[]> {
  try {
    const response = await api.get<unknown>('/v2/groups/types', { signal: options.signal });
    const rows = unwrapGroupResponse(response);
    if (!Array.isArray(rows)) {
      throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
    }
    return rows.flatMap((row: unknown): GroupDirectoryType[] => {
      if (!row || typeof row !== 'object') return [];
      const { id, name, description, color } = row as Record<string, unknown>;
      if (typeof id !== 'number' || typeof name !== 'string') return [];
      return [{
        id,
        name,
        description: typeof description === 'string' ? description : null,
        color: typeof color === 'string' ? color : null,
      }];
    });
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}
