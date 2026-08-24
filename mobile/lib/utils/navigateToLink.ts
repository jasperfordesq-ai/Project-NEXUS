// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { router, type Href } from 'expo-router';
import { reportMessage, safeLinkSummary } from '@/lib/observability/report';

const knownSections = new Set([
  'exchanges',
  'listings',
  'events',
  'members',
  'profile',
  'users',
  'me',
  'messages',
  'blog',
  'blog-post',
  'resources',
  'kb',
  'help',
  'support',
  'about',
  'contact',
  'terms',
  'privacy',
  'cookies',
  'accessibility',
  'trust',
  'groups',
  'jobs',
  'job',
  'marketplace',
  'organisations',
  'organizations',
  'organisation',
  'organization',
  'volunteering',
  'goals',
  'activity',
  'matches',
  'reviews',
  'skills',
  'polls',
  'endorsements',
  'leaderboard',
  'achievements',
  'nexus-score',
  'ideation',
  'gamification',
  'federation',
  'wallet',
  'notifications',
  'chat',
  'search',
]);

/**
 * Maps a web-format deep-link (e.g. /exchanges/123) to the appropriate
 * mobile screen and navigates to it.
 *
 * 🔴 **This function must carry the link's query string.** It dropped it, and that made
 * every parameterised deep link fail on a COLD START while looking correct everywhere else.
 *
 * What was measured on a device on 2026-08-24, after a probe printed the screen's own
 * parameters: opening `volunteering?tab=donations` from a cold start produced **two**
 * volunteering screens. `app/+native-intent.ts` mapped the URL correctly and expo-router
 * mounted `/(modals)/volunteering?tab=donations` — the log shows that instance with
 * `activeTab=donations`. Then `_layout.tsx` replayed the same link through this function
 * once auth resolved, and this function pushed a bare `/(modals)/volunteering`, which
 * landed **on top**. The member saw the paramless copy. The link, the mapper, the screen
 * and the hook were all correct; the second navigation threw the parameter away.
 *
 * It read as "deep links ignore `?tab=`" and was recorded that way (journey 7.2), and the
 * same loss applies to every query a link can carry — a filter, `create=1`, a marketplace
 * category — not just tabs. The replay itself is deliberate and stays: a cold start while
 * signed out has to reach the login screen first and follow the link afterwards.
 *
 * So: a section-index push passes the parsed query, and a detail push passes it too with
 * the id from the PATH last, so a `?id=` in a link can never override the record actually
 * being opened.
 */
export function navigateToLink(link: string | null): void {
  if (!link) return;
  const parsed = parseLink(link);
  if (!parsed) return;
  const { section, segments, params } = parsed;
  const [id] = segments;
  switch (section) {
    // See the note in `app/+native-intent.ts`: an exchange request and a listing are
    // different records with different ids, and sharing this case sent every exchange
    // notification to the listing screen, which answered "Listing not found".
    case 'exchanges':
      if (id) router.push({ pathname: '/(modals)/exchange-request-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/exchange-requests', params);
      break;
    case 'listings':
      if (id) router.push({ pathname: '/(modals)/exchange-detail', params: { ...params, id } });
      else router.replace('/(tabs)/exchanges');
      break;
    case 'events':
      if (id) router.push({ pathname: '/(modals)/event-detail', params: { ...params, id } });
      else router.replace('/(tabs)/events');
      break;
    case 'members':
      if (id) router.push({ pathname: '/(modals)/member-profile', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/members', params);
      break;
    case 'profile':
      if (id) router.push({ pathname: '/(modals)/member-profile', params: { ...params, id } });
      else pushWithOptionalParams('/(tabs)/profile', params);
      break;
    case 'users':
      if (id && segments[1] === 'appreciations') {
        router.push({ pathname: '/(modals)/appreciations', params: { userId: id } } as unknown as Href);
      } else if (id && segments[1] === 'collections') {
        router.push({ pathname: '/(modals)/profile-collections', params: { userId: id, scope: 'public' } } as unknown as Href);
      } else if (id) {
        router.push({ pathname: '/(modals)/member-profile', params: { ...params, id } });
      } else {
        pushWithOptionalParams('/(modals)/members', params);
      }
      break;
    case 'me':
      if (id === 'collections') {
        router.push({
          pathname: '/(modals)/profile-collections',
          params: segments[1] ? { collectionId: segments[1] } : {},
        } as unknown as Href);
      }
      break;
    case 'messages':
      navigateMessages(segments, params);
      break;
    case 'blog':
    case 'blog-post':
      if (id) router.push({ pathname: '/(modals)/blog-post', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/blog', params);
      break;
    case 'resources':
      pushWithOptionalParams('/(modals)/resources', id ? { ...params, category: id } : params);
      break;
    case 'kb':
      if (id) router.push({ pathname: '/(modals)/kb-article', params: { id, ...params } } as unknown as Href);
      else pushWithOptionalParams('/(modals)/resources', { ...params, tab: 'kb' });
      break;
    case 'help':
    case 'support':
      pushWithOptionalParams('/(modals)/support', params);
      break;
    case 'about':
    case 'contact':
    case 'terms':
    case 'privacy':
    case 'cookies':
    case 'accessibility':
    case 'trust':
      pushWithOptionalParams('/(modals)/support', { ...params, doc: section });
      break;
    case 'groups':
      if (id) router.push({ pathname: '/(modals)/group-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/groups', params);
      break;
    case 'jobs':
      if (id) router.push({ pathname: '/(modals)/job-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/jobs', params);
      break;
    case 'job':
      if (id) router.push({ pathname: '/(modals)/job-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/jobs', params);
      break;
    case 'marketplace':
      navigateMarketplace(segments, params);
      break;
    case 'organisations':
    case 'organizations':
      if (id) router.push({ pathname: '/(modals)/organisation-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/organisations', params);
      break;
    case 'organisation':
    case 'organization':
      if (id) router.push({ pathname: '/(modals)/organisation-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/organisations', params);
      break;
    case 'volunteering':
      if (id === 'my-organisations') {
        router.push({ pathname: '/(modals)/volunteering', params: { tab: 'organisations' } } as unknown as Href);
      } else if (id === 'org' && segments[1]) {
        router.push({
          pathname: '/(modals)/volunteering-org-dashboard',
          params: { id: segments[1], tab: params.tab ?? (segments[2] === 'dashboard' && segments[3] ? segments[3] : undefined) },
        } as unknown as Href);
      } else if (id) router.push({ pathname: '/(modals)/volunteering-detail', params: { ...params, id } });
      else pushWithOptionalParams('/(modals)/volunteering', params);
      break;
    case 'goals':
      if (id) router.push({ pathname: '/(modals)/goal-detail', params: { ...params, id } } as unknown as Href);
      else pushWithOptionalParams('/(modals)/goals', params);
      break;
    case 'activity':
      pushWithOptionalParams('/(modals)/activity', params);
      break;
    case 'matches':
      pushWithOptionalParams('/(modals)/matches', params);
      break;
    case 'reviews':
      pushWithOptionalParams('/(modals)/reviews', params);
      break;
    case 'skills':
      pushWithOptionalParams('/(modals)/skills', params);
      break;
    case 'polls':
      pushWithOptionalParams('/(modals)/polls', params);
      break;
    case 'endorsements':
      pushWithOptionalParams('/(modals)/endorsements', params);
      break;
    case 'leaderboard':
      router.push({ pathname: '/(modals)/gamification', params: { tab: 'leaderboard', ...params } } as unknown as Href);
      break;
    case 'achievements':
      router.push({ pathname: '/(modals)/gamification', params: { tab: 'badges', ...params } } as unknown as Href);
      break;
    case 'nexus-score':
      router.push({ pathname: '/(modals)/gamification', params: { tab: 'score', ...params } } as unknown as Href);
      break;
    case 'ideation':
      if (id) router.push({ pathname: '/(modals)/ideation-detail', params: { ...params, id } } as unknown as Href);
      else pushWithOptionalParams('/(modals)/ideation', params);
      break;
    case 'gamification':
      pushWithOptionalParams('/(modals)/gamification', params);
      break;
    case 'federation':
      navigateFederation(segments, params);
      break;
    case 'wallet':
      pushWithOptionalParams('/(modals)/wallet', params);
      break;
    case 'notifications':
      pushWithOptionalParams('/(modals)/notifications', params);
      break;
    case 'chat':
      pushWithOptionalParams('/(modals)/chat', params);
      break;
    case 'search':
      pushWithOptionalParams('/(modals)/search', params);
      break;
    default:
      // 🔴 Two separate faults were fixed on this one line.
      //
      // 1. It reported ONLY to Sentry, which has no DSN in any of the six build
      //    profiles — so the app's single diagnostic about links it cannot handle
      //    went nowhere at all. It now also reaches our own server log, which needs
      //    no account. See lib/observability/report.ts.
      //
      // 2. It sent the WHOLE url. One of the links this app handles is a
      //    password-reset link, and the reset token is in that url — so a member
      //    tapping a slightly wrong reset link would have shipped a live credential
      //    to a third-party service. `safeLinkSummary` reduces it to origin plus the
      //    first path segment, which is the part that is actually diagnostic.
      reportMessage(
        '[DeepLink] Unhandled link',
        { link: safeLinkSummary(link), section },
        `deeplink-unhandled:${section}`
      );
      break;
  }
}

function parseLink(link: string): { section: string; segments: string[]; params: Record<string, string> } | null {
  let url: URL;
  try {
    url = new URL(link, 'https://app.project-nexus.ie');
  } catch {
    return null;
  }
  const isTrustedWebLink = url.protocol === 'https:' && url.hostname === 'app.project-nexus.ie';
  const isTrustedAppLink = url.protocol === 'nexus:';
  if (!isTrustedWebLink && !isTrustedAppLink) return null;

  const pathSegments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (pathSegments.length === 0) return null;

  let [section, ...segments] = pathSegments;
  if (!knownSections.has(section) && pathSegments[1] && knownSections.has(pathSegments[1])) {
    section = pathSegments[1];
    segments = pathSegments.slice(2);
  }

  return {
    section,
    segments,
    params: Object.fromEntries(url.searchParams.entries()),
  };
}

function navigateMarketplace(segments: string[], queryParams: Record<string, string>): void {
  const [branch, detailId] = segments;
  if (!branch) {
    pushWithOptionalParams('/(modals)/marketplace', queryParams);
    return;
  }

  switch (branch) {
    case 'search':
      pushWithOptionalParams('/(modals)/marketplace-search', queryParams);
      break;
    case 'map':
      pushWithOptionalParams('/(modals)/marketplace-map', queryParams);
      break;
    case 'category':
    case 'categories':
      if (detailId) {
        router.push({ pathname: '/(modals)/marketplace-category', params: { id: detailId, ...queryParams } } as unknown as Href);
      } else {
        pushWithOptionalParams('/(modals)/marketplace', queryParams);
      }
      break;
    case 'seller':
    case 'sellers':
      if (detailId) {
        router.push({ pathname: '/(modals)/marketplace-seller', params: { id: detailId, ...queryParams } } as unknown as Href);
      } else {
        pushWithOptionalParams('/(modals)/marketplace', queryParams);
      }
      break;
    case 'orders':
      pushWithOptionalParams('/(modals)/marketplace-orders', queryParams);
      break;
    case 'offers':
      pushWithOptionalParams('/(modals)/marketplace-offers', queryParams);
      break;
    case 'tools':
      pushWithOptionalParams('/(modals)/marketplace-tools', queryParams);
      break;
    case 'saved-searches':
      pushWithOptionalParams('/(modals)/marketplace-tools', { ...queryParams, tab: 'savedSearches' });
      break;
    case 'collections':
      pushWithOptionalParams('/(modals)/marketplace-collections', queryParams);
      break;
    case 'new':
    case 'create':
      pushWithOptionalParams('/(modals)/new-marketplace-listing', queryParams);
      break;
    default:
      router.push({ pathname: '/(modals)/marketplace-detail', params: { id: branch, ...queryParams } } as unknown as Href);
      break;
  }
}

function navigateFederation(segments: string[], queryParams: Record<string, string>): void {
  const [branch, detailId] = segments;
  if (!branch) {
    pushWithOptionalParams('/(modals)/federation', queryParams);
    return;
  }

  switch (branch) {
    case 'partners':
      if (detailId) {
        router.push({ pathname: '/(modals)/federation-partner', params: { id: detailId } });
      } else {
        pushWithOptionalParams('/(modals)/federation-partners', queryParams);
      }
      break;
    case 'members':
      if (detailId) {
        router.push({ pathname: '/(modals)/federation-member', params: { id: detailId, ...queryParams } } as unknown as Href);
      } else {
        pushWithOptionalParams('/(modals)/federation-members', queryParams);
      }
      break;
    case 'messages':
      pushWithOptionalParams('/(modals)/federation-messages', queryParams);
      break;
    case 'listings':
      pushWithOptionalParams('/(modals)/federation-listings', queryParams);
      break;
    case 'groups':
      pushWithOptionalParams('/(modals)/federation-groups', queryParams);
      break;
    case 'events':
      pushWithOptionalParams('/(modals)/federation-events', queryParams);
      break;
    case 'settings':
      pushWithOptionalParams('/(modals)/federation-settings', queryParams);
      break;
    case 'onboarding':
      pushWithOptionalParams('/(modals)/federation-onboarding', queryParams);
      break;
    case 'connections':
      pushWithOptionalParams('/(modals)/federation-connections', queryParams);
      break;
    default:
      router.push({ pathname: '/(modals)/federation-partner', params: { id: branch, ...queryParams } });
      break;
  }
}

function navigateMessages(segments: string[], queryParams: Record<string, string>): void {
  const [branch, detailId] = segments;
  const params = normalizeMessageParams(queryParams);
  const queryRecipientId = params.user ?? params.to ?? params.to_user;
  delete params.user;
  delete params.to;
  delete params.to_user;

  if (branch === 'new' && detailId) {
    router.push({ pathname: '/(modals)/thread', params: { recipientId: detailId, ...params } });
    return;
  }

  if (queryRecipientId) {
    router.push({ pathname: '/(modals)/thread', params: { recipientId: queryRecipientId, ...params } });
    return;
  }

  if (branch) {
    router.push({ pathname: '/(modals)/thread', params: { id: branch, ...params } });
    return;
  }

  pushWithOptionalParams('/(tabs)/messages', params);
}

function normalizeMessageParams(queryParams: Record<string, string>): Record<string, string> {
  const params = { ...queryParams };
  if (params.context && !params.context_type) {
    params.context_type = params.context;
  }
  delete params.context;
  return params;
}

function pushWithOptionalParams(pathname: string, params: Record<string, string>): void {
  if (Object.keys(params).length > 0) {
    router.push({ pathname, params } as unknown as Href);
  } else {
    router.push(pathname as Href);
  }
}
