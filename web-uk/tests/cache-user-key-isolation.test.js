// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The per-user cache key used to be `token.substring(0, 40)`. Auth tokens are
 * HS256 JWTs whose first ~40 characters (base64url header + "." + the "eyJ"
 * start of the payload) are identical for EVERY user on EVERY tenant — so the
 * short-lived unread-count cache collapsed onto one shared key and served one
 * member's counts to the next, and invalidation wiped everyone's entries.
 * userCacheId() hashes the whole token, so keys are unique per session.
 */

const { cache, userCacheId, invalidateUserCache } = require('../src/lib/cache');

// Build two realistic HS256-JWT-shaped tokens for different users.
function jwtFor(userId, tenantId) {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ user_id: userId, tenant_id: tenantId, iat: 1_700_000_000 })
  ).toString('base64url');
  const sig = Buffer.from(`sig-${userId}-${tenantId}`).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('per-user cache key isolation', () => {
  const tokenA = jwtFor(1, 7);
  const tokenB = jwtFor(2, 9);

  afterEach(() => cache.clear());

  it('the old substring(0,40) key WOULD have collided (documents the bug)', () => {
    // This is the crux: the first 40 chars are byte-identical across users.
    expect(tokenA.substring(0, 40)).toBe(tokenB.substring(0, 40));
  });

  it('userCacheId is unique per token', () => {
    expect(userCacheId(tokenA)).not.toBe(userCacheId(tokenB));
    // Deterministic hex digest.
    expect(userCacheId(tokenA)).toMatch(/^[0-9a-f]{64}$/);
    expect(userCacheId(tokenA)).toBe(userCacheId(tokenA));
  });

  it('one user cannot read another user\'s cached counts', () => {
    cache.set(`${userCacheId(tokenA)}:msg-unread`, 5, 10_000);
    cache.set(`${userCacheId(tokenB)}:msg-unread`, 9, 10_000);

    expect(cache.get(`${userCacheId(tokenA)}:msg-unread`)).toBe(5);
    expect(cache.get(`${userCacheId(tokenB)}:msg-unread`)).toBe(9);
  });

  it('invalidating one user does not wipe another user\'s entries', () => {
    cache.set(`${userCacheId(tokenA)}:msg-unread`, 5, 10_000);
    cache.set(`${userCacheId(tokenB)}:msg-unread`, 9, 10_000);

    invalidateUserCache(tokenA);

    expect(cache.get(`${userCacheId(tokenA)}:msg-unread`)).toBeUndefined();
    expect(cache.get(`${userCacheId(tokenB)}:msg-unread`)).toBe(9); // survived
  });
});
