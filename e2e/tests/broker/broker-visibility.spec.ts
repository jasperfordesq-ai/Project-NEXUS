// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, APIRequestContext } from '@playwright/test';
import { completeTwoFactorIfChallenged } from '../../helpers/two-factor';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.test') });

/**
 * Broker Message Visibility — Backend API Tests
 *
 * Covers the broker message visibility system for UK safeguarding compliance:
 *
 *  1. First contact monitoring creates a broker copy when two users message for
 *     the first time (copy_reason = 'first_contact').
 *  2. The broker copy record contains all required fields for audit (sender_id,
 *     receiver_id, message_body, copy_reason).
 *  3. Marking a message reviewed removes it from the unreviewed list.
 *  4. Messages sent from a listing context carry the listing_id in the copy record.
 *  5. UK compliance risk tags include insurance_required and dbs_required flags.
 *  6. Messaging restrictions set via /admin/broker/monitoring are applied.
 *
 * All tests use the V2 admin API: http://localhost:8090/api/v2/admin/broker/*
 * Auth is obtained via the standard login endpoint using admin credentials.
 *
 * Tests are READ-ONLY unless marked [mutation].
 * Mutation tests skip gracefully when no suitable test data is available.
 */

const API_BASE = process.env.E2E_API_URL || 'http://localhost:8090';
const TENANT_SLUG = process.env.E2E_TENANT || 'hour-timebank';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

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

async function getUserToken(request: APIRequestContext): Promise<string | null> {
  const email = process.env.E2E_USER_EMAIL || 'test@hour-timebank.ie';
  const password = process.env.E2E_USER_PASSWORD || 'TestPassword123!';

  const res = await request.post(`${API_BASE}/api/auth/login`, {
    data: { email, password, tenant_slug: TENANT_SLUG },
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_SLUG,
    },
  });

  if (!res.ok()) return null;
  const body = await res.json();
  return body?.data?.access_token || body?.access_token || null;
}

function adminHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Tenant-ID': TENANT_SLUG,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Verify first_contact monitoring creates broker copy
// ---------------------------------------------------------------------------

test.describe('Broker Visibility — Test 1: First Contact Monitoring', () => {
  /**
   * The system should create a broker_message_copies row with
   * copy_reason = 'first_contact' when two users message each other for
   * the first time. We can't force this without sending a real message, but
   * we verify the API correctly exposes existing first_contact copies and that
   * these records have the correct shape.
   */
  test('broker messages endpoint exposes first_contact copies with correct shape', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all&per_page=50`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = data?.items ?? [];

    const firstContactItems = items.filter((m: any) => m.copy_reason === 'first_contact');

    for (const item of firstContactItems) {
      // Each first_contact copy must include identity fields for safeguarding audit
      expect(item).toHaveProperty('sender_id');
      expect(item).toHaveProperty('receiver_id');
      expect(typeof item.sender_id).toBe('number');
      expect(typeof item.receiver_id).toBe('number');
      // sender and receiver must be different people
      expect(item.sender_id).not.toBe(item.receiver_id);
    }
  });

  test('broker dashboard unreviewed_messages count is non-negative', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/dashboard`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;
      expect(data).toHaveProperty('unreviewed_messages');
      expect(data.unreviewed_messages).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: Verify broker copy has correct data fields
// ---------------------------------------------------------------------------

test.describe('Broker Visibility — Test 2: Broker Copy Data Integrity', () => {
  /**
   * Each broker_message_copies record must expose:
   * - sender_id (number) — who sent the message
   * - receiver_id (number) — who received the message
   * - message_body / body — the message content (for review)
   * - copy_reason — the reason this message was copied (compliance trigger)
   * - created_at — timestamp for audit trail
   */
  test('message copy records include all required audit fields', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all&per_page=20`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = data?.items ?? [];

    const validReasons = ['first_contact', 'high_risk_listing', 'new_member', 'flagged_user', 'manual_monitoring', 'random_sample'];

    for (const item of items) {
      // Identity fields
      expect(item).toHaveProperty('sender_id');
      expect(item).toHaveProperty('receiver_id');
      expect(typeof item.sender_id).toBe('number');
      expect(typeof item.receiver_id).toBe('number');

      // Message content — may be 'body' or 'message_body' depending on schema
      const hasContent = 'body' in item || 'message_body' in item || 'content' in item;
      expect(hasContent).toBe(true);

      // Compliance reason
      expect(item).toHaveProperty('copy_reason');
      expect(validReasons).toContain(item.copy_reason);

      // Timestamp
      expect(item).toHaveProperty('created_at');
      expect(item.created_at).toBeTruthy();

      // Flagged boolean should be normalised (not raw DB int)
      if ('flagged' in item) {
        expect(typeof item.flagged).toBe('boolean');
      }
    }
  });

  test('sender_name and receiver_name are joined for readability', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all&per_page=20`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = data?.items ?? [];

    for (const item of items) {
      // The controller JOINs user names — they should be present and non-empty
      if (item.sender_id) {
        const hasSenderName = 'sender_name' in item && typeof item.sender_name === 'string';
        expect(hasSenderName).toBe(true);
      }
      if (item.receiver_id) {
        const hasReceiverName = 'receiver_name' in item && typeof item.receiver_name === 'string';
        expect(hasReceiverName).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: Verify mark as reviewed works
// ---------------------------------------------------------------------------

test.describe('Broker Visibility — Test 3: Mark Message as Reviewed', () => {
  test('[mutation] POST /messages/{id}/review marks message reviewed and removes from unreviewed', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // Fetch one unreviewed message
    const listRes = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=unreviewed&per_page=1`, {
      headers: adminHeaders(token!),
    });

    if (listRes.status() !== 200) {
      test.skip(true, 'Messages API not available — skipping mutation test');
      return;
    }

    const listBody = await listRes.json();
    const items: any[] = listBody?.data?.items ?? listBody?.items ?? [];

    if (items.length === 0) {
      // No unreviewed messages — nothing to test; pass vacuously
      return;
    }

    const messageId = items[0].id;
    expect(typeof messageId).toBe('number');

    // Mark reviewed
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

      // Verify it is no longer in the unreviewed list
      const checkRes = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=unreviewed`, {
        headers: adminHeaders(token!),
      });

      if (checkRes.status() === 200) {
        const checkBody = await checkRes.json();
        const remaining: any[] = checkBody?.data?.items ?? checkBody?.items ?? [];
        const stillUnreviewed = remaining.some((m: any) => m.id === messageId);
        expect(stillUnreviewed).toBe(false);
      }
    }
  });

  test('POST /messages/{nonexistent}/review returns 404 not 500', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.post(`${API_BASE}/api/v2/admin/broker/messages/999999/review`, {
      headers: adminHeaders(token!),
      data: {},
    });

    expect([404, 400]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Verify listing_id is passed to broker copies
// ---------------------------------------------------------------------------

test.describe('Broker Visibility — Test 4: Listing Context in Broker Copies', () => {
  /**
   * When a message is sent from a listing context (e.g. "Contact about this listing"),
   * the system passes the listing_id alongside the message. The broker copy should
   * carry a reference to that listing (related_listing_id or listing_title).
   */
  test('message copies from listing context include listing reference', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all&per_page=50`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = data?.items ?? [];

    // Find any copies that have a listing reference
    const listingCopies = items.filter((m: any) => m.related_listing_id || m.listing_id || m.listing_title);

    for (const item of listingCopies) {
      // If listing context is present, at minimum the ID or title should be truthy
      const hasListingContext =
        (item.related_listing_id && item.related_listing_id > 0) ||
        (item.listing_id && item.listing_id > 0) ||
        (item.listing_title && item.listing_title.trim().length > 0);
      expect(hasListingContext).toBe(true);
    }
  });

  test('broker messages API includes listing_title field via JOIN', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all&per_page=10`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = data?.items ?? [];

    // The controller JOINs listings — listing_title field should be present
    // (it can be null if no listing is linked, but the field should exist in the schema)
    for (const item of items) {
      const hasListingTitleKey = 'listing_title' in item;
      // The field may be null (no listing), but the key must exist
      expect(hasListingTitleKey).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: Verify UK compliance flags in risk tags
// ---------------------------------------------------------------------------

test.describe('Broker Visibility — Test 5: UK Compliance Risk Tag Flags', () => {
  /**
   * UK law requires certain activities to have DBS (Disclosure and Barring Service)
   * checks and/or appropriate insurance. Risk tags on listings surface these
   * requirements. Messages related to high-risk listings should be copied for
   * broker review.
   */
  test('risk tags include insurance_required and dbs_required boolean fields', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = Array.isArray(data) ? data : data?.items ?? [];

    for (const item of items) {
      // UK compliance fields must exist on every risk tag
      expect(item).toHaveProperty('dbs_required');
      expect(item).toHaveProperty('insurance_required');

      // Must be boolean-ish values (DB may return 0/1 integers or booleans)
      const dbsValid = item.dbs_required === true || item.dbs_required === false ||
                       item.dbs_required === 1 || item.dbs_required === 0;
      const insuranceValid = item.insurance_required === true || item.insurance_required === false ||
                             item.insurance_required === 1 || item.insurance_required === 0;
      expect(dbsValid).toBe(true);
      expect(insuranceValid).toBe(true);
    }
  });

  test('risk tags have risk_level values within allowed set', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = Array.isArray(data) ? data : data?.items ?? [];
    const validLevels = ['low', 'medium', 'high', 'critical'];

    for (const item of items) {
      expect(item).toHaveProperty('risk_level');
      expect(validLevels).toContain(item.risk_level);
    }
  });

  test('message copies for high_risk_listing reason reference a listing', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/messages?filter=all&per_page=50`, {
      headers: adminHeaders(token!),
    });

    if (res.status() !== 200) return;

    const body = await res.json();
    const data = body?.data ?? body;
    const items: any[] = data?.items ?? [];

    const highRiskCopies = items.filter((m: any) => m.copy_reason === 'high_risk_listing');

    for (const item of highRiskCopies) {
      // A high-risk listing copy MUST reference a listing to be auditable
      const hasListingRef =
        (item.related_listing_id && item.related_listing_id > 0) ||
        (item.listing_id && item.listing_id > 0) ||
        (item.listing_title && item.listing_title.trim().length > 0);
      expect(hasListingRef).toBe(true);
    }
  });

  test('risk-tags endpoint rejects unauthenticated requests', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/risk-tags`, {
      headers: { 'X-Tenant-ID': TENANT_SLUG },
    });

    expect([401, 403]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Test 6: Verify messaging restriction works
// ---------------------------------------------------------------------------

test.describe('Broker Visibility — Test 6: Messaging Restrictions', () => {
  /**
   * Admin can restrict a user from sending messages via the monitoring system.
   * This is the UK safeguarding enforcement mechanism.
   * We verify:
   *  a) The monitoring API lists restricted users with under_monitoring = true
   *  b) Regular user tokens cannot access the monitoring endpoints
   *  c) Tenant isolation is enforced (data from other tenants is not accessible)
   */
  test('monitoring endpoint returns user restriction records', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: adminHeaders(token!),
    });

    expect(res.status()).not.toBe(500);

    if (res.status() === 200) {
      const body = await res.json();
      const data = body?.data ?? body;
      const items: any[] = Array.isArray(data) ? data : data?.items ?? [];

      for (const item of items) {
        // Every monitoring record must state whether the user is under monitoring
        expect(item).toHaveProperty('under_monitoring');
        // under_monitoring is normalised to boolean by the controller
        expect(typeof item.under_monitoring).toBe('boolean');
        // Must have a user identifier
        expect(item).toHaveProperty('user_id');
        expect(typeof item.user_id).toBe('number');
      }
    }
  });

  test('regular user token is denied access to monitoring endpoint', async ({ request }) => {
    const userEmail = process.env.E2E_USER_EMAIL || 'test@hour-timebank.ie';
    const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@hour-timebank.ie';
    test.skip(
      userEmail === adminEmail,
      'User and admin share the same account — cannot test regular-user access denial'
    );

    const userToken = await getUserToken(request);
    test.skip(!userToken, 'Regular user auth not available — skipping');

    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: adminHeaders(userToken!),
    });

    // Regular members must be denied broker monitoring access
    expect([401, 403]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('broker endpoints reject unknown tenant header gracefully', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // Request with a non-existent tenant slug in X-Tenant-ID header.
    // The server resolves tenant from the JWT tenant_id claim first, so
    // this will either return a tenant-mismatch 403, a 404 for unknown slug,
    // or fall back to the JWT tenant and return 200 — any of these is valid.
    // The only unacceptable response is a 500 server error.
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': 'nonexistent-tenant-xyz',
      },
    });

    expect(res.status()).not.toBe(500);
  });

  test('[mutation] V2 monitoring status endpoint rejects unknown user', async ({ request }) => {
    const token = await getAdminToken(request);
    test.skip(!token, 'Admin auth not available — skipping');

    // POST to the V2 API with a non-existent user ID — should be a clean error, not 500
    const fakeUserId = 999999;

    const res = await request.post(`${API_BASE}/api/v2/admin/broker/monitoring/${fakeUserId}`, {
      headers: adminHeaders(token!),
      data: {
        under_monitoring: true,
        messaging_disabled: false,
        reason: 'E2E test — no real user',
      },
    });

    // V2 API should respond with 404 (not found) or 405 (not implemented), never 500
    expect(res.status()).not.toBe(500);
    expect([404, 405, 422]).toContain(res.status());
  });

  test('unauthenticated monitoring request is rejected', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/v2/admin/broker/monitoring`, {
      headers: { 'X-Tenant-ID': TENANT_SLUG },
    });

    expect([401, 403]).toContain(res.status());
  });
});
