// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Billing API Client
 * Stripe billing endpoints for subscription management.
 */

import { api } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** What card checkout would charge this community for one billing period. */
export interface PlanCharge {
  /** The currency the community is billed in for this period. */
  currency: 'eur' | 'gbp';
  amount: number;
  /** The plan's one-off setup fee in that currency. Quoted, not taken by card. */
  setup_fee: number;
}

/**
 * A row of GET /v2/billing/plans, key for key
 * (AdminBillingController::getPlansPublic, pinned by
 * tests/Laravel/Feature/Billing/PublicPlansContractTest.php).
 */
export interface Plan {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  tier_level: number;
  /** Euro. */
  price_monthly: number;
  price_yearly: number;
  setup_fee: number;
  /** Pounds; null = not sold in pounds. */
  price_monthly_gbp: number | null;
  price_yearly_gbp: number | null;
  setup_fee_gbp: number | null;
  /** Active members allowed; null = no limit. */
  max_users: number | null;
  max_communities: number | null;
  storage_gb: number | null;
  emails_per_month: number | null;
  features: string[];
  is_active: boolean | number;
  charge: { monthly: PlanCharge; yearly: PlanCharge };
}

/**
 * GET /v2/admin/billing/subscription: the community's latest assignment
 * (StripeSubscriptionService::getSubscriptionDetails). The server names the
 * plan `pay_plan_id`; `plan_id` was this screen's own invention and never
 * arrived, which is why no plan was ever marked as the current one.
 */
export interface SubscriptionDetails {
  id: number;
  pay_plan_id: number;
  /** @deprecated never sent by the server; kept so old fixtures still type-check. */
  plan_id?: number;
  plan_name: string;
  plan_tier_level: number;
  status: 'active' | 'trial' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'incomplete';
  billing_interval: 'monthly' | 'yearly';
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  /**
   * Whether Stripe still has a card subscription open for the community
   * (paying, on trial, or with a failed card). While it does, the server
   * refuses a checkout: it would start a second subscription beside the first.
   */
  has_card_subscription?: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  currency: string;
  status: 'paid' | 'open' | 'draft' | 'void' | 'uncollectible';
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export const billingApi = {
  /** Fetch active plans with prices (public) */
  getPlans: () =>
    api.get<Plan[]>('/v2/billing/plans'),

  /** Get current tenant subscription details */
  getSubscription: () =>
    api.get<SubscriptionDetails>('/v2/admin/billing/subscription'),

  /** Create a Stripe Checkout session, returns a redirect URL (or activated:true for free plans) */
  createCheckout: (data: { plan_id: number; billing_interval: 'monthly' | 'yearly' }) =>
    api.post<{ checkout_url: string | null; activated?: boolean }>('/v2/admin/billing/checkout', data),

  /** Create a Stripe Customer Portal session, returns a redirect URL */
  createPortal: () =>
    api.post<{ portal_url: string }>('/v2/admin/billing/portal'),

  /** List invoices for the current tenant */
  getInvoices: () =>
    api.get<Invoice[]>('/v2/admin/billing/invoices'),
};
