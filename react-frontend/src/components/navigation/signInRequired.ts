// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which pages of the site send a signed-out visitor to the sign-in page.
 *
 * The menus use this to put a padlock beside a link BEFORE a visitor clicks
 * it (owner, 13 Nov 2026). It is a statement about the route files, not a
 * second access rule: nothing here grants or refuses anything. The route
 * files decide; `signInRequired.test.ts` reads them and fails when this list
 * and they disagree, in either direction — so a new open page cannot ship
 * with a padlock on its link, and a newly guarded page cannot ship without.
 *
 * Almost every page is guarded (one `<ProtectedRoute>` wraps most of
 * `routes/AppRoutes.tsx`), so the short list is the OPEN pages and everything
 * else on the site needs a sign-in.
 *
 * This is not `auth: 'authenticated'` in `navigationRegistry.ts`. That flag
 * removes a link from a visitor's menus altogether; this marks the links a
 * visitor IS shown and cannot open yet.
 */

import { CARING_COMMUNITY_ROUTE } from '@/pages/caring-community/config';

/** Open, and so is every page beneath them (`/blog` and `/blog/a-post`). */
const OPEN_SECTIONS: readonly string[] = [
  // Public information
  'features', 'changelog', 'development-status', 'about', 'faq', 'contact',
  'help', 'install-app', 'timebanking-guide', 'pricing', 'trust-and-safety',
  'developers', 'regional-analytics', 'partner-analytics',
  'pilot-inquiry', 'pilot-apply', 'verify-certificate',
  // Legal documents and their version histories
  'terms', 'privacy', 'accessibility', 'cookies', 'community-guidelines',
  'acceptable-use', 'account-deletion', 'child-safety', 'legal', 'platform',
  // A community's own public content
  'page', 'blog', 'whats-on', 'coupons',
  'partner', 'social-prescribing', 'impact-summary', 'impact-report', 'strategic-plan',
  // Links from an email that carry their own token
  'newsletter', 'support-actions', 'join',
  // Signing in and joining
  'login', 'register', 'password', 'verify-email', 'auth',
];

/** Open on their own; the pages beneath them are for members. */
const OPEN_PAGES: readonly string[] = [
  '', // the home page
  CARING_COMMUNITY_ROUTE.path,
  'clubs',
  'verify-identity',
];

/**
 * True when a signed-out visitor who follows `url` would be sent to sign in.
 *
 * `url` may carry the community prefix or not (`/hour-timebank/members` and
 * `/members` are the same question); pass `tenantPath('/')` as `tenantPrefix`
 * so the prefix can be read through. A link that leaves the site is never
 * locked — this knows nothing about other sites.
 */
export function pathNeedsSignIn(url: string, tenantPrefix = ''): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) return false;

  let path = (url.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '').toLowerCase();
  const prefix = tenantPrefix.replace(/\/+$/, '').toLowerCase();
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) path = path.slice(prefix.length);
  const page = path.replace(/^\/+/, '');

  if (OPEN_PAGES.includes(page)) return false;
  return !OPEN_SECTIONS.some(section => page === section || page.startsWith(`${section}/`));
}

/**
 * Whether a menu should show the padlock on `url` for the person looking.
 * Never for a signed-in member, and not while the sign-in check is still
 * running — a member reloading the page would see every link flash locked.
 */
export function showsSignInLock(
  url: string,
  viewer: { isAuthenticated: boolean; isLoading?: boolean },
  tenantPrefix = '',
): boolean {
  if (viewer.isAuthenticated || viewer.isLoading) return false;
  return pathNeedsSignIn(url, tenantPrefix);
}
