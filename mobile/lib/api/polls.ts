// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface CreatePollPayload {
  question: string;
  description?: string;
  options: string[];
  poll_type?: 'standard' | 'ranked';
  is_anonymous?: boolean;
  category?: string;
  expires_at?: string;
}

export interface RankedPollResults {
  total_voters: number;
  results: { option_id: number; text: string; votes: number }[];
}

export interface RankedPollResponse {
  data: {
    poll: import('@/lib/api/feed').PollData;
    ranked_results: RankedPollResults | null;
    results_visible: boolean;
    idempotent_replay?: boolean;
  };
}

export interface RankedPollResultsResponse {
  data: {
    poll: import('@/lib/api/feed').PollData;
    ranked_results: RankedPollResults | null;
    results_visible: boolean;
    my_rankings: { option_id: number; rank: number }[] | null;
  };
}

export function createPoll(payload: CreatePollPayload, idempotencyKey?: string): Promise<{ data?: unknown }> {
  const body = {
    poll_type: 'standard',
    is_anonymous: false,
    ...payload,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  };
  if (!idempotencyKey) return api.post<{ data?: unknown }>(`${API_V2}/polls`, body);
  return api.post<{ data?: unknown }>(`${API_V2}/polls`, body, { headers: { 'Idempotency-Key': idempotencyKey } });
}

export function rankPoll(pollId: number, optionIds: number[]): Promise<RankedPollResponse> {
  return api.post<RankedPollResponse>(`${API_V2}/polls/${pollId}/rank`, {
    rankings: optionIds.map((optionId, index) => ({ option_id: optionId, rank: index + 1 })),
  });
}

export function getRankedPollResults(pollId: number): Promise<RankedPollResultsResponse> {
  return api.get<RankedPollResultsResponse>(`${API_V2}/polls/${pollId}/ranked-results`);
}
