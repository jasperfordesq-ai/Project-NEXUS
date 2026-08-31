// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

type RedirectEvent = {
  path: string | null;
  initial: boolean;
};

const KNOWN_SECTIONS = new Set([
  'exchanges',
  'listings',
  'events',
  'members',
  'profile',
  'users',
  'me',
  'messages',
  'groups',
  'polls',
  'ideation',
  'challenges',
  'explore',
  'discover',
  'search',
  'resources',
  'support',
  'help',
  'legal',
  'about',
  'contact',
  'terms',
  'privacy',
  'cookies',
  'accessibility',
  'trust-and-safety',
  'platform',
  // Added 2026-08-19. Everything below had a working native screen that no deep
  // link could reach: app.json claims EVERY https://app.project-nexus.ie/* URL
  // (autoVerify, no pathPrefix), so Android hands us the URL, this mapper returned
  // null, and Expo Router showed its "Unmatched Route" screen. 169 of 254 member
  // routes behaved that way. `password` is first in this list on purpose — a
  // password-reset email opened on a device with the app installed dropped the
  // token and dumped the member on the login screen.
  'password',
  'login',
  'register',
  'verify-email',
  'verify-identity',
  'verify-identity-optional',
  'marketplace',
  'coupons',
  'jobs',
  'federation',
  'volunteering',
  'organisations',
  'group-exchanges',
  'goals',
  'blog',
  'blog-post',
  'kb',
  'feed',
  'dashboard',
  'notifications',
  'settings',
  'activity',
  'chat',
  'connections',
  'network',
  'matches',
  'reviews',
  'saved',
  'skills',
  'endorsements',
  'wallet',
  'achievements',
  'leaderboard',
  'nexus-score',
  'linked-accounts',
  'courses',
  'podcasts',
  'onboarding',
  'clubs',
  'venues',
  'donations',
  'job',
  'organisation',
  'organization',
  'gamification',
  'trust',
]);

/**
 * Sections that MUST stay in the browser even though app.json hands us the URL.
 *
 * 🔴 These are not "unmapped" — they are deliberately declined. The staff consoles
 * have no native equivalent, and the two callbacks are mid-handshake redirects whose
 * flow lives in the browser that started it: swallowing them into the app strands
 * the member with a token the app cannot complete. `redirectSystemPath` returns them
 * unchanged so Android continues on to the browser.
 */
const BROWSER_ONLY_SECTIONS = new Set([
  'admin',
  'admin-legacy',
  'broker',
  'super-admin',
  'auth',
]);

/** Full paths that must stay in the browser, checked before section routing. */
const BROWSER_ONLY_PATHS = new Set([
  'verify-identity/callback',
  'auth/oauth/callback',
]);

export function isBrowserOnlyPath(rawPath: string | null): boolean {
  const trimmed = rawPath?.trim();
  if (!trimmed) return false;
  let pathname: string;
  try {
    const normalized = trimmed.includes('://') || trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    pathname = new URL(normalized, 'https://app.project-nexus.ie').pathname;
  } catch {
    return false;
  }
  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) return false;
  if (BROWSER_ONLY_PATHS.has(segments.join('/'))) return true;
  // `join/:code` is the Care in Community invite redemption route, which is
  // deliberately absent from both adults-only native apps. Support-action tokens
  // are public, side-effecting linked-account confirmations and must finish on web.
  if (segments[0] === 'join' && segments.length === 2) return true;
  if (segments[0] === 'support-actions' && segments[1] === 'confirm' && segments.length === 3) return true;
  return BROWSER_ONLY_SECTIONS.has(segments[0]!);
}

export function redirectSystemPath({ path }: RedirectEvent): string {
  try {
    // Declined on purpose — see BROWSER_ONLY_SECTIONS. Returning the path unchanged
    // lets Android carry on to the browser instead of stranding the member here.
    if (isBrowserOnlyPath(path)) return path ?? '/';
    return mapSystemPathToNativeRoute(path) ?? path ?? '/';
  } catch {
    return path ?? '/';
  }
}

export function mapSystemPathToNativeRoute(rawPath: string | null): string | null {
  const parsed = parseSystemPath(rawPath);
  if (!parsed) return null;

  const { section, segments, params } = parsed;
  const [id, detail] = segments;

  switch (section) {
    // 🔴 `exchanges` and `listings` are DIFFERENT id spaces and used to share this case.
    // On the website `/exchanges/:id` is an exchange REQUEST between two members and
    // `/listings/:id` is a listing; the mobile app calls listings "exchanges" internally,
    // which is how they came to be treated as one. The consequence was measured on
    // 2026-08-21: the provider's "Exchange request received" notification (link
    // `/exchanges/61`) opened the listing screen, asked the API for listing 61, got a 404
    // and showed "Listing not found" — the provider's only route into the request.
    case 'exchanges':
      if (isCreateAlias(id)) return appendParams('/(modals)/new-exchange', params);
      return id
        ? appendParams('/(modals)/exchange-request-detail', { ...params, id })
        : appendParams('/(modals)/exchange-requests', params);

    case 'listings':
      if (isCreateAlias(id)) return appendParams('/(modals)/new-exchange', params);
      return id ? appendParams('/(modals)/exchange-detail', { ...params, id }) : '/(tabs)/exchanges';

    case 'events':
      if (isCreateAlias(id)) return appendParams('/(modals)/new-event', params);
      if (id && detail === 'manage') {
        return appendParams('/(modals)/event-manage', {
          ...params,
          id,
          ...(segments[2] ? { section: segments[2] } : {}),
        });
      }
      return id ? appendParams('/(modals)/event-detail', { ...params, id }) : '/(tabs)/events';

    case 'groups':
      if (id === 'invite' && detail) return appendParams('/(modals)/group-invite', { ...params, token: detail });
      if (isCreateAlias(id)) return appendParams('/(modals)/new-group', params);
      return id ? appendParams('/(modals)/group-detail', { ...params, id }) : '/(modals)/groups';

    case 'members':
      return id ? appendParams('/(modals)/member-profile', { ...params, id }) : '/(modals)/members';

    case 'profile':
      return id
        ? appendParams('/(modals)/member-profile', { ...params, id })
        : appendParams('/(tabs)/profile', params);

    case 'users':
      if (id && detail === 'appreciations') return appendParams('/(modals)/appreciations', { ...params, userId: id });
      if (id && detail === 'collections') return appendParams('/(modals)/profile-collections', { ...params, userId: id, scope: 'public' });
      return id ? appendParams('/(modals)/member-profile', { ...params, id }) : '/(modals)/members';

    case 'me':
      if (id === 'collections') {
        return appendParams('/(modals)/profile-collections', segments[1] ? { ...params, collectionId: segments[1] } : params);
      }
      return null;

    case 'messages':
      return mapMessagePath(segments, params);

    case 'polls':
      return appendParams('/(modals)/polls', isCreateAlias(id) ? { ...params, create: '1' } : params);

    case 'ideation':
    case 'challenges':
      if (section === 'ideation' && id === 'campaigns') {
        return detail
          ? appendParams('/(modals)/ideation-campaign-detail', { ...params, id: detail })
          : appendParams('/(modals)/ideation-campaigns', params);
      }
      if (section === 'ideation' && id === 'outcomes') return appendParams('/(modals)/ideation-outcomes', params);
      if (isCreateAlias(id)) return appendParams('/(modals)/new-challenge', params);
      if (section === 'ideation' && id && detail === 'edit') {
        return appendParams('/(modals)/new-challenge', { ...params, id, mode: 'edit' });
      }
      if (section === 'ideation' && id && detail === 'ideas' && segments[2]) {
        return appendParams('/(modals)/ideation-idea', { ...params, challengeId: id, id: segments[2] });
      }
      return id ? appendParams('/(modals)/ideation-detail', { ...params, id }) : '/(modals)/ideation';

    case 'explore':
    case 'discover':
      return appendParams('/(tabs)/explore', params);

    case 'search':
      return appendParams('/(modals)/search', params);

    case 'resources':
      return id ? appendParams('/(modals)/kb-article', { ...params, id }) : appendParams('/(modals)/resources', params);

    case 'support':
    case 'help':
    case 'legal':
      return appendParams('/(modals)/support', params);

    case 'about':
    case 'contact':
    case 'terms':
    case 'privacy':
    case 'cookies':
    case 'accessibility':
    case 'trust-and-safety':
    case 'trust':
      return appendParams('/(modals)/support', { ...params, doc: supportDocumentForSection(section) });

    case 'platform':
      if (id === 'terms' || id === 'privacy') {
        return appendParams('/(modals)/support', { ...params, doc: id });
      }
      return appendParams('/(modals)/support', params);

    // -- Auth ----------------------------------------------------------------
    // The reason this whole block exists. A reset email opened on a device with the
    // app installed used to drop its token and land on login, because `password`
    // was not a known section. The token rides in `params`, so appendParams carries
    // it through untouched.
    case 'password':
      if (id === 'reset') return appendParams('/(auth)/reset-password', params);
      return appendParams('/(auth)/forgot-password', params);

    case 'login':
      return appendParams('/(auth)/login', params);

    case 'register':
      return appendParams('/(auth)/register', params);

    case 'verify-email':
      return appendParams('/(auth)/verify-email', params);

    case 'verify-identity':
      // `verify-identity/callback` never reaches here - isBrowserOnlyPath declines it
      // first, because the Stripe handshake must finish in the browser that began it.
      return appendParams('/(modals)/verify-identity', params);

    case 'verify-identity-optional':
      // The optional web prompt is the same status journey. The native screen keeps
      // paid verification actions disabled under the Play policy gate.
      return appendParams('/(modals)/verify-identity', params);

    // -- Marketplace ---------------------------------------------------------
    case 'marketplace':
      return mapMarketplacePath(segments, params);

    case 'coupons':
      return id
        ? appendParams('/(modals)/marketplace-coupon-detail', { ...params, id })
        : appendParams('/(modals)/marketplace-coupons', params);

    // -- Jobs ----------------------------------------------------------------
    case 'jobs':
    case 'job':
      if (id === 'employers' && detail) return appendParams('/(modals)/member-profile', { ...params, id: detail });
      if (isCreateAlias(id)) return appendParams('/(modals)/new-job', params);
      if (id === 'alerts') return appendParams('/(modals)/jobs', { ...params, view: 'alerts' });
      if (id === 'my-applications') {
        return appendParams('/(modals)/jobs', { ...params, view: 'my-applications' });
      }
      if (id && detail === 'analytics') return appendParams('/(modals)/job-analytics', { ...params, id });
      if (id && detail === 'edit') return appendParams('/(modals)/edit-job', { ...params, id });
      if (id && detail === 'kanban') return appendParams('/(modals)/job-pipeline', { ...params, id });
      if (id && detail === 'applications') return appendParams('/(modals)/job-pipeline', { ...params, id });
      return id ? appendParams('/(modals)/job-detail', { ...params, id }) : appendParams('/(modals)/jobs', params);

    // -- Federation ----------------------------------------------------------
    case 'federation':
      return mapFederationPath(segments, params);

    // -- Volunteering --------------------------------------------------------
    case 'volunteering':
      if (id === 'checkin' && detail) return appendParams('/(modals)/volunteer-checkin', { ...params, token: detail });
      if (isCreateAlias(id)) return appendParams('/(modals)/new-volunteering', params);
      if (id === 'my-applications') {
        return appendParams('/(modals)/volunteering', { ...params, tab: 'applications' });
      }
      if (id === 'my-organisations') {
        return appendParams('/(modals)/volunteering', { ...params, tab: 'organisations' });
      }
      if (id === 'opportunities' && detail) {
        return appendParams('/(modals)/volunteering-detail', { ...params, id: detail });
      }
      if (id === 'org' && detail) {
        // 🔴 `id`, NOT `orgId`. volunteering-org-dashboard.tsx reads
        // `useLocalSearchParams<{ id?: string }>()`, so an `orgId` param routed to the
        // right screen and then rendered "Organisation not found." — verified on a device
        // on 2026-08-20 against an organisation the signed-in member owned. In-app
        // navigation (volunteering.tsx) has always passed `id`; only the deep link was
        // wrong, which is why nobody hit it by tapping around.
        return appendParams('/(modals)/volunteering-org-dashboard', { ...params, id: detail });
      }
      return id
        ? appendParams('/(modals)/volunteering-detail', { ...params, id })
        : appendParams('/(modals)/volunteering', params);

    // -- Organisations -------------------------------------------------------
    case 'organisations':
    case 'organisation':
    case 'organization':
      if (id === 'register') return appendParams('/(modals)/new-organisation', params);
      return id
        ? appendParams('/(modals)/organisation-detail', { ...params, id })
        : appendParams('/(modals)/organisations', params);

    case 'group-exchanges':
      if (isCreateAlias(id)) return appendParams('/(modals)/new-group-exchange', params);
      return id
        ? appendParams('/(modals)/group-exchange-detail', { ...params, id })
        : appendParams('/(modals)/group-exchanges', params);

    case 'goals':
      return id
        ? appendParams('/(modals)/goal-detail', { ...params, id })
        : appendParams('/(modals)/goals', params);

    // -- Content -------------------------------------------------------------
    case 'blog':
    case 'blog-post':
      // 🔴 The web route is /blog/:slug, so this segment is a slug — but the parameter
      // must still be called `id`, because blog-post.tsx reads
      // `useLocalSearchParams<{ id: string }>()` and then does `const slug = id`. Passing
      // a correctly-named `slug` left the screen with no identifier at all and it rendered
      // empty. The name is confusing and the screen is where it should be fixed; the value
      // being a slug is correct and deliberate.
      return id
        ? appendParams('/(modals)/blog-post', { ...params, id })
        : appendParams('/(modals)/blog', params);

    case 'kb':
      return id
        ? appendParams('/(modals)/kb-article', { ...params, id })
        : appendParams('/(modals)/resources', params);

    // -- Feed ----------------------------------------------------------------
    case 'feed':
    case 'dashboard':
      return mapFeedPath(segments, params);

    // -- Settings ------------------------------------------------------------
    case 'settings':
      if (id === 'blocked') return appendParams('/(modals)/settings-blocked-users', params);
      if (id === 'data-export') return appendParams('/(modals)/settings-data-export', params);
      return appendParams('/(modals)/settings', params);

    case 'linked-accounts':
      // Deliberately lands on the linked-accounts screen rather than a conversation:
      // per-relationship message viewing is NOT enforced server-side yet, so the
      // native app must not present it as available. See docs/SAFEGUARDING-AND-CONSENT.md.
      return appendParams('/(modals)/settings-linked-accounts', id ? { ...params, childId: id } : params);

    // -- Single-screen sections ----------------------------------------------
    case 'notifications':
      return appendParams('/(modals)/notifications', params);

    case 'activity':
      return appendParams('/(modals)/activity', params);

    case 'chat':
      return appendParams('/(modals)/chat', params);

    case 'connections':
    case 'network':
      return appendParams('/(modals)/connections', params);

    case 'matches':
      if (id === 'preferences') {
        return appendParams('/(modals)/match-preferences', params);
      }
      return appendParams('/(modals)/matches', params);

    case 'reviews':
      if (id === 'create') {
        return appendParams('/(modals)/reviews', { ...params, tab: 'pending' });
      }
      return appendParams('/(modals)/reviews', params);

    case 'courses':
      if (id === 'my-learning') {
        return appendParams('/(modals)/courses', { ...params, tab: 'learning' });
      }
      if (id && detail === 'learn') {
        return appendParams('/(modals)/course-player', { ...params, id });
      }
      return id
        ? appendParams('/(modals)/course-detail', { ...params, id })
        : appendParams('/(modals)/courses', params);

    case 'podcasts':
      if (id && detail) {
        return appendParams('/(modals)/podcast-episode', { ...params, showSlug: id, episodeSlug: detail });
      }
      return id
        ? appendParams('/(modals)/podcast-show', { ...params, slug: id })
        : appendParams('/(modals)/podcasts', params);

    case 'onboarding':
      return appendParams('/(modals)/onboarding', params);

    case 'clubs':
      return appendParams('/(modals)/clubs', params);

    case 'venues':
      if (id === 'checkin' && detail) return appendParams('/(modals)/venue-checkin', { ...params, token: detail });
      return id === 'pass'
        ? appendParams('/(modals)/venue-pass', params)
        : appendParams('/(modals)/venues', params);

    case 'donations':
      return id && detail === 'receipt'
        ? appendParams('/(modals)/donation-receipt', { ...params, id })
        : null;

    case 'saved':
      return appendParams('/(modals)/profile-collections', { ...params, scope: 'saved' });

    case 'skills':
      return appendParams('/(modals)/skills', params);

    case 'endorsements':
      return appendParams('/(modals)/endorsements', params);

    case 'wallet':
      return appendParams('/(modals)/wallet', params);

    case 'achievements':
      return appendParams('/(modals)/achievements', params);

    case 'leaderboard':
      return appendParams('/(modals)/leaderboard', params);

    case 'nexus-score':
      return appendParams('/(modals)/nexus-score', params);

    case 'gamification':
      return appendParams('/(modals)/gamification', params);

    default:
      return null;
  }
}

/**
 * `/marketplace/*` is the largest cluster (24 routes) and the reason seven redirect
 * shims under app/(modals)/ were dead code: they exist purely for deep-link parity
 * and nothing could reach them.
 *
 * Ordering matters. `seller` and the fixed sub-pages are checked BEFORE the
 * `/marketplace/:id` catch-all, or `/marketplace/collections` would be read as a
 * listing whose id is "collections".
 */
function mapMarketplacePath(segments: string[], params: Record<string, string>): string {
  const [first, second, third, fourth] = segments;

  if (!first) return appendParams('/(modals)/marketplace', params);

  if (first === 'seller') {
    if (second === 'dashboard') return appendParams('/(modals)/marketplace-tools', params);
    if (second === 'coupons') {
      if (third === 'new') return appendParams('/(modals)/marketplace-coupon-edit', params);
      if (third && fourth === 'edit') {
        return appendParams('/(modals)/marketplace-coupon-edit', { ...params, id: third });
      }
      return appendParams('/(modals)/marketplace-coupons', params);
    }
    if (second === 'onboard') return appendParams('/(modals)/marketplace-seller-onboarding', params);
    if (second === 'onboarding') return appendParams('/(modals)/marketplace-stripe-onboarding', params);
    if (second === 'pickup-scan') return appendParams('/(modals)/marketplace-pickup-scan', params);
    if (second === 'pickup-slots') return appendParams('/(modals)/marketplace-pickup-slots', params);
    if (second === 'shipping-options') return appendParams('/(modals)/marketplace-shipping-options', params);
    // /marketplace/seller/:id - a public seller storefront.
    return second
      ? appendParams('/(modals)/marketplace-seller', { ...params, id: second })
      : appendParams('/(modals)/marketplace', params);
  }

  if (first === 'orders') {
    return second === 'sales'
      ? appendParams('/(modals)/marketplace-sales-orders', params)
      : appendParams('/(modals)/marketplace-orders', params);
  }

  if (first === 'me' && second === 'pickups') return appendParams('/(modals)/marketplace-pickups', params);
  if (first === 'category' && second) {
    return appendParams('/(modals)/marketplace-category', { ...params, slug: second });
  }

  switch (first) {
    case 'become-partner': return appendParams('/(modals)/marketplace-become-partner', params);
    case 'collections': return appendParams('/(modals)/marketplace-collections', params);
    case 'free': return appendParams('/(modals)/marketplace-free', params);
    case 'map': return appendParams('/(modals)/marketplace-map', params);
    case 'my-listings': return appendParams('/(modals)/marketplace-my-listings', params);
    case 'my-offers': return appendParams('/(modals)/marketplace-offers', params);
    case 'offers': return appendParams('/(modals)/marketplace-offers', params);
    case 'tools': return appendParams('/(modals)/marketplace-tools', params);
    case 'search': return appendParams('/(modals)/marketplace-search', params);
    case 'saved-searches': return appendParams('/(modals)/marketplace-collections', { ...params, tab: 'saved' });
    case 'sell': return appendParams('/(modals)/new-marketplace-listing', params);
    default: break;
  }

  if (isCreateAlias(first)) return appendParams('/(modals)/new-marketplace-listing', params);

  // /marketplace/:id and /marketplace/:id/edit
  if (second === 'edit') {
    return appendParams('/(modals)/edit-marketplace-listing', { ...params, id: first });
  }
  return appendParams('/(modals)/marketplace-detail', { ...params, id: first });
}

/** `/federation/*` - one screen per branch, plus two id-bearing detail routes. */
function mapFederationPath(segments: string[], params: Record<string, string>): string {
  const [branch, id] = segments;

  if (branch === 'members') {
    return id
      ? appendParams('/(modals)/federation-member', { ...params, id })
      : appendParams('/(modals)/federation-members', params);
  }
  if (branch === 'partners') {
    return id
      ? appendParams('/(modals)/federation-partner', { ...params, id })
      : appendParams('/(modals)/federation-partners', params);
  }

  switch (branch) {
    case 'connections': return appendParams('/(modals)/federation-connections', params);
    case 'events': return appendParams('/(modals)/federation-events', params);
    case 'groups': return appendParams('/(modals)/federation-groups', params);
    case 'listings': return appendParams('/(modals)/federation-listings', params);
    case 'messages': return appendParams('/(modals)/federation-messages', params);
    case 'onboarding': return appendParams('/(modals)/federation-onboarding', params);
    case 'settings': return appendParams('/(modals)/federation-settings', params);
    default: return appendParams('/(modals)/federation', params);
  }
}

/**
 * `/feed/*` and `/dashboard` both land on the Home tab; the hashtag and item routes
 * have their own screens. `/feed/item/:type/:id` and `/feed/posts/:id` are two
 * spellings of the same destination.
 */
function mapFeedPath(segments: string[], params: Record<string, string>): string {
  const [branch, second, third] = segments;

  if (branch === 'hashtags') return appendParams('/(modals)/feed-hashtags', params);
  if (branch === 'hashtag' && second) {
    return appendParams('/(modals)/feed-hashtag', { ...params, tag: second });
  }
  if (branch === 'item' && second && third) {
    return appendParams('/(modals)/feed-item-detail', { ...params, type: second, id: third });
  }
  if (branch === 'posts' && second) {
    return appendParams('/(modals)/feed-item-detail', { ...params, type: 'post', id: second });
  }
  return appendParams('/(tabs)/home', params);
}

function parseSystemPath(rawPath: string | null): { section: string; segments: string[]; params: Record<string, string> } | null {
  const trimmed = rawPath?.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes('://') || trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const url = new URL(normalized, 'https://app.project-nexus.ie');
  const isTrustedWebLink = url.protocol === 'https:' && url.hostname === 'app.project-nexus.ie';
  const isTrustedAppLink = url.protocol === 'nexus:';
  if (!isTrustedWebLink && !isTrustedAppLink) return null;

  let pathSegments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (url.protocol === 'nexus:' && url.host && KNOWN_SECTIONS.has(url.host)) {
    pathSegments = [url.host, ...pathSegments];
  }
  if (pathSegments.length === 0) return null;

  let [section, ...segments] = pathSegments;
  if (!KNOWN_SECTIONS.has(section) && pathSegments[1] && KNOWN_SECTIONS.has(pathSegments[1])) {
    section = pathSegments[1];
    segments = pathSegments.slice(2);
  }
  if (!KNOWN_SECTIONS.has(section)) return null;

  return {
    section,
    segments,
    params: Object.fromEntries(url.searchParams.entries()),
  };
}

function mapMessagePath(segments: string[], queryParams: Record<string, string>): string {
  const [branch, detailId] = segments;
  const params = { ...queryParams };
  if (params.context && !params.context_type) {
    params.context_type = params.context;
  }
  delete params.context;

  const queryRecipientId = params.user ?? params.to ?? params.to_user;
  delete params.user;
  delete params.to;
  delete params.to_user;

  if (branch === 'new' && detailId) {
    return appendParams('/(modals)/thread', { ...params, recipientId: detailId });
  }
  if (queryRecipientId) {
    return appendParams('/(modals)/thread', { ...params, recipientId: queryRecipientId });
  }
  if (branch && branch !== 'new') {
    return appendParams('/(modals)/thread', { ...params, id: branch });
  }
  return branch === 'new' ? appendParams('/(modals)/new-message', params) : appendParams('/(tabs)/messages', params);
}

function appendParams(pathname: string, params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function isCreateAlias(value: string | undefined): boolean {
  return value === 'new' || value === 'create';
}

function supportDocumentForSection(section: string): string {
  return section === 'trust-and-safety' ? 'trust' : section;
}
