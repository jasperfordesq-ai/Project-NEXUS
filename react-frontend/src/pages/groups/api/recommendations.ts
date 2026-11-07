// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import { normalizeGroupApiError, unwrapGroupResponse } from './core';

export interface RecommendedGroupMatch {
  module: string;
  group_id: number;
  title: string;
  match_score: number;
  match_reasons?: string[];
  image_url?: string | null;
  /** Member-written description of the group picture; null when none. */
  image_alt?: string | null;
}

export interface GroupJoinResult {
  status: 'active' | 'pending';
  message: string;
}

export interface RecommendedGroupsReadOptions {
  signal?: AbortSignal;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRecommendationsResponse(): never {
  throw normalizeGroupApiError({ code: 'INVALID_RESPONSE' });
}

function normalizeMatch(value: unknown): RecommendedGroupMatch | null {
  if (!isRecord(value)) return invalidRecommendationsResponse();

  const groupId = value.group_id;
  if (groupId === undefined || groupId === null) return null;
  if (
    typeof groupId !== 'number'
    || !Number.isSafeInteger(groupId)
    || groupId <= 0
    || typeof value.module !== 'string'
    || typeof value.title !== 'string'
    || typeof value.match_score !== 'number'
    || !Number.isFinite(value.match_score)
  ) {
    return invalidRecommendationsResponse();
  }

  if (
    value.match_reasons !== undefined
    && (!Array.isArray(value.match_reasons) || value.match_reasons.some((reason) => typeof reason !== 'string'))
  ) {
    return invalidRecommendationsResponse();
  }
  if (value.image_url !== undefined && value.image_url !== null && typeof value.image_url !== 'string') {
    return invalidRecommendationsResponse();
  }
  if (value.image_alt !== undefined && value.image_alt !== null && typeof value.image_alt !== 'string') {
    return invalidRecommendationsResponse();
  }

  return {
    module: value.module,
    group_id: groupId,
    title: value.title,
    match_score: value.match_score,
    ...(value.match_reasons === undefined ? {} : { match_reasons: value.match_reasons as string[] }),
    ...(value.image_url === undefined ? {} : { image_url: value.image_url as string | null }),
    ...(value.image_alt === undefined ? {} : { image_alt: value.image_alt as string | null }),
  };
}

export async function getRecommendedGroups(
  options: RecommendedGroupsReadOptions = {},
): Promise<RecommendedGroupMatch[]> {
  try {
    const response = await api.get<unknown>(
      '/v2/matches/all?modules=groups&limit=3&min_score=50',
      { signal: options.signal },
    );
    const payload = unwrapGroupResponse(response);
    if (!isRecord(payload) || !Array.isArray(payload.matches)) {
      return invalidRecommendationsResponse();
    }

    return payload.matches
      .map(normalizeMatch)
      .filter((match): match is RecommendedGroupMatch => match !== null)
      .slice(0, 3);
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}

export async function joinRecommendedGroup(groupId: number): Promise<GroupJoinResult> {
  try {
    const response = await api.post<unknown>(`/v2/groups/${groupId}/join`, {});
    const payload = unwrapGroupResponse(response);
    if (
      !isRecord(payload)
      || (payload.status !== 'active' && payload.status !== 'pending')
      || typeof payload.message !== 'string'
    ) {
      return invalidRecommendationsResponse();
    }
    return { status: payload.status, message: payload.message };
  } catch (error) {
    throw normalizeGroupApiError(error);
  }
}
