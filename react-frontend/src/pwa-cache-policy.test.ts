// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CACHEABLE_PUBLIC_NAVIGATION_PATH_PATTERN,
  isCacheablePublicNavigationPath,
  isPrivateApiPath,
  isPublicBlogApiPath,
  isPublicTenantBootstrapPath,
  normalizeNavigationPath,
} from '../pwa-cache-policy';

const frontendRoot = path.resolve(__dirname, '..');
const viteConfigSource = readFileSync(path.join(frontendRoot, 'vite.config.ts'), 'utf8');
const serviceWorkerSource = readFileSync(
  path.join(frontendRoot, 'public/sw-push-handler.js'),
  'utf8',
);
const indexHtmlSource = readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');

const protectedIdentityPaths = [
  '/explore',
  '/listings',
  '/listings/42',
  '/events',
  '/events/42',
  '/groups',
  '/groups/42',
  '/jobs',
  '/jobs/42',
  '/courses',
  '/courses/community-organising',
  '/podcasts',
  '/podcasts/nexus-stories',
  '/podcasts/nexus-stories/member-interview',
  '/marketplace',
  '/marketplace/search',
  '/marketplace/map',
  '/marketplace/seller/42',
  '/marketplace/category/gardening',
  '/marketplace/my-listings',
  '/marketplace/my-offers',
  '/marketplace/collections',
  '/marketplace/free',
  '/marketplace/42',
  '/volunteering',
  '/volunteering/opportunities/42',
  '/resources',
  '/kb',
  '/kb/42',
  '/organisations',
  '/organisations/42',
  '/ideation',
  '/ideation/42',
  '/ideation/42/ideas/7',
] as const;

describe('PWA navigation cache policy', () => {
  it('normalizes only casing and slashes without guessing tenant prefixes', () => {
    expect(normalizeNavigationPath('/About/')).toBe('about');
    expect(normalizeNavigationPath('//PLATFORM/PRIVACY//')).toBe('platform/privacy');
    expect(normalizeNavigationPath('/hour-timebank/about')).toBe('hour-timebank/about');
  });

  it.each([
    '/',
    '/features',
    '/about',
    '/account-deletion',
    '/child-safety',
    '/terms/versions',
    '/platform/privacy',
    '/developers',
    '/developers/auth',
    '/impact-report',
    '/blog',
    '/blog/community-update',
  ])('allows the explicitly identity-free public route %s', (pathname) => {
    expect(isCacheablePublicNavigationPath(pathname)).toBe(true);
  });

  it.each(protectedIdentityPaths)(
    'keeps the protected identity-bearing route %s out of public caches',
    (pathname) => {
      expect(isCacheablePublicNavigationPath(pathname)).toBe(false);
    },
  );

  it.each(protectedIdentityPaths)(
    'fails closed for the shared-domain tenant form /hour-timebank%s',
    (pathname) => {
      expect(isCacheablePublicNavigationPath(`/hour-timebank${pathname}`)).toBe(false);
    },
  );

  it.each([
    '/login',
    '/register',
    '/password/reset/secret-token',
    '/pilot-apply/status/secret-token',
    '/newsletter/unsubscribe/secret-token',
    '/guardian/consent/secret-token',
    '/page/community-team',
    '/join/invite-code',
    '/unknown-future-route',
    '/hour-timebank/about',
  ])('keeps auth, token, CMS, unknown, and tenant-prefixed route %s network-only', (pathname) => {
    expect(isCacheablePublicNavigationPath(pathname)).toBe(false);
  });
});

describe('PWA API cache policy', () => {
  it('allows the documented public tenant bootstrap endpoint', () => {
    expect(isPublicTenantBootstrapPath('/api/v2/tenant/bootstrap')).toBe(true);
    expect(isPublicTenantBootstrapPath('/API/V2/TENANT/BOOTSTRAP/')).toBe(true);
    expect(isPrivateApiPath('/api/v2/tenant/bootstrap')).toBe(false);
  });

  it.each([
    '/api/v2/blog',
    '/api/v2/blog/',
    '/api/v2/blog/categories',
    '/api/v2/blog/community-update',
  ])('allows the sanitized public blog read %s', (pathname) => {
    expect(isPublicBlogApiPath(pathname)).toBe(true);
    expect(isPrivateApiPath(pathname)).toBe(false);
  });

  it.each([
    '/api',
    '/api/v2/users/me',
    '/api/v2/explore',
    '/api/v2/blog/community-update/comments',
    '/api/v2/blog/community-update/likes',
    '/api/v2/media/thumbnail',
    '/api/v2/tenant/bootstrap/private',
  ])('classifies %s as private API data', (pathname) => {
    expect(isPrivateApiPath(pathname)).toBe(true);
  });
});

describe('generated service-worker configuration privacy invariants', () => {
  it('registers private API and protected navigation NetworkOnly rules before the public cache', () => {
    const networkOnlyRules = [...viteConfigSource.matchAll(/handler: 'NetworkOnly'/g)]
      .map((match) => match.index);
    const publicCache = viteConfigSource.indexOf("cacheName: 'nexus-public-html-shell-v3'");
    const patternLiteral = CACHEABLE_PUBLIC_NAVIGATION_PATH_PATTERN.toString();
    const embeddedPatternCount = viteConfigSource.split(patternLiteral).length - 1;

    expect(networkOnlyRules).toHaveLength(2);
    expect(networkOnlyRules.every((ruleIndex) => ruleIndex < publicCache)).toBe(true);
    expect(embeddedPatternCount).toBe(2);
    expect(viteConfigSource).toContain("const isApiPath = pathname === '/api'");
    expect(viteConfigSource).toContain("const isPublicBootstrap = pathname.replace(/\\/+$/, '')");
    expect(viteConfigSource).toContain("cacheName: 'nexus-public-blog-api-v1'");
    expect(viteConfigSource).toContain('const isPublicBlogRead =');
    expect(viteConfigSource).toContain("cache: 'no-store'");
    expect(viteConfigSource).toContain('navigateFallback: null');
    expect(viteConfigSource).not.toContain("cacheName: 'nexus-media-thumbnails'");
    expect(viteConfigSource).not.toContain("cacheName: 'nexus-html-shell-v2'");
    expect(viteConfigSource).not.toMatch(
      /\b(?:isCacheablePublicNavigationPath|isPrivateApiPath|isPublicTenantBootstrapPath)\s*\(/,
    );
  });

  it('purges historical identity caches on activation while preserving public/static caches', async () => {
    expect(serviceWorkerSource).toContain("'nexus-media-thumbnails'");
    expect(serviceWorkerSource).toContain('/^nexus-html-shell(?:-|$)/');
    expect(serviceWorkerSource).toContain("self.addEventListener('activate'");
    expect(serviceWorkerSource).toContain('caches.delete(cacheName)');

    type WorkerEventListener = (event: {
      waitUntil: (promise: Promise<unknown>) => void;
    }) => void;

    const listeners = new Map<string, WorkerEventListener[]>();
    const deletedCacheNames: string[] = [];
    const workerScope = {
      location: { origin: 'https://app.project-nexus.ie' },
      addEventListener: (type: string, listener: WorkerEventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    };
    const cacheStorage = {
      keys: async () => [
        'nexus-html-shell',
        'nexus-html-shell-v2',
        'nexus-media-thumbnails',
        'nexus-public-html-shell-v3',
        'nexus-public-blog-api-v1',
        'nexus-tenant-bootstrap-v1',
        'nexus-immutable-assets-v1',
        'nexus-locales',
      ],
      delete: async (cacheName: string) => {
        deletedCacheNames.push(cacheName);
        return true;
      },
    };

    const evaluateServiceWorker = new Function('self', 'caches', serviceWorkerSource);
    evaluateServiceWorker(workerScope, cacheStorage);

    let activationWork: Promise<unknown> | undefined;
    const activateListener = listeners.get('activate')?.[0];
    expect(activateListener).toBeDefined();
    activateListener?.({
      waitUntil: (promise) => {
        activationWork = promise;
      },
    });
    await activationWork;

    expect(deletedCacheNames.sort()).toEqual([
      'nexus-html-shell',
      'nexus-html-shell-v2',
      'nexus-media-thumbnails',
    ]);
  });

  it('does not precache Person structured metadata in the anonymous HTML shell', () => {
    expect(viteConfigSource).toContain("'index.html'");
    expect(indexHtmlSource).not.toMatch(/["']@type["']\s*:\s*["']Person["']/);
    expect(serviceWorkerSource).not.toMatch(/["']@type["']\s*:\s*["']Person["']/);
  });
});
