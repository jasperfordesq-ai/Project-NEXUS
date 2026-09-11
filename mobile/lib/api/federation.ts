// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface FederatedTenant {
  id: number | string;
  name: string;
  slug: string;
  description: string | null;
  logo: string | null;
  tagline?: string | null;
  member_count: number;
  location: string | null;
  website: string | null;
  connected_since: string;
  country?: string | null;
  federation_level?: number;
  federation_level_name?: string;
  permissions?: string[];
  partnership_since?: string;
  is_external?: boolean;
  external_partner_id?: number | string;
}

export interface FederationResponse {
  data: FederatedTenant[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface FederationStats {
  partner_count: number;
  federated_members: number;
  cross_community_exchanges: number;
  messages_count?: number;
  transactions_count?: number;
}

export interface FederationStatus {
  enabled: boolean;
  tenant_federation_enabled?: boolean;
  partnerships_count?: number;
  federation_optin?: boolean;
  messages_count?: number;
  transactions_count?: number;
}

export interface FederationActivityItem {
  id: number;
  type: 'message_received' | 'message_sent' | 'transaction_received' | 'transaction_sent' | 'partnership_approved' | 'member_joined';
  title: string;
  description: string;
  created_at: string;
  actor?: {
    id?: number;
    name: string;
    avatar?: string | null;
    tenant_name?: string;
  };
}

export interface FederatedMember {
  id: number | string;
  name?: string;
  first_name?: string;
  last_name?: string;
  avatar?: string | null;
  bio?: string | null;
  skills?: string[];
  location?: string | null;
  service_reach?: string | null;
  messaging_enabled?: boolean;
  transactions_enabled?: boolean;
  tenant_id?: number | string;
  tenant_name?: string;
  timebank?: {
    id: number | string;
    name: string;
  };
  is_external?: boolean;
  partner_name?: string;
  reputation_score?: number;
  reputation_count?: number;
}

export interface FederationMemberReview {
  id: number | string;
  rating: number;
  comment?: string | null;
  created_at: string;
  reviewer?: {
    id?: number | string | null;
    name?: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
    avatar_url?: string | null;
  } | null;
  partner?: {
    id?: number | string;
    name: string;
    slug?: string | null;
  } | null;
  verified?: boolean;
}

export interface FederationTransactionPayload {
  idempotency_key?: string;
  receiver_id: number | string;
  receiver_tenant_id: number | string;
  amount: number;
  description: string;
}

export interface FederationTransactionResponse {
  data?: {
    transaction_id?: number | string;
    status?: string;
    amount?: number;
  };
  success?: boolean;
  message?: string;
}

export interface FederatedListing {
  id: number | string;
  title: string;
  description?: string | null;
  type: 'offer' | 'request';
  category_name?: string | null;
  image_url?: string | null;
  estimated_hours?: number | null;
  location?: string | null;
  author?: {
    id: number | string;
    name: string;
    avatar?: string | null;
  };
  timebank?: {
    id: number | string;
    name: string;
  };
  created_at?: string;
  is_external?: boolean;
  partner_name?: string;
}

export interface FederatedGroup {
  id: number | string;
  name: string;
  description?: string | null;
  privacy?: string | null;
  member_count: number;
  cover_image?: string | null;
  timebank?: {
    id: number | string;
    name: string;
  };
  created_at?: string;
  external_partner_id?: number;
  partner_name?: string;
  is_external?: boolean;
}

export interface FederatedEvent {
  id: number | string;
  title: string;
  description?: string | null;
  start_date: string;
  end_date?: string | null;
  location?: string | null;
  is_online?: boolean;
  online_url?: string | null;
  cover_image?: string | null;
  attendees_count?: number;
  max_attendees?: number | null;
  organizer?: {
    id: number | string;
    name: string;
    avatar?: string | null;
  };
  timebank?: {
    id: number | string;
    name: string;
  };
  created_at?: string;
}

export interface FederatedMessage {
  id: number | string;
  subject?: string | null;
  body: string;
  direction: 'inbound' | 'outbound';
  status?: 'unread' | 'delivered' | 'read';
  read_at?: string | null;
  created_at: string;
  sender?: {
    id: number | string;
    name: string;
    avatar?: string | null;
    tenant_id?: number | string;
    tenant_name?: string;
  };
  receiver?: {
    id: number | string;
    name: string;
    avatar?: string | null;
    tenant_id?: number | string;
    tenant_name?: string;
  };
  is_external?: boolean;
  external_partner_id?: number | string;
}

export interface FederationSettings {
  federation_optin?: boolean;
  profile_visible_federated?: boolean;
  appear_in_federated_search?: boolean;
  show_skills_federated?: boolean;
  show_location_federated?: boolean;
  show_reviews_federated?: boolean;
  messaging_enabled_federated?: boolean;
  transactions_enabled_federated?: boolean;
  email_notifications?: boolean;
  service_reach?: 'local_only' | 'remote_ok' | 'travel_ok';
  travel_radius_km?: number;
}

export interface FederationPagedResponse<T> {
  data: T[];
  meta?: {
    cursor?: string | null;
    next_cursor?: string | null;
    has_more?: boolean;
    total_items?: number;
  };
}

/**
 * GET /api/v2/federation/partners — paginated list of federated partner communities.
 */
export function getFederationPartners(cursor?: string | null): Promise<FederationResponse> {
  const params: Record<string, string> = {};
  if (cursor) params['cursor'] = cursor;
  return api.get<FederationResponse>(`${API_V2}/federation/partners`, params);
}

/**
 * GET /api/v2/federation/status — aggregate stats for the current tenant's federation.
 */
export async function getFederationStats(): Promise<{ data: FederationStats }> {
  const response = await api.get<{ data: FederationStatus }>(`${API_V2}/federation/status`);
  const status = response.data;

  return {
    data: {
      partner_count: status.partnerships_count ?? 0,
      federated_members: 0,
      cross_community_exchanges: status.transactions_count ?? 0,
      messages_count: status.messages_count ?? 0,
      transactions_count: status.transactions_count ?? 0,
    },
  };
}

export function getFederationStatus(): Promise<{ data: FederationStatus }> {
  return api.get<{ data: FederationStatus }>(`${API_V2}/federation/status`);
}

export function getFederationActivity(): Promise<{ data: FederationActivityItem[] }> {
  return api.get<{ data: FederationActivityItem[] }>(`${API_V2}/federation/activity`);
}

/**
 * GET /api/v2/federation/partners/{id} — detail for a single federated partner.
 */
export function getFederationPartner(id: number | string): Promise<{ data: FederatedTenant }> {
  return api.get<{ data: FederatedTenant }>(`${API_V2}/federation/partners/${id}`);
}

export function getFederationMembers(params: Record<string, string> = {}): Promise<FederationPagedResponse<FederatedMember>> {
  return api.get<FederationPagedResponse<FederatedMember>>(`${API_V2}/federation/members`, params);
}

export function getFederationMember(id: number | string, tenantId?: number | string): Promise<{ data: FederatedMember }> {
  const params: Record<string, string> = {};
  if (tenantId !== undefined && tenantId !== null && String(tenantId).trim() !== '') {
    params.tenant_id = String(tenantId);
  }
  return api.get<{ data: FederatedMember }>(`${API_V2}/federation/members/${id}`, params);
}

export function getFederationMemberReviews(id: number | string, tenantId?: number | string): Promise<{ data: FederationMemberReview[] }> {
  const params: Record<string, string> = {};
  if (tenantId !== undefined && tenantId !== null && String(tenantId).trim() !== '') {
    params.tenant_id = String(tenantId);
  }
  return api.get<{ data: FederationMemberReview[] }>(`${API_V2}/federation/members/${id}/reviews`, params);
}

export function getFederationListings(params: Record<string, string> = {}): Promise<FederationPagedResponse<FederatedListing>> {
  return api.get<FederationPagedResponse<FederatedListing>>(`${API_V2}/federation/listings`, params);
}

export function getFederationGroups(params: Record<string, string> = {}): Promise<FederationPagedResponse<FederatedGroup>> {
  return api.get<FederationPagedResponse<FederatedGroup>>(`${API_V2}/federation/groups`, params);
}

export function getFederationEvents(params: Record<string, string> = {}): Promise<FederationPagedResponse<FederatedEvent>> {
  return api.get<FederationPagedResponse<FederatedEvent>>(`${API_V2}/federation/events`, params);
}

export function getFederationMessages(): Promise<{ data: FederatedMessage[] } | FederatedMessage[]> {
  return api.get<{ data: FederatedMessage[] } | FederatedMessage[]>(`${API_V2}/federation/messages`);
}

export function sendFederationMessage(payload: {
  receiver_id: number | string;
  receiver_tenant_id: number | string;
  subject?: string;
  body: string;
  reference_message_id?: number | string | null;
}): Promise<{ data: FederatedMessage }> {
  return api.post<{ data: FederatedMessage }>(`${API_V2}/federation/messages`, payload);
}

export function sendFederationTransaction(payload: FederationTransactionPayload): Promise<FederationTransactionResponse> {
  return api.post<FederationTransactionResponse>(`${API_V2}/federation/transactions`, payload);
}

export function optInFederation(): Promise<{ success?: boolean; data?: unknown }> {
  return api.post<{ success?: boolean; data?: unknown }>(`${API_V2}/federation/opt-in`, {});
}

export function optOutFederation(): Promise<{ success?: boolean; data?: unknown }> {
  return api.post<{ success?: boolean; data?: unknown }>(`${API_V2}/federation/opt-out`, {});
}

export function markFederationMessageRead(id: number | string): Promise<{ data?: unknown }> {
  return api.post<{ data?: unknown }>(`${API_V2}/federation/messages/${id}/mark-read`, {});
}

export function markFederationMessagesReadBatch(ids: (number | string)[]): Promise<{ data?: { updated?: number } }> {
  return api.post<{ data?: { updated?: number } }>(`${API_V2}/federation/messages/mark-read-batch`, { ids });
}

export function translateFederationMessage(id: number | string, targetLanguage: string): Promise<{ data?: { translated_text?: string } } | { translated_text?: string }> {
  return api.post<{ data?: { translated_text?: string } } | { translated_text?: string }>(`${API_V2}/federation/messages/${id}/translate`, {
    target_language: targetLanguage,
  });
}

export function getFederationSettings(): Promise<{ data: { settings: FederationSettings; enabled: boolean } } | { settings: FederationSettings; enabled: boolean }> {
  return api.get<{ data: { settings: FederationSettings; enabled: boolean } } | { settings: FederationSettings; enabled: boolean }>(`${API_V2}/federation/settings`);
}

export function updateFederationSettings(settings: FederationSettings): Promise<{ success?: boolean; data?: unknown }> {
  return api.put<{ success?: boolean; data?: unknown }>(`${API_V2}/federation/settings`, settings);
}

export function setupFederation(settings: FederationSettings): Promise<{ success?: boolean; data?: unknown }> {
  return api.post<{ success?: boolean; data?: unknown }>(`${API_V2}/federation/setup`, settings);
}

export interface FederatedConnectionStatus {
  status: 'none' | 'pending' | 'accepted' | 'rejected';
  connection_id: number | null;
  direction?: 'incoming' | 'outgoing' | null;
}

export interface FederationConnection {
  id: number;
  user_id: number;
  name: string;
  avatar_url?: string | null;
  tenant_id: number;
  tenant_name: string;
  status: 'pending' | 'accepted' | 'rejected';
  message?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export function getFederationConnections(status: 'accepted' | 'pending_received' | 'pending_sent'): Promise<{ data: FederationConnection[] } | FederationConnection[]> {
  return api.get<{ data: FederationConnection[] } | FederationConnection[]>(`${API_V2}/federation/connections`, { status });
}

export function acceptFederationConnection(id: number | string): Promise<{ data?: unknown; success?: boolean }> {
  return api.post<{ data?: unknown; success?: boolean }>(`${API_V2}/federation/connections/${id}/accept`, {});
}

export function rejectFederationConnection(id: number | string): Promise<{ data?: unknown; success?: boolean }> {
  return api.post<{ data?: unknown; success?: boolean }>(`${API_V2}/federation/connections/${id}/reject`, {});
}

export function removeFederationConnection(id: number | string): Promise<{ data?: unknown; success?: boolean }> {
  return api.delete<{ data?: unknown; success?: boolean }>(`${API_V2}/federation/connections/${id}`);
}

export function getFederationConnectionStatus(userId: number | string, tenantId: number | string): Promise<{ data: FederatedConnectionStatus }> {
  return api.get<{ data: FederatedConnectionStatus }>(`${API_V2}/federation/connections/status/${userId}/${tenantId}`);
}

export function sendFederationConnectionRequest(userId: number | string, tenantId: number | string): Promise<{ data: { success?: boolean; connection_id?: number } }> {
  return api.post<{ data: { success?: boolean; connection_id?: number } }>(`${API_V2}/federation/connections`, {
    receiver_id: Number(userId),
    receiver_tenant_id: Number(tenantId),
  });
}
