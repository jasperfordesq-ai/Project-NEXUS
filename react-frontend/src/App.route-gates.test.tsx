// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(path.resolve(__dirname, 'routes/AppRoutes.tsx'), 'utf8');
const authRoutesSource = readFileSync(path.resolve(__dirname, 'routes/AuthRoutes.tsx'), 'utf8');
const publicRoutesSource = readFileSync(path.resolve(__dirname, 'routes/PublicAppRoutes.tsx'), 'utf8');
const routeRegistryLoaderSource = readFileSync(path.resolve(__dirname, 'routes/routeRegistryLoader.ts'), 'utf8');
const tenantShellSource = readFileSync(path.resolve(__dirname, 'components/routing/TenantShell.tsx'), 'utf8');
const protectedRoutesStart = appSource.indexOf('{/* Protected Routes */}');
const protectedRoutesEnd = appSource.indexOf('{/* Admin Panel', protectedRoutesStart);
const protectedRoutesSource = appSource.slice(protectedRoutesStart, protectedRoutesEnd);
const identityBearingProtectedRoutes = [
  'explore',
  'listings',
  'listings/:id',
  'events',
  'events/:id',
  'groups',
  'groups/:id',
  'jobs',
  'jobs/:id',
  'courses',
  'courses/:idOrSlug',
  'podcasts',
  'podcasts/:showSlug',
  'podcasts/:showSlug/:episodeSlug',
  'marketplace',
  'marketplace/search',
  'marketplace/map',
  'marketplace/seller/:id',
  'marketplace/category/:slug',
  'marketplace/my-listings',
  'marketplace/my-offers',
  'marketplace/collections',
  'marketplace/free',
  'marketplace/:id',
  'volunteering',
  'volunteering/opportunities/:id',
  'resources',
  'kb',
  'kb/:id',
  'organisations',
  'organisations/:id',
  'ideation',
  'ideation/:id',
  'ideation/:challengeId/ideas/:id',
] as const;
const guardDriftProtectedRoutes = [
  'events/:id/manage/:section?',
  'settings/data-export',
  'clubs/:id/admin/import',
  'clubs/:id/admin/dues',
  'me/verein-dues',
  'me/verein-invitations',
  'municipality-calendar',
] as const;

describe('App route feature gates', () => {
  it('gates matches routes behind the listings module', () => {
    expect(appSource).toMatch(/<Route path="matches" element=\{\s*<FeatureGate module="listings" redirect="\/dashboard">[\s\S]*?<MatchesPage \/>[\s\S]*?<\/FeatureGate>/);
    expect(appSource).toMatch(/<Route path="matches\/preferences" element=\{\s*<FeatureGate module="listings" redirect="\/dashboard">[\s\S]*?<MatchPreferencesPage \/>[\s\S]*?<\/FeatureGate>/);
  });

  it('gates reviews routes behind the reviews feature', () => {
    expect(appSource).toMatch(/<Route path="reviews" element=\{\s*<FeatureGate feature="reviews" redirect="\/dashboard">[\s\S]*?<ReviewsPage \/>[\s\S]*?<\/FeatureGate>/);
    expect(appSource).toMatch(/<Route path="reviews\/create" element=\{\s*<FeatureGate feature="reviews" redirect="\/dashboard">[\s\S]*?<ReviewsPage \/>[\s\S]*?<\/FeatureGate>/);
  });

  it('keeps auth-entry routes out of the full app route registry', () => {
    expect(appSource).not.toContain('@/components/layout/AuthLayout');
    expect(appSource).not.toMatch(/@\/pages\/auth\/(?:LoginPage|RegisterPage|ForgotPasswordPage|ResetPasswordPage|VerifyEmailPage|VerifyIdentityPage|OauthCallbackPage)/);

    expect(authRoutesSource).toContain('@/components/layout/AuthLayout');
    expect(authRoutesSource).toContain("@/pages/auth/LoginPage");
    expect(authRoutesSource).toContain("@/pages/auth/RegisterPage");
  });

  it('keeps app-only runtime providers out of the auth startup shell', () => {
    expect(tenantShellSource).not.toMatch(/from ['"]@\/contexts\/(?:NotificationsContext|PusherContext|MenuContext|PresenceContext|PodcastPlayerContext)['"]/);
    expect(tenantShellSource).not.toContain('@/components/security/IdleLogoutGuard');
    expect(tenantShellSource).not.toContain('appRoutesModulePromise');
    expect(routeRegistryLoaderSource).toContain("import('./AuthRoutes')");
    expect(routeRegistryLoaderSource).toContain("import('./PublicAppRoutes')");
    expect(routeRegistryLoaderSource).toContain("import('./AppRoutes')");
    expect(tenantShellSource).toContain("lazy(() => import('./TenantAppProviders'))");
  });

  it('keeps protected/admin route declarations out of the public route registry', () => {
    expect(publicRoutesSource).not.toContain('@/admin/AdminApp');
    expect(publicRoutesSource).not.toContain('@/super-admin/SuperAdminApp');
    expect(publicRoutesSource).not.toContain('@/components/routing/ProtectedRoute');
    expect(publicRoutesSource).not.toContain('@/pages/marketplace/CreateMarketplaceListingPage');
    expect(publicRoutesSource).not.toContain('@/pages/courses/CoursePlayerPage');
  });

  it('excludes protected subroutes that sit under public-looking prefixes', () => {
    expect(tenantShellSource).toContain("'podcasts/studio'");
    expect(tenantShellSource).toContain("'marketplace/orders'");
    expect(tenantShellSource).toContain("'marketplace/sell'");
    expect(tenantShellSource).toContain("'marketplace/seller/coupons'");
    expect(tenantShellSource).toContain('^courses\\/[^/]+\\/learn$');
    expect(tenantShellSource).toContain('^jobs\\/[^/]+\\/kanban$');
    expect(tenantShellSource).toContain('^marketplace\\/[^/]+\\/edit$');
  });

  it('keeps seller coupon and listing-edit routes inside the authenticated route tree', () => {
    const protectedSellerRoutes = [
      'marketplace/seller/coupons',
      'marketplace/seller/coupons/new',
      'marketplace/seller/coupons/:id/edit',
      'marketplace/:id/edit',
    ];

    expect(protectedRoutesStart).toBeGreaterThan(-1);
    expect(protectedRoutesEnd).toBeGreaterThan(protectedRoutesStart);

    for (const routePath of protectedSellerRoutes) {
      const declaration = `path="${routePath}"`;
      expect(protectedRoutesSource).toContain(declaration);
      expect(appSource.split(declaration)).toHaveLength(2);
      expect(publicRoutesSource).not.toContain(declaration);
    }

    expect(protectedRoutesSource).toMatch(/path="marketplace\/seller\/coupons"[\s\S]*?<FeatureGate feature="merchant_coupons"/);
    expect(protectedRoutesSource).toMatch(/path="marketplace\/seller\/coupons\/new"[\s\S]*?<FeatureGate feature="merchant_coupons"/);
    expect(protectedRoutesSource).toMatch(/path="marketplace\/seller\/coupons\/:id\/edit"[\s\S]*?<FeatureGate feature="merchant_coupons"/);
    expect(protectedRoutesSource).toMatch(/path="marketplace\/:id\/edit"[\s\S]*?<FeatureGate feature="marketplace"/);
  });

  it('gates partner venue routes behind the partner_venues feature', () => {
    expect(protectedRoutesSource).toMatch(/path="venues"[\s\S]*?<FeatureGate feature="partner_venues"/);
    expect(protectedRoutesSource).toMatch(/path="venues\/pass"[\s\S]*?<FeatureGate feature="partner_venues"/);
    expect(protectedRoutesSource).toMatch(/path="venues\/checkin\/:token"[\s\S]*?<FeatureGate feature="partner_venues"/);
  });

  it('keeps the venue pass and scan-landing routes out of the public registry', () => {
    // The pass QR identifies a member and the scan-landing page records a
    // visit, so neither may resolve without authentication. An unauthenticated
    // scanner must be sent through login and returned, exactly like
    // volunteering/checkin/:token.
    for (const routePath of ['venues', 'venues/pass', 'venues/checkin/:token']) {
      const declaration = `path="${routePath}"`;
      expect(protectedRoutesSource).toContain(declaration);
      expect(publicRoutesSource).not.toContain(declaration);
    }
  });

  it('keeps every audited identity-bearing route inside the authenticated tree only', () => {
    expect(protectedRoutesStart).toBeGreaterThan(-1);
    expect(protectedRoutesEnd).toBeGreaterThan(protectedRoutesStart);

    for (const routePath of identityBearingProtectedRoutes) {
      const declaration = `path="${routePath}"`;
      expect(protectedRoutesSource).toContain(declaration);
      expect(appSource.split(declaration)).toHaveLength(2);
      expect(publicRoutesSource).not.toContain(declaration);
    }
  });

  it('keeps guard-drift and marketplace account routes behind the route boundary', () => {
    for (const routePath of guardDriftProtectedRoutes) {
      const declaration = `path="${routePath}"`;
      expect(protectedRoutesSource).toContain(declaration);
      expect(appSource.split(declaration)).toHaveLength(2);
      expect(publicRoutesSource).not.toContain(declaration);
    }

    expect(protectedRoutesSource).toContain('path="marketplace/my-listings"');
    expect(protectedRoutesSource).toContain('path="marketplace/my-offers"');
  });

  it('keeps only the token verification route in the shared public feature registry', () => {
    expect(publicRoutesSource).toContain('renderSharedPublicFeatureRoutes()');
    expect(publicRoutesSource).not.toContain('@/pages/explore/ExplorePage');
    expect(tenantShellSource).toContain('^volunteering\\/guardian-consent\\/verify\\/[^/]+$');
    expect(tenantShellSource).not.toContain('timebanking-guide|explore|partner');
    expect(tenantShellSource).not.toContain('^marketplace$');
  });

  it('keeps sanitized blog index and article URLs in the anonymous public registry', () => {
    for (const routePath of ['blog', 'blog/:slug'] as const) {
      const declaration = `path="${routePath}"`;
      expect(publicRoutesSource).toContain(declaration);
      expect(appSource).not.toContain(declaration);
    }

    expect(publicRoutesSource).toContain("import('@/pages/blog/BlogPage')");
    expect(publicRoutesSource).toContain("import('@/pages/blog/BlogPostPage')");
    expect(tenantShellSource).toContain('^blog(\\/[^/]+)?$');
  });
});
