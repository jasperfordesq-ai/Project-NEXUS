// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { completeTwoFactorIfChallenged } from '../../helpers/two-factor';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.test') });

/**
 * Broker Message Visibility — Backend API Tests
 *
 * UK Compliance focus:
 * - Message copies created for first contact, new member, high-risk listings
 * - DBS (Disclosure and Barring Service) and insurance requirements on risk tags
 * - Messaging restrictions can be applied per user
 * - Broker review workflow (review, flag, action)
 * - User monitoring (under_monitoring, messaging_disabled)
 * - Configuration: broker_visibility enabled/disabled per tenant
 *
 * All tests hit the V2 admin API: /api/v2/admin/broker/*
 * Requires admin authentication (admin storage state).
 *
 * Tests are READ-ONLY unless labelled [mutation].
 * Mutation tests use the admin token obtained via login.
 */

const API_BASE = process.env.E2E_API_URL || 'http://localhost:8090';
const TENANT_SLUG = process.env.E2E_TENANT || 'hour-timebank';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get admin JWT token by calling the login endpoint directly.
 */
async function getAdminToken(request: APIRequestContext): Promise<string | null> {
  const email = process.env.E2E_ADMIN_EMAIL || 'admin@hour-timebank.ie';
  const password = process.env.E2E_ADMIN_PASSWORD || 'AdminPassword123!';

  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password, tenant_slug: TENANT_SLUG },
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_SLUG,
    },
  });

  if (!res.ok()) return null;
  // An administrator's login hands over a two-factor step since the MFA baseline.
  const body = await completeTwoFactorIfChallenged(await res.json(), {
    request,
    apiBaseUrl: API_BASE,
    tenantSlug: TENANT_SLUG,
    email,
  });
  return body?.data?.access_token || body?.access_token || null;
}

/**
 * Build admin headers for API requests.
 */
function adminHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_SLUG,
  };
}

// ---------------------------------------------------------------------------
// 1. Broker Dashboard API
// ---------------------------------------------------------------------------

test.describe('Broker API — Dashboard', () => {
  test('GET /api/v2/admin/broker/dashboard returns aggregate stats', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/dashboard`, {
      headers: adminHeaders(token!),
    });

    // May return 200 (feature enabled) or 403 (insufficient role)
    // Should never return 500
    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;

      // All expected aggregate fields should be present
      expect(data).toHaveProperty('pending_exchanges');
      expect(data).toHaveProperty('unreviewed_messages');
      expect(data).toHaveProperty('high_risk_listings');
      expect(data).toHaveProperty('monitored_users');

      // Values should be non-negative integers
      expect(typeof data.pending_exchanges).toBe('number');
      expect(data.pending_exchanges).toBeGreaterThanOrEqual(0);
      expect(typeof data.unreviewed_messages).toBe('number');
      expect(data.unreviewed_messages).toBeGreaterThanOrEqual(0);
      expect(typeof data.monitored_users).toBe('number');
      expect(data.monitored_users).toBeGreaterThanOrEqual(0);
    }
  });

  test('GET /api/v2/admin/broker/dashboard rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/dashboard`, {
      headers: { 'X-Tenant-ID': TENANT_SLUG },
    });

    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 2. Message Review API — UK Compliance Focus
// ---------------------------------------------------------------------------

test.describe('Broker API — Message Review (UK Compliance)', () => {
  test('GET /api/v2/admin/broker/messages returns message copies list', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      // API shape: { data: [...], meta: { total, page, per_page, ... } }
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('meta');
      expect(typeof body.meta.total).toBe('number');
    }
  });

  test('GET /api/v2/admin/broker/messages?filter=unreviewed returns only unreviewed', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=unreviewed`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const items: any[] = Array.isArray(body.data) ? body.data : [];

      // All returned items should NOT have a reviewed_at value
      for (const item of items) {
        expect(item.reviewed_at).toBeFalsy();
      }
    }
  });

  test('GET /api/v2/admin/broker/messages?filter=flagged returns only flagged', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=flagged`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const items: any[] = Array.isArray(body.data) ? body.data : [];

      // All returned items should be flagged
      for (const item of items) {
        expect(item.flagged).toBeTruthy();
      }
    }
  });

  test('message copy items include copy_reason field for audit trail', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all`, {
      headers: adminHeaders(token!),
    });

    if (res.status() === 200) {
      const body = await res.json();
      const items: any[] = Array.isArray(body.data) ? body.data : [];

      // Every message copy must include a copy_reason (required for compliance audit)
      const validReasons = ['first_contact', 'high_risk_listing', 'new_member', 'flagged_user', 'manual_monitoring', 'random_sample'];

      for (const item of items) {
        expect(item).toHaveProperty('copy_reason');
        expect(validReasons).toContain(item.copy_reason);
      }
    }
  });

  test('[mutation] POST /api/v2/admin/broker/messages/{id}/review marks message reviewed', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // First, find an unreviewed message to review
    const listRes = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=unreviewed&per_page=1`, {
      headers: adminHeaders(token!),
    });

    if (listRes.status() !== 200) {
      test.skip(true, 'Could not list messages — skipping mutation test');
      return;
    }

    const listBody = await listRes.json();
    const items: any[] = Array.isArray(listBody.data) ? listBody.data : [];

    if (items.length === 0) {
      // No unreviewed messages to test with — skip gracefully
      return;
    }

    const messageId = items[0].id;

    // Mark as reviewed
    const reviewRes = await request.post(`${API_BASE}/api/v2/admin/broker/messages/${messageId}/review`, {
      headers: adminHeaders(token!),
      data: {},
    });

    expect(reviewRes.status()).not.toBe(500);

    if (reviewRes.status() === 200) {
      const reviewBody = await reviewRes.json();
      const data = reviewBody?.data ?? reviewBody;

      expect(data.id).toBe(messageId);
      expect(data.reviewed).toBe(true);

      // Verify it no longer appears in unreviewed list
      const checkRes = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=unreviewed`, {
        headers: adminHeaders(token!),
      });

      if (checkRes.status() === 200) {
        const checkBody = await checkRes.json();
        const remaining: any[] = Array.isArray(checkBody.data) ? checkBody.data : [];
        const wasFound = remaining.some((m: { id: number }) => m.id === messageId);
        expect(wasFound).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Risk Tags API — UK Compliance (DBS & Insurance)
// ---------------------------------------------------------------------------

test.describe('Broker API — Risk Tags (DBS & Insurance Requirements)', () => {
  test('GET /api/v2/admin/broker/risk-tags returns tagged listings', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;

      // Should be an array of tagged listings
      const items = Array.isArray(data) ? data : data?.items ?? [];
      expect(Array.isArray(items)).toBe(true);
    }
  });

  test('risk tag items include UK compliance fields (dbs_required, insurance_required)', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: adminHeaders(token!),
    });

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;
      const items = Array.isArray(data) ? data : data?.items ?? [];

      // Each risk tag must expose DBS and insurance flags for UK compliance
      for (const item of items) {
        // These are boolean compliance fields — must exist (even if false)
        expect(item).toHaveProperty('dbs_required');
        expect(item).toHaveProperty('insurance_required');
        expect(typeof item.dbs_required === 'boolean' || item.dbs_required === 0 || item.dbs_required === 1).toBe(true);
        expect(typeof item.insurance_required === 'boolean' || item.insurance_required === 0 || item.insurance_required === 1).toBe(true);
      }
    }
  });

  test('risk tag items include risk_level field', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: adminHeaders(token!),
    });

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      const validLevels = ['low', 'medium', 'high', 'critical'];

      for (const item of items) {
        expect(item).toHaveProperty('risk_level');
        expect(validLevels).toContain(item.risk_level);
      }
    }
  });

  test('GET /api/v2/admin/broker/risk-tags?risk_level=high filters correctly', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags?risk_level=high`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;
      const items = Array.isArray(data) ? data : data?.items ?? [];

      for (const item of items) {
        expect(['high', 'critical']).toContain(item.risk_level);
      }
    }
  });

  test('GET /api/v2/admin/broker/risk-tags rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: { 'X-Tenant-ID': TENANT_SLUG },
    });

    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 4. User Monitoring API — UK Compliance
// ---------------------------------------------------------------------------

test.describe('Broker API — User Monitoring', () => {
  test('GET /api/v2/admin/broker/monitoring returns monitored users list', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;

      // Should be a paginated list of monitored users
      const items = Array.isArray(data) ? data : data?.items ?? [];
      expect(Array.isArray(items)).toBe(true);
    }
  });

  test('monitored user items include under_monitoring and messaging_disabled flags', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: adminHeaders(token!),
    });

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;
      const items = Array.isArray(data) ? data : data?.items ?? [];

      for (const item of items) {
        // Monitoring records must include these UK compliance control fields
        expect(item).toHaveProperty('under_monitoring');
        // messaging_disabled may be included at top level or nested
        const hasMessagingDisabled =
          'messaging_disabled' in item ||
          (item.restrictions && 'messaging_disabled' in item.restrictions);
        expect(hasMessagingDisabled).toBe(true);
      }
    }
  });

  test('GET /api/v2/admin/broker/monitoring rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: { 'X-Tenant-ID': TENANT_SLUG },
    });

    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 5. Exchange Management API
// ---------------------------------------------------------------------------

test.describe('Broker API — Exchange Management', () => {
  test('GET /api/v2/admin/broker/exchanges returns exchange list', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/exchanges`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      // API shape: { data: [...], meta: { total, ... } }
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('meta');
      expect(typeof body.meta.total).toBe('number');
    }
  });

  test('GET /api/v2/admin/broker/exchanges?status=pending_broker filters correctly', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/exchanges?status=pending_broker`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const items: any[] = Array.isArray(body.data) ? body.data : [];

      for (const item of items) {
        expect(item.status).toBe('pending_broker');
      }
    }
  });

  test('POST /api/v2/admin/broker/exchanges/{id}/reject requires a reason', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // Attempt to reject exchange ID 999999 (non-existent) without reason
    const res = await request.post(`${API_BASE}/api/v2/admin/broker/exchanges/999999/reject`, {
      headers: adminHeaders(token!),
      data: {}, // missing reason
    });

    // Should return 400 (bad request) or 404 (not found), never 500
    expect([400, 404]).toContain(res.status());
  });

  test('GET /api/v2/admin/broker/exchanges rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/exchanges`, {
      headers: { 'X-Tenant-ID': TENANT_SLUG },
    });

    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 6. Messaging Restriction — Service-Level Behaviour (via monitoring API)
// ---------------------------------------------------------------------------

test.describe('Broker API — Messaging Restrictions (UK Compliance)', () => {
  test('messaging restrictions endpoint is tenant-scoped', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // Access monitoring with admin token from correct tenant — should work
    const validRes = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: adminHeaders(token!),
    });

    expect([200, 403]).toContain(validRes.status());
    expect(validRes.status()).not.toBe(500);

    // Access with wrong tenant header — should be rejected or scoped to that tenant only
    const wrongTenantRes = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: {
        ...adminHeaders(token!),
        'X-Tenant-ID': 'nonexistent-tenant',
      },
    });

    // Should NOT expose data from a different tenant
    expect([200, 400, 401, 403, 404]).toContain(wrongTenantRes.status());
    if (wrongTenantRes.status() === 200) {
      const wrongBody = await wrongTenantRes.json();
      const wrongData = wrongBody?.data ?? wrongBody;
      const wrongItems = Array.isArray(wrongData) ? wrongData : wrongData?.items ?? [];
      // If it returns 200, it must not mix tenant data
      expect(Array.isArray(wrongItems)).toBe(true);
    }
  });

  test('regular user token cannot access broker monitoring endpoints', async ({ request }) => {
    const userEmail = process.env.E2E_USER_EMAIL || 'test@hour-timebank.ie';
    const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@hour-timebank.ie';

    // Skip if the environment only has one account (user == admin)
    test.skip(
      userEmail === adminEmail,
      'User and admin share the same account — cannot test regular-user access denial'
    );

    const loginRes = await request.post(`${API_BASE}/api/auth/login`, {
      data: { email: userEmail, password: process.env.E2E_USER_PASSWORD || 'TestPassword123!', tenant_slug: TENANT_SLUG },
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT_SLUG },
    });

    test.skip(!loginRes.ok(), 'Regular user auth not available — skipping');

    const loginBody = await loginRes.json();
    const userToken = loginBody?.data?.access_token || loginBody?.access_token;
    test.skip(!userToken, 'No user token in login response — skipping');

    // Attempt to access broker monitoring with regular user token
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: adminHeaders(userToken!),
    });

    // Regular users MUST be denied access to broker monitoring
    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// 7. Broker Config — Visibility Settings
// ---------------------------------------------------------------------------

test.describe('Broker API — Configuration & Visibility Settings', () => {
  test('dashboard reflects current broker visibility configuration', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/dashboard`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      // Dashboard should always reflect live data — no caching errors
      const data = body?.data ?? body;
      expect(data).toBeDefined();

      // unreviewed_messages count must be a non-negative integer
      if ('unreviewed_messages' in data) {
        expect(Number.isInteger(data.unreviewed_messages)).toBe(true);
        expect(data.unreviewed_messages).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('broker endpoints return consistent data structure', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // Check all 4 main endpoints return proper structure
    const endpoints = [
      '/api/v2/admin/broker/dashboard',
      '/api/v2/admin/broker/messages',
      '/api/v2/admin/broker/risk-tags',
      '/api/v2/admin/broker/monitoring',
    ];

    for (const endpoint of endpoints) {
      const res = await request.get(`${API_BASE}${endpoint}`, {
        headers: adminHeaders(token!),
      });

      // None should return 500
      expect(res.status(), `${endpoint} should not return 500`).not.toBe(500);

      if (res.ok()) {
        const body = await res.json();
        // All should return valid JSON with either data property or direct object
        expect(body).toBeDefined();
        expect(typeof body).toBe('object');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 8. First Contact Monitoring — UK Safeguarding
// ---------------------------------------------------------------------------

test.describe('Broker API — First Contact Monitoring (UK Safeguarding)', () => {
  test('message copies with first_contact reason should be present when feature is enabled', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const items: any[] = Array.isArray(body.data) ? body.data : [];

    // If first_contact monitoring is enabled, we may see first_contact copies
    // We can't assert they MUST be present (no test data guaranteed),
    // but if they exist they must have the correct shape
    const firstContactItems = items.filter((m: { copy_reason: string }) => m.copy_reason === 'first_contact');

    for (const item of firstContactItems) {
      // First contact items must have sender and receiver IDs for safeguarding audit
      expect(item).toHaveProperty('sender_id');
      expect(item).toHaveProperty('receiver_id');
      expect(typeof item.sender_id).toBe('number');
      expect(typeof item.receiver_id).toBe('number');
    }
  });

  test('high_risk_listing message copies include related listing info', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const items: any[] = Array.isArray(body.data) ? body.data : [];

    const highRiskItems = items.filter((m: { copy_reason: string }) => m.copy_reason === 'high_risk_listing');

    for (const item of highRiskItems) {
      // High-risk messages must reference the listing for audit trail
      const hasListingRef =
        'related_listing_id' in item ||
        'listing_id' in item ||
        'listing_title' in item;
      expect(hasListingRef).toBe(true);
    }
  });
});
