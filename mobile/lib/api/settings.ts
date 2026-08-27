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

/**
 * Per-capability support levels (guardian redesign). Mirrors the backend
 * SupportTiers vocabulary. 🔴 The legacy booleans are LOSSY: `co_decide`
 * ("prepare only") projects to `false`, so a boolean-driven toggle renders a
 * real grant as OFF and re-posting it as `true` used to escalate the grant to
 * full act-alone power. Read state from `tiers`, write explicit tiers.
 */
export type SupportTier = 'none' | 'assist' | 'co_decide' | 'represent';
export type SupportTierCapability = 'activity' | 'listings' | 'credits';

export interface SubAccountRelationship {
  relationship_id: number;
  relationship_type: string;
  permissions: Partial<Record<SubAccountPermission, boolean>> & {
    tiers?: Partial<Record<SupportTierCapability, SupportTier>>;
  };
  status: SubAccountStatus;
  approved_at?: string | null;
  created_at: string;
  user_id: number;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  email: string;
  /** Coordinator-recorded arrangement: levels are the MEMBER's to set, never
   *  the supporter's — render read-only, never toggles. */
  staff_recorded?: boolean;
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

/**
 * GDPR Article 17 erasure of the signed-in member's own account.
 *
 * `DELETE /api/v2/users/me`, the same endpoint the web app's settings page calls, so both
 * clients get identical server behaviour: password re-authentication, then
 * `GdprService::executeAccountDeletion` (messages, tokens, passkeys, listings, AI chat,
 * uploaded files and the search index — not a PII-column wipe), then a farewell email and
 * an admin notification.
 *
 * 🔴 The password goes in the BODY. `api.delete()` gained body support for this call; a
 * password in a query string would land in server and proxy logs. The server answers 400
 * `VALIDATION_ERROR` with no password, 403 `INVALID_PASSWORD` on a wrong one, and rate
 * limits to one attempt per minute — so a failure here is worth showing verbatim rather
 * than collapsing into "something went wrong".
 */
export function deleteAccount(password: string): Promise<unknown> {
  return api.delete<unknown>(`${API_V2}/users/me`, { body: { password } });
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const response = await api.get<ApiEnvelope<BlockedUser[]>>(`${API_V2}/users/blocked`);
  return unwrap(response, []);
}

/**
 * Block a member in the signed-in member's current community.
 *
 * The server also removes any connection between the two members. Feed, search and
 * messaging queries use the resulting bilateral block relationship, so this is the
 * service-level safety control Apple expects rather than a local UI-only mute.
 */
export function blockUser(userId: number, reason = 'safety_concern'): Promise<unknown> {
  return api.post<unknown>(`${API_V2}/users/${userId}/block`, { reason });
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

/**
 * Change one capability's support level by EXPLICIT tier.
 *
 * 🔴 Always prefer this over updateSubAccountPermissions for listings/credits:
 * posting a boolean cannot express "prepare only", so a boolean write from a
 * screen that rendered a co_decide grant as an off toggle used to convert it
 * into act-alone authority. The endpoint keeps the legacy booleans in sync
 * server-side.
 */
export function updateSubAccountTiers(
  relationshipId: number,
  tiers: Partial<Record<SupportTierCapability, SupportTier>>,
): Promise<unknown> {
  return api.put<unknown>(`${API_V2}/users/me/sub-accounts/${relationshipId}/permissions`, {
    permissions: { tiers },
  });
}

export function updateManagerSubAccountTiers(
  relationshipId: number,
  tiers: Partial<Record<SupportTierCapability, SupportTier>>,
): Promise<unknown> {
  return api.put<unknown>(`${API_V2}/users/me/parent-accounts/${relationshipId}/permissions`, {
    permissions: { tiers },
  });
}

/**
 * Resolve the effective tier per capability, mirroring the backend
 * SupportTiers::resolve(): explicit tiers win, legacy booleans are the floor,
 * anything unrecognised degrades toward LESS power.
 */
export function resolveSupportTiers(
  permissions: SubAccountRelationship['permissions'] | null | undefined,
): Record<SupportTierCapability, SupportTier> {
  const resolved: Record<SupportTierCapability, SupportTier> = {
    activity: permissions?.can_view_activity ? 'assist' : 'none',
    listings: permissions?.can_manage_listings ? 'represent' : 'none',
    credits: permissions?.can_transact ? 'represent' : 'none',
  };
  const tiers = permissions?.tiers;
  if (tiers && typeof tiers === 'object') {
    for (const capability of ['activity', 'listings', 'credits'] as const) {
      const value = tiers[capability];
      if (value === 'none' || value === 'assist' || value === 'co_decide' || value === 'represent') {
        resolved[capability] = value;
      }
    }
  }
  return resolved;
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
