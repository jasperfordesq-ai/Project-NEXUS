// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin API client for AG58 Member Premium Tiers.
 */

import { api } from '@/lib/api';

export interface MemberPremiumTier {
  id: number;
  tenant_id: number;
  slug: string;
  name: string;
  description: string | null;
  monthly_price_cents: number;
  yearly_price_cents: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  stripe_price_account_id?: string | null;
  features: string[];
  sort_order: number;
  is_active: boolean;
  active_subscriber_count?: number;
}

export interface MemberSubscriberRow {
  id: number;
  user_id: number;
  tier_id: number;
  status: string;
  billing_interval: 'monthly' | 'yearly';
  current_period_end: string | null;
  canceled_at: string | null;
  grace_period_ends_at: string | null;
  created_at: string;
  tier_name: string;
  tier_slug: string;
  email: string | null;
  user_name: string | null;
  first_name: string | null;
}

export interface SubscriberListResponse {
  rows: MemberSubscriberRow[];
  total: number;
  page: number;
  per_page: number;
}

export interface TierUpsertPayload {
  slug: string;
  name: string;
  description?: string | null;
  monthly_price_cents: number;
  yearly_price_cents: number;
  features: string[];
  sort_order: number;
  is_active: boolean;
}

export interface DonationSupportSettings {
  stripe_connect_account_id: string;
  active_stripe_account_id?: string;
  payment_route: 'platform_default' | 'tenant_connect';
  configured_payment_route?: 'platform_default' | 'tenant_connect';
  fallback_reason?: string | null;
  account_status?: DonationSupportAccountStatus;
}

export interface DonationSupportAccountStatus {
  state: 'not_connected' | 'pending' | 'ready' | 'restricted' | 'unknown';
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: string[];
  disabled_reason: string | null;
  error: string | null;
}

export const memberPremiumAdminApi = {
  getSettings: () =>
    api.get<{ settings: DonationSupportSettings }>('/v2/admin/member-premium/settings'),

  updateSettings: (payload: { stripe_connect_account_id: string }) =>
    api.put<{ settings: DonationSupportSettings }>('/v2/admin/member-premium/settings', payload),

  createConnectOnboardingLink: (payload: { return_url: string; refresh_url: string }) =>
    api.post<{ settings: DonationSupportSettings; onboarding_url: string }>(
      '/v2/admin/member-premium/connect/onboarding',
      payload,
    ),

  /** One-time link into the community's own Stripe Express dashboard (payouts, balance). */
  createConnectDashboardLink: () =>
    api.post<{ dashboard_url: string }>('/v2/admin/member-premium/connect/dashboard-link', {}),

  listTiers: () =>
    api.get<{ tiers: MemberPremiumTier[] }>('/v2/admin/member-premium/tiers'),

  getTier: (id: number) =>
    api.get<{ tier: MemberPremiumTier }>(`/v2/admin/member-premium/tiers/${id}`),

  createTier: (payload: TierUpsertPayload) =>
    api.post<{ tier: MemberPremiumTier }>('/v2/admin/member-premium/tiers', payload),

  updateTier: (id: number, payload: Partial<TierUpsertPayload>) =>
    api.put<{ tier: MemberPremiumTier }>(`/v2/admin/member-premium/tiers/${id}`, payload),

  deleteTier: (id: number) =>
    api.delete<{ deleted: boolean }>(`/v2/admin/member-premium/tiers/${id}`),

  syncStripe: (id: number) =>
    api.post<{ tier: MemberPremiumTier }>(`/v2/admin/member-premium/tiers/${id}/sync-stripe`, {}),

  listSubscribers: (params: { page?: number; per_page?: number; status?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.per_page) qs.set('per_page', String(params.per_page));
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return api.get<SubscriberListResponse>(
      `/v2/admin/member-premium/subscribers${q ? `?${q}` : ''}`
    );
  },
};
