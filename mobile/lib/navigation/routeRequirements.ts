// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TenantConfig } from '@/lib/api/tenant';

/**
 * Which community switch each native screen depends on.
 *
 * 🔴 Why this table exists. The React app wraps every module route in a `FeatureGate`
 * (about 150 of them in `react-frontend/src/routes/AppRoutes.tsx`). Until 2026-09-07 the
 * native app gated only its MENUS plus five authoring screens, so a deep link, a push
 * notification, a shared URL or a screen pushed from another screen reached a module the
 * community had switched off. Hiding a menu entry was never a gate.
 *
 * This is the single source of truth for three consumers, so they cannot disagree:
 *
 * - `components/withRouteGate.tsx` wraps every screen's default export and refuses the
 *   screen when its requirement is off;
 * - `app/(tabs)/_layout.tsx` hides a tab whose module is off;
 * - `lib/navigation/tenantCapabilityStore.ts` decides whether a deep link or push tap may
 *   open the route at all.
 *
 * `app/routeGating.test.ts` enforces that every screen file under `app/(modals)` and
 * `app/(tabs)` is either listed here or listed in `UNGATED_ROUTES` with a reason, and that
 * every listed screen actually calls `withRouteGate` with its own name.
 *
 * Keys are the route file name without extension (`event-detail`, not
 * `/(modals)/event-detail`). Values follow the React gates; where React and the native
 * menus disagreed the choice is written next to the entry.
 */
export interface RouteRequirement {
  /** Tenant feature flags (`TenantFeatureConfig::FEATURE_DEFAULTS`); every one must be on. */
  features?: readonly string[];
  /** Tenant core modules (`TenantFeatureConfig::MODULE_DEFAULTS`); every one must be on. */
  modules?: readonly string[];
}

const F = (...features: string[]): RouteRequirement => ({ features });
const M = (...modules: string[]): RouteRequirement => ({ modules });

export const ROUTE_REQUIREMENTS: Readonly<Record<string, RouteRequirement>> = {
  // ---- tabs -------------------------------------------------------------------------
  // `home` is deliberately absent: it is the anchor every redirect lands on, so hiding
  // or refusing it would leave a community with no first screen. It gates its own
  // feed/dashboard sections instead (see UNGATED_ROUTES).
  exchanges: M('listings'),
  messages: M('messages'),
  events: F('events'),
  groups: F('groups'),
  members: F('connections'),
  explore: F('explore'),
  search: F('search'),

  // ---- gamification -----------------------------------------------------------------
  gamification: F('gamification'),
  achievements: F('gamification'),
  leaderboard: F('gamification'),
  'nexus-score': F('gamification'),

  // ---- profile module ---------------------------------------------------------------
  'member-profile': M('profile'),
  'edit-profile': M('profile'),
  'profile-collections': M('profile'),
  appreciations: M('profile'),

  // ---- blog / resources -------------------------------------------------------------
  blog: F('blog'),
  'blog-post': F('blog'),
  resources: F('resources'),
  'kb-article': F('resources'),

  // ---- messaging (React gates on the module; the native deep-link store also requires
  //      the direct_messaging feature, and a community that switches direct messaging
  //      off has switched off exactly these screens) --------------------------------
  thread: { features: ['direct_messaging'], modules: ['messages'] },
  'new-message': { features: ['direct_messaging'], modules: ['messages'] },
  chat: F('ai_chat'),

  // ---- listings and the exchange workflow -------------------------------------------
  'exchange-detail': M('listings'),
  'new-exchange': M('listings'),
  'edit-exchange': M('listings'),
  matches: M('listings'),
  'match-preferences': M('listings'),
  'exchange-requests': { features: ['exchange_workflow'], modules: ['listings'] },
  'exchange-request-detail': { features: ['exchange_workflow'], modules: ['listings'] },

  // ---- wallet -----------------------------------------------------------------------
  wallet: M('wallet'),
  'wallet-transaction': M('wallet'),

  // ---- feed -------------------------------------------------------------------------
  'new-post': M('feed'),
  'feed-item-detail': M('feed'),
  'feed-hashtag': M('feed'),
  'feed-hashtags': M('feed'),
  polls: F('polls'),

  // ---- events -----------------------------------------------------------------------
  'event-detail': F('events'),
  'new-event': F('events'),
  'edit-event': F('events'),
  'event-attendance': F('events'),
  'event-communications': F('events'),
  'event-lifecycle-history': F('events'),
  'event-manage': F('events'),
  'event-recurrence-blueprints': F('events'),
  'event-templates': F('events'),
  'event-tickets': F('events'),

  // ---- groups -----------------------------------------------------------------------
  'group-detail': F('groups'),
  'new-group': F('groups'),
  'edit-group': F('groups'),
  'group-invite': F('groups'),
  'group-exchanges': F('group_exchanges'),
  'group-exchange-detail': F('group_exchanges'),
  'new-group-exchange': F('group_exchanges'),

  // ---- connections ------------------------------------------------------------------
  connections: F('connections'),

  // ---- volunteering and organisations (React gates organisations behind volunteering;
  //      the platform has a dedicated `organisations` flag and the native More menu
  //      already uses it, so that flag is the one honoured here) ---------------------
  volunteering: F('volunteering'),
  'volunteering-detail': F('volunteering'),
  'volunteering-org-dashboard': F('volunteering'),
  'new-volunteering': F('volunteering'),
  'edit-volunteering': F('volunteering'),
  'volunteer-checkin': F('volunteering'),
  'donation-receipt': F('volunteering'),
  organisations: F('organisations'),
  'organisation-detail': F('organisations'),
  'new-organisation': F('organisations'),

  // ---- jobs -------------------------------------------------------------------------
  jobs: F('job_vacancies'),
  'job-detail': F('job_vacancies'),
  'job-analytics': F('job_vacancies'),
  'job-pipeline': F('job_vacancies'),
  'new-job': F('job_vacancies'),
  'edit-job': F('job_vacancies'),

  // ---- courses and podcasts ---------------------------------------------------------
  courses: F('courses'),
  'course-detail': F('courses'),
  'course-player': F('courses'),
  'course-instructor': F('courses'),
  'course-analytics': F('courses'),
  'course-grading': F('courses'),
  'new-course': F('courses'),
  podcasts: F('podcasts'),
  'podcast-show': F('podcasts'),
  'podcast-episode': F('podcasts'),
  'podcast-studio': F('podcasts'),

  // ---- marketplace ------------------------------------------------------------------
  marketplace: F('marketplace'),
  'marketplace-detail': F('marketplace'),
  'marketplace-category': F('marketplace'),
  'marketplace-collections': F('marketplace'),
  'marketplace-free': F('marketplace'),
  'marketplace-map': F('marketplace'),
  'marketplace-search': F('marketplace'),
  'marketplace-saved-searches': F('marketplace'),
  'marketplace-seller': F('marketplace'),
  'marketplace-my-listings': F('marketplace'),
  'marketplace-offers': F('marketplace'),
  'marketplace-order': F('marketplace'),
  'marketplace-orders': F('marketplace'),
  'marketplace-sales-orders': F('marketplace'),
  'marketplace-pickups': F('marketplace'),
  'marketplace-pickup-slots': F('marketplace'),
  'marketplace-pickup-scan': F('marketplace'),
  'marketplace-promotions': F('marketplace'),
  'marketplace-shipping-options': F('marketplace'),
  'marketplace-tools': F('marketplace'),
  'marketplace-become-partner': F('marketplace'),
  'marketplace-merchant-onboarding': F('marketplace'),
  'marketplace-seller-onboarding': F('marketplace'),
  'marketplace-stripe-onboarding': F('marketplace'),
  'new-marketplace-listing': F('marketplace'),
  'edit-marketplace-listing': F('marketplace'),
  'marketplace-coupons': F('marketplace', 'merchant_coupons'),
  'marketplace-coupon-detail': F('marketplace', 'merchant_coupons'),
  'marketplace-coupon-edit': F('marketplace', 'merchant_coupons'),
  'marketplace-coupon-redemptions': F('marketplace', 'merchant_coupons'),

  // ---- goals, ideation, reviews -----------------------------------------------------
  goals: F('goals'),
  'goal-detail': F('goals'),
  ideation: F('ideation_challenges'),
  'ideation-detail': F('ideation_challenges'),
  'ideation-idea': F('ideation_challenges'),
  'ideation-campaigns': F('ideation_challenges'),
  'ideation-campaign-detail': F('ideation_challenges'),
  'ideation-outcomes': F('ideation_challenges'),
  'new-challenge': F('ideation_challenges'),
  reviews: F('reviews'),

  // ---- federation -------------------------------------------------------------------
  federation: F('federation'),
  'federation-connections': F('federation'),
  'federation-events': F('federation'),
  'federation-groups': F('federation'),
  'federation-listings': F('federation'),
  'federation-member': F('federation'),
  'federation-members': F('federation'),
  'federation-messages': F('federation'),
  'federation-onboarding': F('federation'),
  'federation-partner': F('federation'),
  'federation-partners': F('federation'),
  'federation-settings': F('federation'),

  // ---- venues, identity, settings, notifications -----------------------------------
  venues: F('partner_venues'),
  'venue-pass': F('partner_venues'),
  'venue-checkin': F('partner_venues'),
  'verify-identity': F('identity_verification'),
  settings: M('settings'),
  notifications: M('notifications'),
};

/**
 * Screens that deliberately have no community switch. Each needs a reason, and the reason
 * is checked by a reader, not a machine — so keep it honest. Matches React, where these
 * routes are also rendered without a `FeatureGate`.
 */
export const UNGATED_ROUTES: Readonly<Record<string, string>> = {
  // tabs
  home: 'Anchor tab every redirect lands on; it gates its own feed and dashboard sections per module.',
  profile: 'The More screen is the navigation hub; it hides its own entries per module.',
  create: 'Tab placeholder — the tab press is intercepted and opens quick-create.',
  // modals
  'quick-create': 'Menu of create actions; hides its own entries per module.',
  activity: 'Personal activity log — core account surface, ungated in React.',
  clubs: 'Clubs are ungated in React (no feature flag exists for them).',
  endorsements: 'Skills and endorsements are ungated in React.',
  skills: 'Alias of endorsements.',
  'help-faqs': 'Support content must stay reachable regardless of modules.',
  support: 'Support hub must stay reachable regardless of modules.',
  'static-page': 'About/contact pages — public content.',
  'legal-acceptance': 'A legal refusal must be resolvable whatever is switched on.',
  'legal-document': 'Legal documents must always be readable.',
  'image-viewer': 'Presentation-only lightbox for images already on screen.',
  onboarding: 'First-run onboarding — precedes any module use.',
  'change-password': 'Account security is never optional.',
  'settings-blocked-users': 'Safety control; React leaves it ungated too.',
  'settings-data-export': 'GDPR right of access — must always be reachable.',
  'settings-delete-account': 'GDPR right of erasure — must always be reachable.',
  'settings-linked-accounts': 'Account relationships are an account surface, not a module.',
  'settings-translation': 'Personal language preference — always available.',
};

/** Route name from a native href such as `/(modals)/event-detail?id=3` or `/(tabs)/events`. */
export function routeNameFromHref(href: string): string | null {
  const match = href.match(/^\/?\((?:modals|tabs|auth)\)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

export function requirementForRoute(routeName: string): RouteRequirement | null {
  return ROUTE_REQUIREMENTS[routeName] ?? null;
}

type CapabilitySnapshot = Pick<TenantConfig, 'features' | 'modules'>;

/**
 * Whether a screen may be shown for the given community configuration.
 *
 * 🔴 A missing snapshot (`null`) means UNKNOWN, and unknown allows. The snapshot is null
 * for the first moments of a cold start and for an offline start with no cached config.
 * Refusing then would turn a slow network into "every module is switched off" — and a
 * push notification tapped on the train would land on a refusal for a module the
 * community has. Only an explicit configuration can refuse.
 *
 * A configured community that omits a key is treated as OFF, matching React's
 * `features[feature] ?? false` — the API always sends every known key, so an absent key
 * is a flag this build knows about and the server does not.
 */
export function isRouteAllowed(snapshot: CapabilitySnapshot | null | undefined, routeName: string): boolean {
  if (!snapshot) return true;
  const requirement = requirementForRoute(routeName);
  if (!requirement) return true;
  const featuresOn = (requirement.features ?? []).every((key) => snapshot.features?.[key] === true);
  const modulesOn = (requirement.modules ?? []).every((key) => snapshot.modules?.[key] === true);
  return featuresOn && modulesOn;
}
