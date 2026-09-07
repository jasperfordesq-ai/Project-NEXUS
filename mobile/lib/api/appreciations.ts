// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type AppreciationReactionType = 'heart' | 'clap' | 'star';

export interface Appreciation {
  id: number;
  sender_id: number;
  receiver_id: number;
  message: string;
  is_public: boolean;
  reactions_count: number;
  created_at: string;
  sender?: {
    id: number;
    name: string | null;
    avatar_url: string | null;
  } | null;
  my_reaction?: AppreciationReactionType | null;
}

export interface AppreciationListResponse {
  data: Appreciation[];
  meta?: {
    current_page?: number;
    last_page?: number;
    total_pages?: number;
    per_page?: number;
    total?: number;
  };
}

export interface AppreciationReactionResponse {
  data?: {
    reacted: boolean;
    reaction_type: AppreciationReactionType | null;
  };
}

export function getUserAppreciations(userId: number | string, page = 1, perPage = 20): Promise<AppreciationListResponse> {
  return api.get<AppreciationListResponse>(`${API_V2}/users/${userId}/appreciations`, {
    page: String(page),
    per_page: String(perPage),
  });
}

/**
 * POST /api/v2/appreciations — write a thank-you note to another member.
 *
 * 🔴 The wall was read-only. A member could read other people's thank-you notes and react
 * with a heart, and there was no way anywhere in the app to write one — `POST
 * /v2/appreciations` has been live all along (`routes/api.php:4384`). Found by the
 * 2026-09-07 audit (F/F-4).
 *
 * The server rate-limits this and refuses with a `DomainException` code such as
 * `RATE_LIMIT_EXCEEDED`, so the caller must show its reason rather than a fixed sentence.
 */
export function sendAppreciation(payload: {
  receiver_id: number;
  message: string;
  is_public?: boolean;
  context_type?: string;
  context_id?: number;
}): Promise<{ data: Appreciation }> {
  return api.post<{ data: Appreciation }>(`${API_V2}/appreciations`, {
    receiver_id: payload.receiver_id,
    message: payload.message,
    is_public: payload.is_public ?? true,
    ...(payload.context_type ? { context_type: payload.context_type } : {}),
    ...(payload.context_id ? { context_id: payload.context_id } : {}),
  });
}

export function reactToAppreciation(id: number | string, reactionType: AppreciationReactionType): Promise<AppreciationReactionResponse> {
  return api.post<AppreciationReactionResponse>(`${API_V2}/appreciations/${id}/react`, {
    reaction_type: reactionType,
  });
}
