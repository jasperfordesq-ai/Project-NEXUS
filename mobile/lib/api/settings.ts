// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

type ApiEnvelope<T> = { success?: boolean; data?: T } | T;

export type DataExportFormat = 'json' | 'zip';

export interface DataExportHistoryRow {
  id: number;
  format: string;
  requested_at: string | null;
  completed_at: string | null;
  file_size_bytes: number | null;
}

export interface BlockedUser {
  block_id: number;
  user_id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  reason: string | null;
  blocked_at: string | null;
}

export interface UserPreferences {
  feed?: {
    prefers_chronological?: boolean;
  };
  translation?: {
    auto_translate_ugc?: boolean;
    auto_translate_target_locale?: string | null;
  };
}

export type SubAccountStatus = 'active' | 'pending' | 'revoked' | 'rejected';
export type SubAccountPermission =
  | 'can_view_activity'
  | 'can_manage_listings'
  | 'can_transact'
  | 'can_view_messages';

export interface SubAccountRelationship {
  relationship_id: number;
  relationship_type: string;
  permissions: Partial<Record<SubAccountPermission, boolean>>;
  status: SubAccountStatus;
  approved_at?: string | null;
  created_at: string;
  user_id: number;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  email: string;
}

function unwrap<T>(response: ApiEnvelope<T>, fallback: T): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data?: T }).data ?? fallback;
  }
  return (response as T) ?? fallback;
}

export async function getDataExportHistory(): Promise<DataExportHistoryRow[]> {
  const response = await api.get<ApiEnvelope<{ exports?: DataExportHistoryRow[] }>>(`${API_V2}/me/data-export/history`);
  return unwrap(response, {}).exports ?? [];
}

export function requestDataExport(format: DataExportFormat): Promise<unknown> {
  return api.post<unknown>(`${API_V2}/me/data-export`, { format });
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const response = await api.get<ApiEnvelope<BlockedUser[]>>(`${API_V2}/users/blocked`);
  return unwrap(response, []);
}

export function unblockUser(userId: number): Promise<unknown> {
  return api.delete<unknown>(`${API_V2}/users/${userId}/block`);
}

export async function getUserPreferences(): Promise<UserPreferences> {
  const response = await api.get<ApiEnvelope<UserPreferences>>(`${API_V2}/users/me/preferences`);
  return unwrap(response, {});
}

export function saveUserPreferences(preferences: UserPreferences): Promise<unknown> {
  return api.put<unknown>(`${API_V2}/users/me/preferences`, preferences);
}

export async function getManagedSubAccounts(): Promise<SubAccountRelationship[]> {
  const response = await api.get<ApiEnvelope<SubAccountRelationship[]>>(`${API_V2}/users/me/sub-accounts`);
  return unwrap(response, []);
}

export async function getManagerSubAccounts(): Promise<SubAccountRelationship[]> {
  const response = await api.get<ApiEnvelope<SubAccountRelationship[]>>(`${API_V2}/users/me/parent-accounts`);
  return unwrap(response, []);
}

export function requestSubAccount(email: string): Promise<unknown> {
  return api.post<unknown>(`${API_V2}/users/me/sub-accounts`, { email });
}

export function approveSubAccount(relationshipId: number): Promise<unknown> {
  return api.put<unknown>(`${API_V2}/users/me/sub-accounts/${relationshipId}/approve`);
}

export function updateSubAccountPermissions(
  relationshipId: number,
  permissions: Partial<Record<SubAccountPermission, boolean>>,
): Promise<unknown> {
  return api.put<unknown>(`${API_V2}/users/me/sub-accounts/${relationshipId}/permissions`, { permissions });
}

export function revokeSubAccount(relationshipId: number): Promise<unknown> {
  return api.delete<unknown>(`${API_V2}/users/me/sub-accounts/${relationshipId}`);
}

export interface SubAccountActivityHours {
  hours_given?: number;
  hours_received?: number;
  net_balance?: number;
}

export interface SubAccountActivityConnections {
  total_connections?: number;
  groups_joined?: number;
}

export interface SubAccountActivityEngagement {
  posts_count?: number;
}

export interface SubAccountActivityTimelineItem {
  id: number;
  activity_type: string;
  description?: string | null;
  created_at: string;
}

/**
 * Payload of GET /v2/users/me/sub-accounts/{childId}/activity
 * (MemberActivityService::getDashboardData, permission-gated server-side).
 * Every field optional on purpose — the server may add sections, and a
 * missing one must render as absent, not crash the screen.
 */
export interface SubAccountActivitySummary {
  hours_summary?: SubAccountActivityHours;
  connection_stats?: SubAccountActivityConnections;
  engagement?: SubAccountActivityEngagement;
  timeline?: SubAccountActivityTimelineItem[];
}

/** Read-only activity summary for a member this user supports. 403 when the
 *  grant is off or withdrawn — the caller must show that plainly. */
export async function getSubAccountActivity(childUserId: number): Promise<SubAccountActivitySummary> {
  const response = await api.get<ApiEnvelope<SubAccountActivitySummary>>(
    `${API_V2}/users/me/sub-accounts/${childUserId}/activity`,
  );
  return unwrap(response, {});
}
