// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type ConnectionStatusType = 'none' | 'connected' | 'pending_sent' | 'pending_received';
export type ConnectionListStatus = 'accepted' | 'pending_received' | 'pending_sent';

export interface ConnectionUser {
  id: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  location?: string | null;
  bio?: string | null;
}

export interface Connection {
  id?: number;
  connection_id?: number;
  user: ConnectionUser;
  status: ConnectionListStatus | string;
  created_at?: string | null;
  message?: string | null;
}

export interface ConnectionListResponse {
  data: Connection[];
  meta?: {
    per_page?: number;
    has_more?: boolean;
    cursor?: string | null;
    base_url?: string;
  };
}

export interface ConnectionStatus {
  status: ConnectionStatusType;
  connection_id: number | null;
  direction: 'sent' | 'received' | null;
}

/** GET /api/v2/connections — list accepted/pending connections */
export function getConnections(status: ConnectionListStatus, cursor?: string | null): Promise<ConnectionListResponse> {
  const params: Record<string, string> = {
    status,
    per_page: '20',
  };
  if (cursor) params.cursor = cursor;
  return api.get<ConnectionListResponse>(`${API_V2}/connections`, params);
}

/** GET /api/v2/connections/status/{userId} */
export function getConnectionStatus(userId: number): Promise<{ data: ConnectionStatus }> {
  return api.get<{ data: ConnectionStatus }>(`${API_V2}/connections/status/${userId}`);
}

/** POST /api/v2/connections/request — send connection request */
export function sendConnectionRequest(userId: number): Promise<{ data: { status: string; connection_id: number; message: string } }> {
  return api.post<{ data: { status: string; connection_id: number; message: string } }>(`${API_V2}/connections/request`, { user_id: userId });
}

/** POST /api/v2/connections/{id}/accept */
export function acceptConnection(connectionId: number): Promise<{ data: { connection_id: number; status: string } }> {
  return api.post<{ data: { connection_id: number; status: string } }>(`${API_V2}/connections/${connectionId}/accept`, {});
}

/** POST /api/v2/connections/{id}/decline — decline a received pending request */
export function declineConnection(connectionId: number): Promise<void> {
  return api.post<void>(`${API_V2}/connections/${connectionId}/decline`, {});
}

/** DELETE /api/v2/connections/{id}, bound to the relationship state shown to the member. */
export function removeConnection(connectionId: number, expectedStatus: 'pending' | 'accepted'): Promise<void> {
  return api.delete<void>(`${API_V2}/connections/${connectionId}?expected_status=${expectedStatus}`);
}
