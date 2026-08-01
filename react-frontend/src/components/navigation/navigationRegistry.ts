// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import Activity from 'lucide-react/icons/activity';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import BarChart3 from 'lucide-react/icons/chart-column';
import Blog from 'lucide-react/icons/book-open';
import Bookmark from 'lucide-react/icons/bookmark';
import Bot from 'lucide-react/icons/bot';
import Briefcase from 'lucide-react/icons/briefcase';
import Building2 from 'lucide-react/icons/building-2';
import Calendar from 'lucide-react/icons/calendar';
import Compass from 'lucide-react/icons/compass';
import Cookie from 'lucide-react/icons/cookie';
import Crown from 'lucide-react/icons/crown';
import FileText from 'lucide-react/icons/file-text';
import FolderOpen from 'lucide-react/icons/folder-open';
import Globe from 'lucide-react/icons/globe';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import Handshake from 'lucide-react/icons/handshake';
import Heart from 'lucide-react/icons/heart';
import Store from 'lucide-react/icons/store';
import HelpCircle from 'lucide-react/icons/circle-help';
import Home from 'lucide-react/icons/house';
import Info from 'lucide-react/icons/info';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Lightbulb from 'lucide-react/icons/lightbulb';
import ListTodo from 'lucide-react/icons/list-todo';
import Medal from 'lucide-react/icons/medal';
import MessageSquare from 'lucide-react/icons/message-square';
import Newspaper from 'lucide-react/icons/newspaper';
import Podcast from 'lucide-react/icons/podcast';
import Settings from 'lucide-react/icons/settings';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Sparkles from 'lucide-react/icons/sparkles';
import Stethoscope from 'lucide-react/icons/stethoscope';
import Target from 'lucide-react/icons/target';
import TrendingUp from 'lucide-react/icons/trending-up';
import Trophy from 'lucide-react/icons/trophy';
import Users from 'lucide-react/icons/users';
import Users2 from 'lucide-react/icons/users-round';
import Wallet from 'lucide-react/icons/wallet';
import { CARING_COMMUNITY_ROUTE } from '@/pages/caring-community/config';
import type { TenantFeatures, TenantModules } from '@/types/api';

type NavigationNavKey =
  | 'about'
  | 'achievements'
  | 'activity'
  | 'ai_chat'
  | 'blog'
  | 'caring_community'
  | 'connections'
  | 'courses'
  | 'dashboard'
  | 'events'
  | 'exchanges'
  | 'explore'
  | 'faq'
  | 'features'
  | 'federated_events'
  | 'federated_listings'
  | 'federated_members'
  | 'federated_messages'
  | 'federation_events_short'
  | 'federation_hub'
  | 'federation_hub_short'
  | 'federation_listings_short'
  | 'federation_members_short'
  | 'federation_messages_short'
  | 'federation_partners_short'
  | 'federation_settings'
  | 'federation_settings_short'
  | 'feed'
  | 'goals'
  | 'group_exchanges'
  | 'groups'
  | 'home'
  | 'ideation'
  | 'impact_report'
  | 'jobs'
  | 'leaderboard'
  | 'listings'
  | 'marketplace'
  | 'matches'
  | 'members'
  | 'messages'
  | 'nexus_score'
  | 'organisations'
  | 'our_impact'
  | 'partner_communities'
  | 'partner_with_us'
  | 'podcasts'
  | 'polls'
  | 'premium'
  | 'resources'
  | 'saved'
  | 'skills'
  | 'social_prescribing'
  | 'strategic_plan'
  | 'timebanking_guide'
  | 'venues'
  | 'volunteering'
  | 'wallet'
  | 'whats_on';

type NavigationLegalKey =
  | 'accessibility'
  | 'cookie_policy'
  | 'legal_hub'
  | 'privacy_policy'
  | 'terms_of_service';

export type NavigationLabelKey = `nav.${NavigationNavKey}` | `legal.${NavigationLegalKey}`;

type NavigationDescriptionKey = 'nav_desc.timebanking_listings' | `nav_desc.${Exclude<NavigationNavKey,
  | 'federation_events_short'
  | 'federation_hub_short'
  | 'federation_listings_short'
  | 'federation_members_short'
  | 'federation_messages_short'
  | 'federation_partners_short'
  | 'federation_settings_short'
  | 'home'
>}`;

export type DesktopNavigationSection =
  | 'primary'
  | 'timebanking'
  | 'community-main'
  | 'community-local'
  | 'community-explore'
  | 'engage'
  | 'progress'
  | 'tools'
  | 'federation'
  | 'about'
  | 'impact';

export type MobileNavigationSection =
  | 'main'
  | 'timebanking'
  | 'community'
  | 'engage'
  | 'explore'
  | 'federation'
  | 'about'
  | 'legal';

export type NavigationSurface = 'desktop' | 'mobile';

interface NavigationPlacement<Section extends string> {
  section: Section;
  /** Allows a shorter or context-specific translated label without duplicating route policy. */
  labelKey?: NavigationLabelKey;
}

interface NavigationDestinationDefinition {
  id: string;
  href: `/${string}` | '/';
  labelKey: NavigationLabelKey;
  descriptionKey?: NavigationDescriptionKey;
  icon: LucideIcon;
  auth?: 'authenticated';
  /** Show ONLY to signed-out visitors (e.g. the public What's On, whose signed-in twin is the member Events page). */
  anonOnly?: true;
  feature?: keyof TenantFeatures;
  /** ALL listed features must be on — for surfaces gated by two flags (e.g. events + public_events). */
  features?: readonly (keyof TenantFeatures)[];
  module?: keyof TenantModules;
  tenantSlugs?: readonly string[];
  placements: {
    desktop?: readonly NavigationPlacement<DesktopNavigationSection>[];
    mobile?: readonly NavigationPlacement<MobileNavigationSection>[];
  };
}

const both = <
  D extends DesktopNavigationSection,
  M extends MobileNavigationSection,
>(desktop: D, mobile: M) => ({
  desktop: [{ section: desktop }],
  mobile: [{ section: mobile }],
} as const);

/**
 * Canonical built-in navigation policy.
 *
 * Route, entitlement, icon, and translation metadata live here exactly once.
 * Desktop and mobile keep their own presentation hierarchy through placements;
 * tenant-provided custom menus remain a deliberate override in the consumers.
 */
export const NAVIGATION_DESTINATIONS = [
  { id: 'home', href: '/', labelKey: 'nav.home', icon: Home, placements: { mobile: [{ section: 'main' }] } },
  { id: 'feed', href: '/feed', labelKey: 'nav.feed', descriptionKey: 'nav_desc.feed', icon: Newspaper, auth: 'authenticated', module: 'feed', placements: both('primary', 'main') },
  { id: 'dashboard', href: '/dashboard', labelKey: 'nav.dashboard', descriptionKey: 'nav_desc.dashboard', icon: LayoutDashboard, auth: 'authenticated', module: 'dashboard', placements: both('community-main', 'main') },
  { id: 'explore', href: '/explore', labelKey: 'nav.explore', descriptionKey: 'nav_desc.explore', icon: Compass, feature: 'explore', placements: both('primary', 'main') },
  { id: 'messages', href: '/messages', labelKey: 'nav.messages', descriptionKey: 'nav_desc.messages', icon: MessageSquare, auth: 'authenticated', module: 'messages', placements: both('primary', 'main') },
  { id: 'saved', href: '/saved', labelKey: 'nav.saved', descriptionKey: 'nav_desc.saved', icon: Bookmark, auth: 'authenticated', placements: both('tools', 'main') },
  { id: 'activity', href: '/activity', labelKey: 'nav.activity', descriptionKey: 'nav_desc.activity', icon: Activity, auth: 'authenticated', placements: both('tools', 'main') },

  { id: 'listings', href: '/listings', labelKey: 'nav.listings', descriptionKey: 'nav_desc.timebanking_listings', icon: ListTodo, module: 'listings', placements: both('timebanking', 'timebanking') },
  { id: 'exchanges', href: '/exchanges', labelKey: 'nav.exchanges', descriptionKey: 'nav_desc.exchanges', icon: ArrowRightLeft, feature: 'exchange_workflow', placements: both('timebanking', 'timebanking') },
  { id: 'group-exchanges', href: '/group-exchanges', labelKey: 'nav.group_exchanges', descriptionKey: 'nav_desc.group_exchanges', icon: Users, feature: 'group_exchanges', placements: both('timebanking', 'timebanking') },
  { id: 'wallet', href: '/wallet', labelKey: 'nav.wallet', descriptionKey: 'nav_desc.wallet', icon: Wallet, auth: 'authenticated', module: 'wallet', placements: both('timebanking', 'timebanking') },

  { id: 'members', href: '/members', labelKey: 'nav.members', descriptionKey: 'nav_desc.members', icon: Users, feature: 'connections', placements: both('community-local', 'community') },
  { id: 'connections', href: '/connections', labelKey: 'nav.connections', descriptionKey: 'nav_desc.connections', icon: Users2, feature: 'connections', placements: both('community-local', 'community') },
  { id: 'events', href: '/events', labelKey: 'nav.events', descriptionKey: 'nav_desc.events', icon: Calendar, feature: 'events', placements: both('community-local', 'community') },
  // The signed-out twin of Events: public advertising at /whats-on. Members
  // never see both — this one is anonOnly, and TenantShell serves the member
  // EventsPage at /events once signed in.
  { id: 'whats-on', href: '/whats-on', labelKey: 'nav.whats_on', descriptionKey: 'nav_desc.whats_on', icon: Calendar, anonOnly: true, features: ['events', 'public_events'], placements: both('community-local', 'community') },
  { id: 'groups', href: '/groups', labelKey: 'nav.groups', descriptionKey: 'nav_desc.groups', icon: Users, feature: 'groups', placements: both('community-local', 'community') },
  { id: 'volunteering', href: '/volunteering', labelKey: 'nav.volunteering', descriptionKey: 'nav_desc.volunteering', icon: Heart, feature: 'volunteering', placements: both('community-local', 'community') },
  { id: 'venues', href: '/venues', labelKey: 'nav.venues', descriptionKey: 'nav_desc.venues', icon: Store, auth: 'authenticated', feature: 'partner_venues', placements: both('community-local', 'community') },
  { id: 'organisations', href: '/organisations', labelKey: 'nav.organisations', descriptionKey: 'nav_desc.organisations', icon: Building2, feature: 'volunteering', placements: both('community-local', 'community') },
  {
    id: 'federation-hub', href: '/federation', labelKey: 'nav.federation_hub', descriptionKey: 'nav_desc.federation_hub', icon: Globe,
    auth: 'authenticated', feature: 'federation',
    placements: {
      desktop: [
        { section: 'community-local', labelKey: 'nav.partner_communities' },
        { section: 'federation' },
      ],
      mobile: [{ section: 'federation', labelKey: 'nav.federation_hub_short' }],
    },
  },
  { id: 'caring-community', href: CARING_COMMUNITY_ROUTE.href, labelKey: 'nav.caring_community', descriptionKey: 'nav_desc.caring_community', icon: Heart, feature: CARING_COMMUNITY_ROUTE.feature, placements: both('community-local', 'community') },
  { id: 'resources', href: '/resources', labelKey: 'nav.resources', descriptionKey: 'nav_desc.resources', icon: FolderOpen, feature: 'resources', placements: both('community-explore', 'community') },
  { id: 'jobs', href: '/jobs', labelKey: 'nav.jobs', descriptionKey: 'nav_desc.jobs', icon: Briefcase, feature: 'job_vacancies', placements: both('community-explore', 'community') },
  { id: 'marketplace', href: '/marketplace', labelKey: 'nav.marketplace', descriptionKey: 'nav_desc.marketplace', icon: ShoppingBag, feature: 'marketplace', placements: both('community-explore', 'community') },
  { id: 'courses', href: '/courses', labelKey: 'nav.courses', descriptionKey: 'nav_desc.courses', icon: GraduationCap, feature: 'courses', placements: both('community-explore', 'community') },
  { id: 'podcasts', href: '/podcasts', labelKey: 'nav.podcasts', descriptionKey: 'nav_desc.podcasts', icon: Podcast, feature: 'podcasts', placements: both('community-explore', 'community') },
  { id: 'premium', href: '/premium', labelKey: 'nav.premium', descriptionKey: 'nav_desc.premium', icon: Crown, feature: 'member_premium', placements: both('community-explore', 'community') },

  { id: 'goals', href: '/goals', labelKey: 'nav.goals', descriptionKey: 'nav_desc.goals', icon: Target, feature: 'goals', placements: both('engage', 'engage') },
  { id: 'polls', href: '/polls', labelKey: 'nav.polls', descriptionKey: 'nav_desc.polls', icon: BarChart3, feature: 'polls', placements: both('engage', 'engage') },
  { id: 'ideation', href: '/ideation', labelKey: 'nav.ideation', descriptionKey: 'nav_desc.ideation', icon: Lightbulb, feature: 'ideation_challenges', placements: both('engage', 'engage') },
  { id: 'achievements', href: '/achievements', labelKey: 'nav.achievements', descriptionKey: 'nav_desc.achievements', icon: Trophy, feature: 'gamification', placements: both('progress', 'explore') },
  { id: 'leaderboard', href: '/leaderboard', labelKey: 'nav.leaderboard', descriptionKey: 'nav_desc.leaderboard', icon: Medal, feature: 'gamification', placements: both('progress', 'explore') },
  { id: 'nexus-score', href: '/nexus-score', labelKey: 'nav.nexus_score', descriptionKey: 'nav_desc.nexus_score', icon: BarChart3, feature: 'gamification', placements: both('progress', 'explore') },
  { id: 'matches', href: '/matches', labelKey: 'nav.matches', descriptionKey: 'nav_desc.matches', icon: Handshake, placements: both('tools', 'explore') },
  { id: 'skills', href: '/skills', labelKey: 'nav.skills', descriptionKey: 'nav_desc.skills', icon: GraduationCap, placements: both('tools', 'explore') },
  { id: 'ai-chat', href: '/chat', labelKey: 'nav.ai_chat', descriptionKey: 'nav_desc.ai_chat', icon: Bot, feature: 'ai_chat', placements: both('tools', 'explore') },

  {
    id: 'federation-partners', href: '/federation/partners', labelKey: 'nav.partner_communities', descriptionKey: 'nav_desc.partner_communities', icon: Building2,
    auth: 'authenticated', feature: 'federation',
    placements: {
      desktop: [{ section: 'federation' }],
      mobile: [{ section: 'federation', labelKey: 'nav.federation_partners_short' }],
    },
  },
  {
    id: 'federation-members', href: '/federation/members', labelKey: 'nav.federated_members', descriptionKey: 'nav_desc.federated_members', icon: Users,
    auth: 'authenticated', feature: 'federation',
    placements: { desktop: [{ section: 'federation' }], mobile: [{ section: 'federation', labelKey: 'nav.federation_members_short' }] },
  },
  {
    id: 'federation-messages', href: '/federation/messages', labelKey: 'nav.federated_messages', descriptionKey: 'nav_desc.federated_messages', icon: MessageSquare,
    auth: 'authenticated', feature: 'federation',
    placements: { desktop: [{ section: 'federation' }], mobile: [{ section: 'federation', labelKey: 'nav.federation_messages_short' }] },
  },
  {
    id: 'federation-listings', href: '/federation/listings', labelKey: 'nav.federated_listings', descriptionKey: 'nav_desc.federated_listings', icon: ListTodo,
    auth: 'authenticated', feature: 'federation',
    placements: { desktop: [{ section: 'federation' }], mobile: [{ section: 'federation', labelKey: 'nav.federation_listings_short' }] },
  },
  {
    id: 'federation-events', href: '/federation/events', labelKey: 'nav.federated_events', descriptionKey: 'nav_desc.federated_events', icon: Calendar,
    auth: 'authenticated', feature: 'federation',
    placements: { desktop: [{ section: 'federation' }], mobile: [{ section: 'federation', labelKey: 'nav.federation_events_short' }] },
  },
  {
    id: 'federation-settings', href: '/federation/settings', labelKey: 'nav.federation_settings', descriptionKey: 'nav_desc.federation_settings', icon: Settings,
    auth: 'authenticated', feature: 'federation',
    placements: { desktop: [{ section: 'federation' }], mobile: [{ section: 'federation', labelKey: 'nav.federation_settings_short' }] },
  },

  { id: 'about', href: '/about', labelKey: 'nav.about', descriptionKey: 'nav_desc.about', icon: Info, placements: both('about', 'about') },
  { id: 'features', href: '/features', labelKey: 'nav.features', descriptionKey: 'nav_desc.features', icon: Sparkles, placements: both('about', 'about') },
  { id: 'blog', href: '/blog', labelKey: 'nav.blog', descriptionKey: 'nav_desc.blog', icon: Blog, feature: 'blog', placements: both('about', 'about') },
  { id: 'faq', href: '/faq', labelKey: 'nav.faq', descriptionKey: 'nav_desc.faq', icon: HelpCircle, placements: both('about', 'about') },
  { id: 'timebanking-guide', href: '/timebanking-guide', labelKey: 'nav.timebanking_guide', descriptionKey: 'nav_desc.timebanking_guide', icon: Blog, placements: both('about', 'about') },
  { id: 'partner-with-us', href: '/partner', labelKey: 'nav.partner_with_us', descriptionKey: 'nav_desc.partner_with_us', icon: Handshake, tenantSlugs: ['hour-timebank'], placements: both('impact', 'about') },
  { id: 'social-prescribing', href: '/social-prescribing', labelKey: 'nav.social_prescribing', descriptionKey: 'nav_desc.social_prescribing', icon: Stethoscope, tenantSlugs: ['hour-timebank'], placements: both('impact', 'about') },
  { id: 'our-impact', href: '/impact-summary', labelKey: 'nav.our_impact', descriptionKey: 'nav_desc.our_impact', icon: TrendingUp, tenantSlugs: ['hour-timebank'], placements: both('impact', 'about') },
  { id: 'impact-report', href: '/impact-report', labelKey: 'nav.impact_report', descriptionKey: 'nav_desc.impact_report', icon: BarChart3, tenantSlugs: ['hour-timebank'], placements: both('impact', 'about') },
  { id: 'strategic-plan', href: '/strategic-plan', labelKey: 'nav.strategic_plan', descriptionKey: 'nav_desc.strategic_plan', icon: Compass, tenantSlugs: ['hour-timebank'], placements: both('impact', 'about') },

  { id: 'legal-hub', href: '/legal', labelKey: 'legal.legal_hub', icon: FileText, placements: { mobile: [{ section: 'legal' }] } },
  { id: 'terms', href: '/terms', labelKey: 'legal.terms_of_service', icon: FileText, placements: { mobile: [{ section: 'legal' }] } },
  { id: 'privacy', href: '/privacy', labelKey: 'legal.privacy_policy', icon: FileText, placements: { mobile: [{ section: 'legal' }] } },
  { id: 'cookies', href: '/cookies', labelKey: 'legal.cookie_policy', icon: Cookie, placements: { mobile: [{ section: 'legal' }] } },
  { id: 'accessibility', href: '/accessibility', labelKey: 'legal.accessibility', icon: FileText, placements: { mobile: [{ section: 'legal' }] } },
] as const satisfies readonly NavigationDestinationDefinition[];

export type NavigationDestination = (typeof NAVIGATION_DESTINATIONS)[number];
export type NavigationDestinationId = NavigationDestination['id'];

export interface NavigationGateContext {
  isAuthenticated: boolean;
  tenantSlug?: string | null;
  hasFeature: (feature: keyof TenantFeatures) => boolean;
  hasModule: (module: keyof TenantModules) => boolean;
}

export interface NavigationItemPolicy {
  id: NavigationDestinationId;
  href: string;
  labelKey: NavigationLabelKey;
  descriptionKey?: NavigationDescriptionKey;
  icon: LucideIcon;
  auth?: 'authenticated';
  feature?: keyof TenantFeatures;
  module?: keyof TenantModules;
}

function isDestinationVisible(
  destination: NavigationDestination,
  context: NavigationGateContext,
): boolean {
  if ('auth' in destination && destination.auth === 'authenticated' && !context.isAuthenticated) return false;
  if ('anonOnly' in destination && destination.anonOnly && context.isAuthenticated) return false;
  if ('feature' in destination && destination.feature && !context.hasFeature(destination.feature)) return false;
  if ('features' in destination && destination.features
    && !(destination.features as readonly (keyof TenantFeatures)[]).every((flag) => context.hasFeature(flag))) return false;
  if ('module' in destination && destination.module && !context.hasModule(destination.module)) return false;
  if ('tenantSlugs' in destination && destination.tenantSlugs) {
    const tenantSlugs = destination.tenantSlugs as readonly string[];
    if (!tenantSlugs.includes(context.tenantSlug ?? '')) return false;
  }
  return true;
}

export function getNavigationItems(
  surface: 'desktop',
  section: DesktopNavigationSection,
  context: NavigationGateContext,
): NavigationItemPolicy[];
export function getNavigationItems(
  surface: 'mobile',
  section: MobileNavigationSection,
  context: NavigationGateContext,
): NavigationItemPolicy[];
export function getNavigationItems(
  surface: NavigationSurface,
  section: DesktopNavigationSection | MobileNavigationSection,
  context: NavigationGateContext,
): NavigationItemPolicy[] {
  const items: NavigationItemPolicy[] = [];

  for (const destination of NAVIGATION_DESTINATIONS) {
    if (!isDestinationVisible(destination, context)) continue;

    const placementsBySurface = destination.placements as Partial<Record<
      NavigationSurface,
      readonly NavigationPlacement<DesktopNavigationSection | MobileNavigationSection>[]
    >>;
    const placements = placementsBySurface[surface] ?? [];
    for (const placement of placements) {
      if (placement.section !== section) continue;
      items.push({
        id: destination.id,
        href: destination.href,
        labelKey: 'labelKey' in placement && placement.labelKey
          ? placement.labelKey
          : destination.labelKey,
        descriptionKey: 'descriptionKey' in destination ? destination.descriptionKey : undefined,
        icon: destination.icon,
        auth: 'auth' in destination ? destination.auth : undefined,
        feature: 'feature' in destination ? destination.feature : undefined,
        module: 'module' in destination ? destination.module : undefined,
      });
    }
  }

  return items;
}

export const MOBILE_ONLY_NAVIGATION_DESTINATION_IDS = [
  'home',
  'legal-hub',
  'terms',
  'privacy',
  'cookies',
  'accessibility',
] as const satisfies readonly NavigationDestinationId[];
