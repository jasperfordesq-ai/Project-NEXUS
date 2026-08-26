// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for tenant-routing utilities
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RESERVED_SUBDOMAINS,
  RESERVED_PATHS,
  detectTenantFromUrl,
  tenantPath,
  stripTenantSlug,
} from './tenant-routing';

describe('tenant-routing', () => {
  // Save original location
  const originalLocation = window.location;

  function mockLocation(hostname: string, pathname: string) {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, hostname, pathname },
    });
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  describe('RESERVED_SUBDOMAINS', () => {
    it('contains expected subdomains', () => {
      expect(RESERVED_SUBDOMAINS.has('app')).toBe(true);
      expect(RESERVED_SUBDOMAINS.has('api')).toBe(true);
      expect(RESERVED_SUBDOMAINS.has('www')).toBe(true);
      expect(RESERVED_SUBDOMAINS.has('admin')).toBe(true);
      expect(RESERVED_SUBDOMAINS.has('staging')).toBe(true);
    });

    it('does not contain tenant slugs', () => {
      expect(RESERVED_SUBDOMAINS.has('hour-timebank')).toBe(false);
      expect(RESERVED_SUBDOMAINS.has('my-community')).toBe(false);
    });
  });

  describe('RESERVED_PATHS', () => {
    it('contains expected paths', () => {
      expect(RESERVED_PATHS.has('login')).toBe(true);
      expect(RESERVED_PATHS.has('register')).toBe(true);
      expect(RESERVED_PATHS.has('dashboard')).toBe(true);
      expect(RESERVED_PATHS.has('saved')).toBe(true);
      expect(RESERVED_PATHS.has('admin')).toBe(true);
      expect(RESERVED_PATHS.has('admin-legacy')).toBe(true);
      expect(RESERVED_PATHS.has('api')).toBe(true);
      expect(RESERVED_PATHS.has('caring')).toBe(true);
      expect(RESERVED_PATHS.has('caring-community')).toBe(true);
      expect(RESERVED_PATHS.has('broker')).toBe(true);
      expect(RESERVED_PATHS.has('partner-timebanks')).toBe(true);
    });

    // Regression: these are real top-level app routes. If any is missing here,
    // detectTenantFromUrl() misreads it as a tenant slug on custom domains and
    // the SPA shows "Community not found" instead of the page (e.g. the Courses
    // module was unreachable on hour-timebank.ie/courses — bootstrap?slug=courses 404).
    it('reserves top-level app route names so they are never treated as tenant slugs', () => {
      for (const route of [
        'courses', 'podcasts', 'coupons', 'clubs', 'me', 'municipality-calendar',
        'advertise', 'join', 'trust-and-safety', 'account-deletion', 'child-safety', 'pilot-inquiry', 'pilot-apply',
        'developers', 'regional-analytics', 'partner-analytics', 'pricing',
        'auth', 'users', 'premium', 'donations', 'verify-identity-optional',
      ]) {
        expect(RESERVED_PATHS.has(route)).toBe(true);
      }
    });

    // Completeness guard: derive the invariant from the router itself so a new
    // top-level route can never ship unreserved again (this bug class has
    // recurred: /saved, /courses, /premium). Every top-level literal route
    // segment MUST be in RESERVED_PATHS.
    it('reserves EVERY top-level literal route segment (router-derived)', () => {
      const readRouteFile = (file: string): string => {
        // Robust to vitest running from react-frontend/ or the repo root.
        for (const base of ['src/routes', 'react-frontend/src/routes']) {
          const p = resolve(process.cwd(), base, file);
          if (existsSync(p)) return readFileSync(p, 'utf8');
        }
        throw new Error(`route file not found: ${file} (cwd=${process.cwd()})`);
      };
      const segs = new Set<string>();
      for (const file of ['AppRoutes.tsx', 'PublicAppRoutes.tsx', 'AuthRoutes.tsx']) {
        const src = readRouteFile(file);
        for (const m of src.matchAll(/path="([^"]+)"/g)) {
          const first = m[1].split('/').filter(Boolean)[0];
          if (!first || first.startsWith(':') || first.startsWith('*')) continue;
          segs.add(first.toLowerCase());
        }
      }
      const missing = [...segs].filter((s) => !RESERVED_PATHS.has(s)).sort();
      expect(
        missing,
        'Unreserved top-level route segments — add each to RESERVED_PATHS ' +
          '(tenant-routing.ts) AND TenantContext::getReservedPaths() (PHP): ' +
          missing.join(', '),
      ).toEqual([]);
    });

    it('does not contain tenant slugs', () => {
      expect(RESERVED_PATHS.has('hour-timebank')).toBe(false);
      expect(RESERVED_PATHS.has('my-community')).toBe(false);
    });
  });

  describe('detectTenantFromUrl', () => {
    it('returns slug from path on localhost', () => {
      mockLocation('localhost', '/hour-timebank/dashboard');
      const result = detectTenantFromUrl();
      expect(result.slug).toBe('hour-timebank');
      expect(result.source).toBe('path');
    });

    it('returns null for reserved path on localhost', () => {
      mockLocation('localhost', '/dashboard');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('does not treat a reserved app route as a tenant slug on localhost', () => {
      // Regression for localhost:5173/premium → bootstrap?slug=premium 404 →
      // "Community not found". /premium is a real route, not a tenant.
      mockLocation('localhost', '/premium');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('returns null for the saved-items route on localhost', () => {
      mockLocation('localhost', '/saved');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('returns null for caring module paths on localhost', () => {
      mockLocation('localhost', '/caring/workflow');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('returns null for empty path on localhost', () => {
      mockLocation('localhost', '/');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('returns slug from path on 127.0.0.1', () => {
      mockLocation('127.0.0.1', '/my-community/feed');
      const result = detectTenantFromUrl();
      expect(result.slug).toBe('my-community');
      expect(result.source).toBe('path');
    });

    it('detects subdomain on project-nexus.ie', () => {
      mockLocation('hour-timebank.project-nexus.ie', '/dashboard');
      const result = detectTenantFromUrl();
      expect(result.slug).toBe('hour-timebank');
      expect(result.source).toBe('subdomain');
    });

    it('skips reserved subdomain (app) and falls through to path', () => {
      mockLocation('app.project-nexus.ie', '/my-tenant/feed');
      const result = detectTenantFromUrl();
      expect(result.slug).toBe('my-tenant');
      expect(result.source).toBe('path');
    });

    it('returns null for reserved subdomain (api)', () => {
      mockLocation('api.project-nexus.ie', '/');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('returns null for custom domain (R1)', () => {
      mockLocation('my-custom-domain.com', '/dashboard');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('does not treat a reserved app route as a sub-tenant slug on a custom domain', () => {
      // Regression for hour-timebank.ie/courses → bootstrap?slug=courses 404 →
      // "Community not found". /courses is a real route, not a tenant.
      mockLocation('hour-timebank.ie', '/courses');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });

    it('still resolves a genuine sub-tenant slug on a parent custom domain', () => {
      // Non-reserved first segment on a custom domain is still attempted as a
      // child slug (e.g. timebanking.uk/cardiff); the bootstrap API validates it.
      mockLocation('timebanking.uk', '/cardiff');
      const result = detectTenantFromUrl();
      expect(result.slug).toBe('cardiff');
      expect(result.source).toBe('path');
    });

    it('lowercases subdomain slugs', () => {
      mockLocation('HOUR-TIMEBANK.project-nexus.ie', '/');
      const result = detectTenantFromUrl();
      expect(result.slug).toBe('hour-timebank');
    });

    it('rejects multi-level subdomains', () => {
      mockLocation('foo.bar.project-nexus.ie', '/');
      const result = detectTenantFromUrl();
      expect(result.slug).toBeNull();
      expect(result.source).toBeNull();
    });
  });

  describe('tenantPath', () => {
    it('prefixes path with tenant slug', () => {
      expect(tenantPath('/dashboard', 'hour-timebank')).toBe('/hour-timebank/dashboard');
    });

    it('returns path as-is when no slug', () => {
      expect(tenantPath('/dashboard', null)).toBe('/dashboard');
      expect(tenantPath('/dashboard', undefined)).toBe('/dashboard');
    });

    it('normalizes path without leading slash', () => {
      expect(tenantPath('dashboard', 'my-tenant')).toBe('/my-tenant/dashboard');
    });

    it('handles root path', () => {
      expect(tenantPath('/', 'my-tenant')).toBe('/my-tenant/');
    });

    it('handles empty string slug', () => {
      expect(tenantPath('/dashboard', '')).toBe('/dashboard');
    });

    it('does not double-prefix when path already has slug', () => {
      expect(tenantPath('/hour-timebank/federation', 'hour-timebank')).toBe('/hour-timebank/federation');
    });

    it('does not double-prefix when path is just the slug', () => {
      expect(tenantPath('/hour-timebank', 'hour-timebank')).toBe('/hour-timebank');
    });

    it('is case-insensitive for double-prefix detection', () => {
      expect(tenantPath('/HOUR-TIMEBANK/dashboard', 'hour-timebank')).toBe('/HOUR-TIMEBANK/dashboard');
    });

    it('does not falsely skip prefixing for similar slug names', () => {
      // "hour-timebank-2" starts with "hour-timebank" but is a different slug
      expect(tenantPath('/hour-timebank-2/dashboard', 'hour-timebank')).toBe('/hour-timebank/hour-timebank-2/dashboard');
    });
  });

  describe('stripTenantSlug', () => {
    it('strips slug prefix from pathname', () => {
      expect(stripTenantSlug('/hour-timebank/dashboard', 'hour-timebank')).toBe('/dashboard');
    });

    it('returns / when pathname is just the slug', () => {
      expect(stripTenantSlug('/hour-timebank', 'hour-timebank')).toBe('/');
    });

    it('returns pathname as-is when no slug prefix', () => {
      expect(stripTenantSlug('/dashboard', 'hour-timebank')).toBe('/dashboard');
    });

    it('is case-insensitive', () => {
      expect(stripTenantSlug('/HOUR-TIMEBANK/dashboard', 'hour-timebank')).toBe('/dashboard');
    });

    it('handles nested paths', () => {
      expect(stripTenantSlug('/my-tenant/listings/42', 'my-tenant')).toBe('/listings/42');
    });
  });
});
