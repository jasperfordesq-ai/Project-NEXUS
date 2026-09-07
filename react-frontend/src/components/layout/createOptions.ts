// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The canonical list of "start something new" actions.
 *
 * 🔴 Owner's report, 2026-09-06: the header "+" offered four things while the
 * native app's Create screen offered fourteen. The two lists had been edited
 * independently for months, so a member who used both saw a different platform
 * depending on which one they opened.
 *
 * There is now ONE list, and every create surface renders it:
 *   - `Navbar` — the desktop header "+" dropdown (grouped into sections)
 *   - `QuickCreateMenu` — the phone/tablet tab-bar sheet (flat grid)
 *
 * Adding an option here adds it to both. Do not reintroduce a second list.
 *
 * Every `href` is a BUILDER, not an index page: the point of this menu is to
 * start something, so landing a member on a list they then have to hunt for a
 * button on is the failure this list exists to prevent. Where a module has no
 * dedicated builder route, its index page takes a query flag that opens the
 * composer (`/feed?compose=post`, `/polls?create=1`, `/messages?compose=1`) —
 * the same shape the native app already uses for polls.
 *
 * 🔴 Every gate below matches the gate on the DESTINATION ROUTE in
 * `AppRoutes.tsx`, not the one that reads best. Two are easy to get wrong:
 *   - `organisations/register` requires both volunteering and organisations.
 *   - `listings/create` is a MODULE gate, not a feature gate.
 * An option whose gate is looser than its route's sends the member to a
 * "coming soon" page or bounces them to the dashboard, which reads as broken.
 */

import ListTodo from 'lucide-react/icons/list-todo';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Target from 'lucide-react/icons/target';
import Heart from 'lucide-react/icons/heart';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import Podcast from 'lucide-react/icons/podcast';
import SquarePen from 'lucide-react/icons/square-pen';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import MessageSquarePlus from 'lucide-react/icons/message-square-plus';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Briefcase from 'lucide-react/icons/briefcase';
import HandHeart from 'lucide-react/icons/hand-heart';
import Building2 from 'lucide-react/icons/building-2';

import type { TenantFeatures, TenantModules } from '@/types/api';

/** Section headings, in the order the header dropdown renders them. */
export type CreateOptionSection = 'share' | 'timebank' | 'community' | 'opportunities' | 'learning';

export const CREATE_SECTION_ORDER: CreateOptionSection[] = [
  'share',
  'timebank',
  'community',
  'opportunities',
  'learning',
];

/** `common` namespace key for each section heading. */
export const CREATE_SECTION_LABEL_KEYS: Record<CreateOptionSection, string> = {
  share: 'create.section.share',
  timebank: 'create.section.timebank',
  community: 'create.section.community',
  opportunities: 'create.section.opportunities',
  learning: 'create.section.learning',
};

export interface CreateOptionDef {
  /** Short label — one row of the header dropdown. */
  labelKey: string;
  /** One-line explanation — the tab-bar grid tile. */
  descKey: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Gradient used by the tab-bar grid tiles. */
  color: string;
  section: CreateOptionSection;
  feature?: keyof TenantFeatures;
  features?: readonly (keyof TenantFeatures)[];
  module?: keyof TenantModules;
  /**
   * Server-resolved capability beyond the feature switch. Only Events has one:
   * a community may restrict event creation to brokers/admins while the
   * `events` feature stays on for everyone.
   */
  requiresEventPermission?: boolean;
}

const createOptionDefs: CreateOptionDef[] = [
  {
    labelKey: 'quick_create.new_post',
    descKey: 'quick_create.new_post_desc',
    href: '/feed?compose=post',
    icon: SquarePen,
    color: 'from-sky-500 to-blue-600',
    section: 'share',
    module: 'feed',
  },
  {
    labelKey: 'quick_create.new_poll',
    descKey: 'quick_create.new_poll_desc',
    href: '/polls?create=1',
    icon: BarChart3,
    color: 'from-violet-500 to-fuchsia-700',
    section: 'share',
    feature: 'polls',
  },
  {
    labelKey: 'quick_create.new_message',
    descKey: 'quick_create.new_message_desc',
    href: '/messages?compose=1',
    icon: MessageSquarePlus,
    color: 'from-cyan-500 to-sky-600',
    section: 'share',
    // 🔴 BOTH gates are required. The route is module-gated, but the "New
    // message" button on that page is additionally disabled when the
    // `direct_messaging` feature is off — so the module gate alone would offer
    // an action that dead-ends on a disabled button.
    module: 'messages',
    feature: 'direct_messaging',
  },
  {
    labelKey: 'quick_create.new_listing',
    descKey: 'quick_create.new_listing_desc',
    href: '/listings/create',
    icon: ListTodo,
    color: 'from-emerald-500 to-teal-600',
    section: 'timebank',
    module: 'listings',
  },
  {
    labelKey: 'quick_create.new_marketplace_listing',
    descKey: 'quick_create.new_marketplace_listing_desc',
    href: '/marketplace/sell',
    icon: ShoppingBag,
    color: 'from-green-500 to-emerald-600',
    section: 'community',
    feature: 'marketplace',
  },
  {
    labelKey: 'quick_create.offer_time',
    descKey: 'quick_create.offer_time_desc',
    href: '/caring-community',
    icon: Heart,
    color: 'from-teal-500 to-emerald-600',
    section: 'timebank',
    feature: 'caring_community',
  },
  {
    labelKey: 'quick_create.new_event',
    descKey: 'quick_create.new_event_desc',
    href: '/events/create',
    icon: Calendar,
    color: 'from-amber-500 to-orange-600',
    section: 'community',
    feature: 'events',
    requiresEventPermission: true,
  },
  {
    labelKey: 'quick_create.new_group',
    descKey: 'quick_create.new_group_desc',
    href: '/groups/create',
    icon: Users,
    color: 'from-accent to-pink-600',
    section: 'community',
    feature: 'groups',
  },
  {
    labelKey: 'quick_create.new_challenge',
    descKey: 'quick_create.new_challenge_desc',
    href: '/ideation/create',
    icon: Lightbulb,
    color: 'from-yellow-500 to-amber-600',
    section: 'community',
    feature: 'ideation_challenges',
  },
  {
    labelKey: 'quick_create.new_goal',
    descKey: 'quick_create.new_goal_desc',
    href: '/goals',
    icon: Target,
    color: 'from-blue-500 to-cyan-600',
    section: 'community',
    feature: 'goals',
  },
  {
    labelKey: 'quick_create.new_job',
    descKey: 'quick_create.new_job_desc',
    href: '/jobs/create',
    icon: Briefcase,
    color: 'from-cyan-600 to-blue-700',
    section: 'opportunities',
    feature: 'job_vacancies',
  },
  {
    labelKey: 'quick_create.new_volunteering',
    descKey: 'quick_create.new_volunteering_desc',
    href: '/volunteering/create',
    icon: HandHeart,
    color: 'from-emerald-600 to-green-700',
    section: 'opportunities',
    feature: 'volunteering',
  },
  {
    // Organisation pages consume volunteering APIs, so both switches apply.
    labelKey: 'quick_create.new_organisation',
    features: ['organisations'],
    descKey: 'quick_create.new_organisation_desc',
    href: '/organisations/register',
    icon: Building2,
    color: 'from-slate-500 to-violet-600',
    section: 'opportunities',
    feature: 'volunteering',
  },
  {
    labelKey: 'quick_create.new_course',
    descKey: 'quick_create.new_course_desc',
    href: '/courses/instructor/new',
    icon: GraduationCap,
    color: 'from-violet-500 to-fuchsia-600',
    section: 'learning',
    feature: 'courses',
  },
  {
    labelKey: 'quick_create.new_podcast',
    descKey: 'quick_create.new_podcast_desc',
    href: '/podcasts/studio',
    icon: Podcast,
    color: 'from-rose-500 to-pink-600',
    section: 'learning',
    feature: 'podcasts',
  },
];

/**
 * @param canCreateEvent Server-resolved: a community may restrict Event creation
 *   to brokers/admins even while the `events` feature is on. Defaults to true so
 *   existing callers and tests are unaffected.
 */
export function getVisibleCreateOptions(
  hasFeature: (feature: keyof TenantFeatures) => boolean,
  hasModule: (module: keyof TenantModules) => boolean,
  canCreateEvent = true,
): CreateOptionDef[] {
  return createOptionDefs.filter((option) => {
    if (option.feature && !hasFeature(option.feature)) return false;
    if (option.features && !option.features.every(hasFeature)) return false;
    if (option.module && !hasModule(option.module)) return false;
    if (option.requiresEventPermission && !canCreateEvent) return false;
    return true;
  });
}

/**
 * The same options bucketed into their sections, with empty sections dropped —
 * so a community with every Community feature off never renders a "Community"
 * heading with nothing under it.
 */
export function groupCreateOptions(
  options: CreateOptionDef[],
): Array<{ section: CreateOptionSection; options: CreateOptionDef[] }> {
  return CREATE_SECTION_ORDER.map((section) => ({
    section,
    options: options.filter((option) => option.section === section),
  })).filter((group) => group.options.length > 0);
}
