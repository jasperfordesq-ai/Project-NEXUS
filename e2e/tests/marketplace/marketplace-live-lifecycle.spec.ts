// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { expect, test, type APIRequestContext } from '@playwright/test';
import { completeTwoFactorIfChallenged } from '../../helpers/two-factor';
import {
  dismissBlockingModals,
  pinSpaApiToCandidate,
  tenantUrl,
} from '../../helpers/test-utils';

const API_BASE = (process.env.E2E_API_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const TENANT_SLUG = process.env.E2E_TENANT || 'hour-timebank';

interface ActorSession {
  token: string;
  userId: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function requiredCredential(name: 'E2E_USER_EMAIL' | 'E2E_USER_PASSWORD' | 'E2E_ADMIN_EMAIL' | 'E2E_ADMIN_PASSWORD'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live marketplace lifecycle.`);
  return value;
}

async function login(request: APIRequestContext, email: string, password: string): Promise<ActorSession> {
  const response = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password, tenant_slug: TENANT_SLUG },
    headers: {
      Accept: 'application/json',
      'X-Tenant-Slug': TENANT_SLUG,
    },
  });
  const raw = await response.json();
  expect(response.ok(), `Login failed for ${email}: ${JSON.stringify(raw)}`).toBeTruthy();
  // An administrator's login hands over a two-factor step since the MFA baseline.
  const body = await completeTwoFactorIfChallenged(raw, {
    request,
    apiBaseUrl: API_BASE,
    tenantSlug: TENANT_SLUG,
    email,
  }) as ApiEnvelope<{
    access_token?: string;
    user?: { id?: number };
  }> & {
    access_token?: string;
    user?: { id?: number };
  };
  const token = body.data?.access_token || body.access_token;
  const userId = Number(body.data?.user?.id || body.user?.id);
  if (!token || !Number.isInteger(userId) || userId <= 0) {
    throw new Error(`Incomplete login response for ${email}: ${JSON.stringify(body)}`);
  }
  return { token, userId };
}

async function api<T>(
  request: APIRequestContext,
  actor: ActorSession,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  data?: Record<string, unknown>,
): Promise<{ response: Awaited<ReturnType<APIRequestContext['get']>>; body: ApiEnvelope<T> }> {
  const response = await request[method](`${API_BASE}/api${path}`, {
    headers: {
      Authorization: `Bearer ${actor.token}`,
      Accept: 'application/json',
      'X-Tenant-Slug': TENANT_SLUG,
    },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json() as ApiEnvelope<T>;
  return { response, body };
}

test.describe('Marketplace live browser/backend lifecycle @marketplace @critical', () => {
  test.skip(
    process.env.E2E_MARKETPLACE_LIVE !== '1',
    'Set E2E_MARKETPLACE_LIVE=1 and use a disposable tenant with marketplace and community delivery enabled.',
  );
  test.setTimeout(120_000);

  test('settles, fulfils, disputes, and refunds one real time-credit order', async ({ page, request }) => {
    const buyer = await login(
      request,
      requiredCredential('E2E_USER_EMAIL'),
      requiredCredential('E2E_USER_PASSWORD'),
    );
    const sellerAdmin = await login(
      request,
      requiredCredential('E2E_ADMIN_EMAIL'),
      requiredCredential('E2E_ADMIN_PASSWORD'),
    );
    expect(buyer.userId).not.toBe(sellerAdmin.userId);

    const buyerWalletBefore = await api<{ balance: number }>(request, buyer, 'get', '/v2/wallet/balance');
    const sellerWalletBefore = await api<{ balance: number }>(request, sellerAdmin, 'get', '/v2/wallet/balance');
    expect(buyerWalletBefore.response.ok(), JSON.stringify(buyerWalletBefore.body)).toBeTruthy();
    expect(sellerWalletBefore.response.ok(), JSON.stringify(sellerWalletBefore.body)).toBeTruthy();
    const initialBuyerBalance = Number(buyerWalletBefore.body.data?.balance);
    const initialSellerBalance = Number(sellerWalletBefore.body.data?.balance);
    expect(initialBuyerBalance).toBeGreaterThanOrEqual(1);

    const title = `Marketplace live lifecycle ${Date.now()}`;
    let listingId: number | null = null;

    try {
      const created = await api<{ id: number }>(request, sellerAdmin, 'post', '/v2/marketplace/listings', {
        title,
        description: 'Disposable Playwright fixture proving the real marketplace lifecycle.',
        price: 0,
        price_currency: 'EUR',
        price_type: 'fixed',
        time_credit_price: 1,
        quantity: 1,
        inventory_count: 1,
        is_oversold_protected: true,
        shipping_available: false,
        local_pickup: false,
        delivery_method: 'community_delivery',
        seller_type: 'private',
        status: 'active',
      });
      expect(created.response.status(), JSON.stringify(created.body)).toBe(201);
      listingId = Number(created.body.data?.id);
      expect(listingId).toBeGreaterThan(0);

      const approved = await api(request, sellerAdmin, 'post', `/v2/admin/marketplace/listings/${listingId}/approve`);
      expect(approved.response.ok(), JSON.stringify(approved.body)).toBeTruthy();

      await pinSpaApiToCandidate(page);
      await page.addInitScript(() => {
        localStorage.setItem('dev_notice_dismissed', '2.1');
        localStorage.setItem('nexus_cookie_consent', JSON.stringify({
          essential: true,
          analytics: false,
          preferences: true,
          timestamp: new Date().toISOString(),
        }));
      });

      const orderResponsePromise = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/api/v2/marketplace/orders')
      ));
      await page.goto(tenantUrl(`marketplace/${listingId}`), { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /buy now for 1 tc/i }).click();

      const orderResponse = await orderResponsePromise;
      const orderBody = await orderResponse.json() as ApiEnvelope<{
        id: number;
        status: string;
        wallet_transaction_id?: number;
      }>;
      expect(orderResponse.status(), JSON.stringify(orderBody)).toBe(201);
      const orderId = Number(orderBody.data?.id);
      expect(orderId).toBeGreaterThan(0);
      expect(orderBody.data?.status).toBe('paid');
      expect(Number(orderBody.data?.wallet_transaction_id)).toBeGreaterThan(0);
      await expect(page.getByText(/order created/i).first()).toBeVisible();

      const buyerWalletPaid = await api<{ balance: number }>(request, buyer, 'get', '/v2/wallet/balance');
      const sellerWalletPaid = await api<{ balance: number }>(request, sellerAdmin, 'get', '/v2/wallet/balance');
      expect(Number(buyerWalletPaid.body.data?.balance)).toBeCloseTo(initialBuyerBalance - 1, 2);
      expect(Number(sellerWalletPaid.body.data?.balance)).toBeCloseTo(initialSellerBalance + 1, 2);

      const shipped = await api(request, sellerAdmin, 'put', `/v2/marketplace/orders/${orderId}/ship`, {
        tracking_number: `LIVE-${orderId}`,
        shipping_method: 'community_delivery',
      });
      expect(shipped.response.ok(), JSON.stringify(shipped.body)).toBeTruthy();

      const delivered = await api(request, buyer, 'put', `/v2/marketplace/orders/${orderId}/confirm-delivery`);
      expect(delivered.response.ok(), JSON.stringify(delivered.body)).toBeTruthy();

      const disputed = await api<{ id: number }>(request, buyer, 'post', `/v2/marketplace/orders/${orderId}/dispute`, {
        reason: 'not_as_described',
        description: 'Live lifecycle fixture: resolve this dispute to the buyer.',
      });
      expect(disputed.response.status(), JSON.stringify(disputed.body)).toBe(201);
      const disputeId = Number(disputed.body.data?.id);
      expect(disputeId).toBeGreaterThan(0);

      const resolved = await api(request, sellerAdmin, 'put', `/v2/admin/marketplace/disputes/${disputeId}/resolve`, {
        resolution: 'buyer',
        resolution_notes: 'Automated live lifecycle verification.',
      });
      expect(resolved.response.ok(), JSON.stringify(resolved.body)).toBeTruthy();

      const finalOrder = await api<{
        status: string;
        wallet_refund_transaction_id?: number;
      }>(request, buyer, 'get', `/v2/marketplace/orders/${orderId}`);
      expect(finalOrder.response.ok(), JSON.stringify(finalOrder.body)).toBeTruthy();
      expect(finalOrder.body.data?.status).toBe('refunded');
      expect(Number(finalOrder.body.data?.wallet_refund_transaction_id)).toBeGreaterThan(0);

      const buyerWalletRefunded = await api<{ balance: number }>(request, buyer, 'get', '/v2/wallet/balance');
      const sellerWalletRefunded = await api<{ balance: number }>(request, sellerAdmin, 'get', '/v2/wallet/balance');
      expect(Number(buyerWalletRefunded.body.data?.balance)).toBeCloseTo(initialBuyerBalance, 2);
      expect(Number(sellerWalletRefunded.body.data?.balance)).toBeCloseTo(initialSellerBalance, 2);

      const restoredListing = await api<{ inventory_count?: number }>(
        request,
        sellerAdmin,
        'get',
        `/v2/marketplace/listings/${listingId}`,
      );
      expect(restoredListing.response.ok(), JSON.stringify(restoredListing.body)).toBeTruthy();
      expect(restoredListing.body.data?.inventory_count).toBe(1);
    } finally {
      if (listingId !== null) {
        await api(request, sellerAdmin, 'delete', `/v2/admin/marketplace/listings/${listingId}`)
          .catch(() => undefined);
      }
    }
  });
});
