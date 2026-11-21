// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { billingApi } from './billingApi';
import type { Plan, SubscriptionDetails, Invoice } from './billingApi';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockPlan: Plan = {
  id: 1,
  name: 'Community',
  slug: 'community',
  description: 'Free tier',
  tier_level: 1,
  price_monthly: 0,
  price_yearly: 0,
  setup_fee: 0,
  price_monthly_gbp: null,
  price_yearly_gbp: null,
  setup_fee_gbp: null,
  max_users: 1000,
  max_communities: 3,
  storage_gb: 25,
  emails_per_month: 50000,
  features: ['basic_listings', 'wallet'],
  is_active: 1,
  charge: {
    monthly: { currency: 'eur', amount: 0, setup_fee: 0 },
    yearly: { currency: 'eur', amount: 0, setup_fee: 0 },
  },
};

const mockSubscription: SubscriptionDetails = {
  id: 42,
  pay_plan_id: 2,
  plan_name: 'Pro',
  plan_tier_level: 2,
  status: 'active',
  billing_interval: 'monthly',
  current_period_start: '2026-06-01T00:00:00Z',
  current_period_end: '2026-07-01T00:00:00Z',
  trial_ends_at: null,
  cancel_at_period_end: false,
  stripe_subscription_id: 'sub_abc123',
};

const mockInvoice: Invoice = {
  id: 'in_001',
  number: 'INV-001',
  date: '2026-06-01',
  amount: 2900,
  currency: 'usd',
  status: 'paid',
  hosted_invoice_url: 'https://invoice.stripe.com/i/acct_abc/test_001',
  invoice_pdf: 'https://invoice.stripe.com/i/acct_abc/test_001/pdf',
};

describe('billingApi', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  // ── getPlans ──────────────────────────────────────────────────────────────

  describe('getPlans', () => {
    it('calls the public plans endpoint', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([mockPlan]);

      const result = await billingApi.getPlans();

      expect(api.get).toHaveBeenCalledWith('/v2/billing/plans');
      expect(result).toEqual([mockPlan]);
    });

    it('returns an empty array when backend returns []', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([]);

      const result = await billingApi.getPlans();

      expect(result).toEqual([]);
    });

    it('propagates errors thrown by the api client', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

      await expect(billingApi.getPlans()).rejects.toThrow('Network error');
    });

    it('returns multiple plans', async () => {
      const plans = [mockPlan, { ...mockPlan, id: 2, name: 'Pro', slug: 'pro', tier_level: 2 }];
      vi.mocked(api.get).mockResolvedValueOnce(plans);

      const result = await billingApi.getPlans();

      expect(result).toHaveLength(2);
      expect(result[1].name).toBe('Pro');
    });
  });

  // ── getSubscription ───────────────────────────────────────────────────────

  describe('getSubscription', () => {
    it('calls the admin subscription endpoint', async () => {
      vi.mocked(api.get).mockResolvedValueOnce(mockSubscription);

      const result = await billingApi.getSubscription();

      expect(api.get).toHaveBeenCalledWith('/v2/admin/billing/subscription');
      expect(result).toEqual(mockSubscription);
    });

    it('returns a subscription with trialing status', async () => {
      const trialing: SubscriptionDetails = {
        ...mockSubscription,
        status: 'trialing',
        trial_ends_at: '2026-07-14T00:00:00Z',
      };
      vi.mocked(api.get).mockResolvedValueOnce(trialing);

      const result = await billingApi.getSubscription();

      expect(result.status).toBe('trialing');
      expect(result.trial_ends_at).toBe('2026-07-14T00:00:00Z');
    });

    it('returns a cancelled subscription with null stripe id', async () => {
      const cancelled: SubscriptionDetails = {
        ...mockSubscription,
        status: 'cancelled',
        stripe_subscription_id: null,
        cancel_at_period_end: true,
      };
      vi.mocked(api.get).mockResolvedValueOnce(cancelled);

      const result = await billingApi.getSubscription();

      expect(result.status).toBe('cancelled');
      expect(result.stripe_subscription_id).toBeNull();
      expect(result.cancel_at_period_end).toBe(true);
    });

    it('propagates errors', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Unauthorized'));

      await expect(billingApi.getSubscription()).rejects.toThrow('Unauthorized');
    });
  });

  // ── createCheckout ────────────────────────────────────────────────────────

  describe('createCheckout', () => {
    it('posts plan_id and billing_interval to the checkout endpoint', async () => {
      const response = { checkout_url: 'https://checkout.stripe.com/pay/cs_test_abc' };
      vi.mocked(api.post).mockResolvedValueOnce(response);

      const result = await billingApi.createCheckout({ plan_id: 3, billing_interval: 'monthly' });

      expect(api.post).toHaveBeenCalledWith('/v2/admin/billing/checkout', {
        plan_id: 3,
        billing_interval: 'monthly',
      });
      expect(result).toEqual(response);
    });

    it('posts with yearly billing interval', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ checkout_url: 'https://checkout.stripe.com/pay/cs_yearly' });

      await billingApi.createCheckout({ plan_id: 1, billing_interval: 'yearly' });

      expect(api.post).toHaveBeenCalledWith('/v2/admin/billing/checkout', {
        plan_id: 1,
        billing_interval: 'yearly',
      });
    });

    it('returns activated:true and null checkout_url for free plan activation', async () => {
      const freeResponse = { checkout_url: null, activated: true };
      vi.mocked(api.post).mockResolvedValueOnce(freeResponse);

      const result = await billingApi.createCheckout({ plan_id: 1, billing_interval: 'monthly' });

      expect(result.activated).toBe(true);
      expect(result.checkout_url).toBeNull();
    });

    it('propagates errors', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Payment failed'));

      await expect(billingApi.createCheckout({ plan_id: 2, billing_interval: 'monthly' }))
        .rejects.toThrow('Payment failed');
    });
  });

  // ── createPortal ──────────────────────────────────────────────────────────

  describe('createPortal', () => {
    it('posts to the portal endpoint with no body and returns a portal_url', async () => {
      const response = { portal_url: 'https://billing.stripe.com/session/bps_test_abc' };
      vi.mocked(api.post).mockResolvedValueOnce(response);

      const result = await billingApi.createPortal();

      expect(api.post).toHaveBeenCalledWith('/v2/admin/billing/portal');
      expect(result.portal_url).toBe('https://billing.stripe.com/session/bps_test_abc');
    });

    it('propagates errors', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('No Stripe customer'));

      await expect(billingApi.createPortal()).rejects.toThrow('No Stripe customer');
    });
  });

  // ── getInvoices ───────────────────────────────────────────────────────────

  describe('getInvoices', () => {
    it('calls the invoices endpoint and returns the list', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([mockInvoice]);

      const result = await billingApi.getInvoices();

      expect(api.get).toHaveBeenCalledWith('/v2/admin/billing/invoices');
      expect(result).toEqual([mockInvoice]);
    });

    it('returns an empty array when no invoices exist', async () => {
      vi.mocked(api.get).mockResolvedValueOnce([]);

      const result = await billingApi.getInvoices();

      expect(result).toEqual([]);
    });

    it('handles invoice with null pdf / url', async () => {
      const draftInvoice: Invoice = {
        ...mockInvoice,
        id: 'in_draft',
        status: 'draft',
        hosted_invoice_url: null,
        invoice_pdf: null,
      };
      vi.mocked(api.get).mockResolvedValueOnce([draftInvoice]);

      const result = await billingApi.getInvoices();

      expect(result[0].hosted_invoice_url).toBeNull();
      expect(result[0].invoice_pdf).toBeNull();
      expect(result[0].status).toBe('draft');
    });

    it('returns multiple invoices', async () => {
      const invoices = [mockInvoice, { ...mockInvoice, id: 'in_002', number: 'INV-002' }];
      vi.mocked(api.get).mockResolvedValueOnce(invoices);

      const result = await billingApi.getInvoices();

      expect(result).toHaveLength(2);
    });

    it('propagates errors', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('Forbidden'));

      await expect(billingApi.getInvoices()).rejects.toThrow('Forbidden');
    });
  });
});
