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
 * GET /v2/admin/billing/subscription: the community's plan record in force
 * and its card subscription, key for key
 * (StripeSubscriptionService::getSubscriptionDetails() plus
 * `has_card_subscription`; pinned by
 * tests/Laravel/Feature/Billing/CommunityBillingPageContractTest.php).
 * Null when the community has no plan record at all.
 */
export interface SubscriptionDetails {
  id: number;
  pay_plan_id: number;
  plan_name: string;
  plan_slug: string;
  plan_tier_level: number;
  plan_description: string | null;
  /** The record's own status. A failed card is recorded as `expired`. */
  status: 'active' | 'trial' | 'expired' | 'cancelled';
  /** Stripe's own word for the card subscription; null with no card, or nothing heard yet. */
  stripe_status: string | null;
  /** Null = not known (a plan given by hand, or an older subscription). */
  billing_interval: 'monthly' | 'yearly' | null;
  /** ISO 8601. */
  starts_at: string | null;
  /** ISO 8601: the end of the period the card subscription has paid for. */
  current_period_end: string | null;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
  /**
   * Whether Stripe still has a card subscription open for the community
   * (paying, on trial, or with a failed card). While it does, the server
   * refuses a checkout: it would start a second subscription beside the first.
   */
  has_card_subscription: boolean;
}

/**
 * GET /v2/admin/billing/standing, key for key
 * (AdminBillingController::getStanding(), pinned by BillingPausedFlagTest and
 * CommunityBillingPageContractTest).
 */
export interface OwnStanding {
  paused: boolean;
  own: boolean | null;
  since: string | null;
  payee: 'platform' | 'parent' | null;
  payee_name: string | null;
  payer: 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';
  /** YYYY-MM-DD: the date the community is paid up to. */
  paid_until: string | null;
  overdue_days: number | null;
  /** Active members against the plan's number; null with no plan or no limit. */
  member_limit: {
    used: number;
    max: number;
    percent: number;
    stage: 'approaching' | 'reached' | 'over' | null;
    /** The over-limit rule in force (`none` while the automatic checks are off). */
    rule: string;
    /** YYYY-MM-DD the rule would act, or null. */
    acts_on: string | null;
  } | null;
  /** The plan as it applies to this community, in the currency it is billed in. */
  plan: {
    name: string;
    description: string | null;
    max_users: number | null;
    price_monthly: number | null;
    price_yearly: number | null;
    setup_fee: number | null;
    currency: 'eur' | 'gbp';
    terms: 'default' | 'hub';
  } | null;
  /**
   * The reader is a manager of a community above, looking in. Every other
   * billing request from them is refused (403 VISITING_MANAGER_NO_BILLING):
   * a community's card and plan are its own admins' and the platform team's.
   */
  visiting?: boolean;
}

/**
 * A row of GET /v2/admin/billing/invoices, key for key
 * (StripeSubscriptionService::getInvoiceHistory(), pinned by
 * CommunityBillingPageContractTest).
 */
export interface Invoice {
  id: string;
  /** Stripe's invoice number; null on a draft that has none yet. */
  number: string | null;
  /** ISO 8601. */
  date: string | null;
  /** In the currency's main unit (euro, pounds), never cents. */
  amount: number;
  /** Upper-case ISO code. */
  currency: string;
  status: 'paid' | 'open' | 'draft' | 'void' | 'uncollectible' | string;
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

  /** The community's plan record and card subscription; `data` is null with no plan record. */
  getSubscription: () =>
    api.get<SubscriptionDetails | null>('/v2/admin/billing/subscription'),

  /** The plan as it applies, active members, who the community pays and its dates. */
  getStanding: () =>
    api.get<OwnStanding>('/v2/admin/billing/standing'),

  /** Create a Stripe Checkout session, returns a redirect URL (or activated:true for free plans) */
  createCheckout: (data: { plan_id: number; billing_interval: 'monthly' | 'yearly' }) =>
    api.post<{ checkout_url: string | null; activated?: boolean }>('/v2/admin/billing/checkout', data),

  /**
   * Change the plan (and, if given, the period) of the community's EXISTING
   * card subscription. Never a second subscription: see
   * AdminBillingController::changePlan().
   */
  changePlan: (data: { plan_id: number; billing_interval?: 'monthly' | 'yearly' }) =>
    api.post<{ plan_id: number; plan_name: string; billing_interval: 'monthly' | 'yearly' }>('/v2/admin/billing/change-plan', data),

  /** Create a Stripe Customer Portal session, returns a redirect URL */
  createPortal: () =>
    api.post<{ portal_url: string }>('/v2/admin/billing/portal'),

  /** List invoices for the current tenant */
  getInvoices: () =>
    api.get<Invoice[]>('/v2/admin/billing/invoices'),
};
