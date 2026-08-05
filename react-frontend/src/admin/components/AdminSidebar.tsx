// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Sidebar Navigation
 *
 * HeroUI-native, workflow-grouped admin navigation with:
 * - one globally open accordion section
 * - active route and active parent highlighting
 * - scroll-to-open behaviour for long sidebars
 * - synonym-aware search
 * - attention strip for operational items that need review
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useAuth,
  useTenant } from '@/contexts';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Users from 'lucide-react/icons/users';
import ListChecks from 'lucide-react/icons/list-checks';
import Newspaper from 'lucide-react/icons/newspaper';
import Trophy from 'lucide-react/icons/trophy';
import Megaphone from 'lucide-react/icons/megaphone';
import Coins from 'lucide-react/icons/coins';
import Building2 from 'lucide-react/icons/building-2';
import Globe from 'lucide-react/icons/globe';
import Settings from 'lucide-react/icons/settings';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import PanelLeft from 'lucide-react/icons/panel-left';
import UserCheck from 'lucide-react/icons/user-check';
import FileText from 'lucide-react/icons/file-text';
import Menu from 'lucide-react/icons/menu';
import FolderTree from 'lucide-react/icons/folder-tree';
import Tags from 'lucide-react/icons/tags';
import Tag from 'lucide-react/icons/tag';
import Gamepad2 from 'lucide-react/icons/gamepad-2';
import Medal from 'lucide-react/icons/medal';
import BarChart3 from 'lucide-react/icons/chart-column';
import Zap from 'lucide-react/icons/zap';
import Target from 'lucide-react/icons/target';
import Brain from 'lucide-react/icons/brain';
import Bot from 'lucide-react/icons/bot';
import Search from 'lucide-react/icons/search';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Clock from 'lucide-react/icons/clock';
import Wallet from 'lucide-react/icons/wallet';
import CreditCard from 'lucide-react/icons/credit-card';
import KeyIcon from 'lucide-react/icons/key';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Heart from 'lucide-react/icons/heart';
import Timer from 'lucide-react/icons/timer';
import Contact from 'lucide-react/icons/contact';
import StickyNote from 'lucide-react/icons/sticky-note';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Filter from 'lucide-react/icons/filter';
import Activity from 'lucide-react/icons/activity';
import Crown from 'lucide-react/icons/crown';
import HandHeart from 'lucide-react/icons/hand-heart';
import Mail from 'lucide-react/icons/mail';
import Wrench from 'lucide-react/icons/wrench';
import Stethoscope from 'lucide-react/icons/stethoscope';
import UserX from 'lucide-react/icons/user-x';
import Calendar from 'lucide-react/icons/calendar';
import BarChart2 from 'lucide-react/icons/chart-no-axes-column';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Briefcase from 'lucide-react/icons/briefcase';
import BookOpen from 'lucide-react/icons/book-open';
import Cpu from 'lucide-react/icons/cpu';
import Handshake from 'lucide-react/icons/handshake';
import MapPin from 'lucide-react/icons/map-pin';
import Puzzle from 'lucide-react/icons/puzzle';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import Podcast from 'lucide-react/icons/podcast';
import Palette from 'lucide-react/icons/palette';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Store from 'lucide-react/icons/store';
import Languages from 'lucide-react/icons/languages';
import X from 'lucide-react/icons/x';
import BellRing from 'lucide-react/icons/bell-ring';
import Bug from 'lucide-react/icons/bug';
import HelpCircle from 'lucide-react/icons/help-circle';
import HandCoins from 'lucide-react/icons/hand-coins';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tooltip } from '@/components/ui/Tooltip';
import { canAccessSuperPanel, isPlatformSuperAdminUser, isSuperAdminUser } from '@/lib/access';
import type { LucideIcon } from 'lucide-react';
interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  group?: string;
  keywords?: string[];
  attention?: string;
}

interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  items?: NavItem[];
  zone: NavZoneKey | 'pinned';
}

type NavZoneKey =
  | 'overview'
  | 'people'
  | 'community'
  | 'safety'
  | 'communications'
  | 'growth'
  | 'commerce'
  | 'platform'
  | 'diagnostics';

interface NavZone {
  key: NavZoneKey;
  label: string;
  sectionKeys: string[];
}

interface FilteredNavItem extends NavItem {
  sectionLabel: string;
}

const ZONES: NavZone[] = [
  { key: 'overview', label: 'zone_overview', sectionKeys: ['dashboard', 'broker-panel', 'super-admin', 'partner-timebanks-panel'] },
  { key: 'people', label: 'zone_people', sectionKeys: ['users', 'crm'] },
  { key: 'community', label: 'zone_community', sectionKeys: ['community', 'listings', 'content', 'jobs'] },
  { key: 'communications', label: 'zone_communications', sectionKeys: ['communications', 'marketing', 'advertising'] },
  { key: 'growth', label: 'zone_growth', sectionKeys: ['engagement', 'analytics', 'discovery'] },
  { key: 'commerce', label: 'zone_commerce', sectionKeys: ['financial', 'marketplace'] },
  { key: 'platform', label: 'zone_platform', sectionKeys: ['system', 'enterprise'] },
  { key: 'diagnostics', label: 'zone_diagnostics', sectionKeys: ['intelligence'] },
];

function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function getPathAndQuery(href: string) {
  const [path = '', rawQuery = ''] = href.split('?');
  return { path, rawQuery };
}

function keyword(translatedKeywords: string): string[] {
  return translatedKeywords.split('|').map((word) => word.trim()).filter(Boolean);
}

function useAdminNav(): NavSection[] {
  const { t } = useTranslation('admin_nav');
  const { hasFeature, hasModule } = useTenant();
  const { user } = useAuth();

  const userRecord = user as Record<string, unknown> | null;
  const isGod = (user?.role as string) === 'god' || userRecord?.is_god === true;
  const isSuperAdmin = isSuperAdminUser(user);
  const isPlatformSuperAdmin = isPlatformSuperAdminUser(user);
  // Server-resolved: covers both a platform super-admin and the super-admin of a
  // community that has communities beneath it. See the super-admin entry below.
  const canSeeSuperPanel = canAccessSuperPanel(user);

  return useMemo(() => {
    const communityItems: NavItem[] = [
      ...(hasFeature('groups') ? [
        { label: t('groups'), href: '/admin/groups', icon: Users, keywords: keyword(t('search_keywords.groups')) },
        { label: t('group_types'), href: '/admin/groups/types', icon: FolderTree },
        { label: t('group_recommendations'), href: '/admin/groups/recommendations', icon: Brain },
        { label: t('group_ranking'), href: '/admin/groups/ranking', icon: Trophy },
        { label: t('group_organization'), href: '/admin/groups/organization', icon: Tags, keywords: keyword(t('search_keywords.group_organization')) },
      ] : []),
      ...(hasFeature('events') ? [{ label: t('events'), href: '/admin/events', icon: Calendar }] : []),
      ...(hasFeature('polls') ? [{ label: t('polls'), href: '/admin/polls', icon: BarChart2 }] : []),
      ...(hasFeature('goals') ? [{ label: t('goals'), href: '/admin/goals', icon: Target }] : []),
      ...(hasFeature('podcasts') ? [{ label: t('podcasts'), href: '/admin/podcasts', icon: Podcast, keywords: keyword(t('search_keywords.podcasts')) }] : []),
      ...(hasFeature('ideation_challenges') ? [{ label: t('ideation_challenges'), href: '/admin/ideation', icon: Lightbulb }] : []),
      ...(hasFeature('volunteering') ? [{ label: t('volunteering'), href: '/admin/volunteering', icon: Heart }] : []),
      ...(hasFeature('partner_venues') ? [{ label: t('partner_venues'), href: '/admin/partner-venues', icon: Store }] : []),
    ];

    const sections: NavSection[] = [
      {
        key: 'dashboard',
        label: t('dashboard'),
        icon: LayoutDashboard,
        href: '/admin',
        zone: 'overview',
      },
      {
        key: 'broker-panel',
        label: t('broker_panel'),
        icon: ShieldCheck,
        href: '/broker',
        zone: 'overview',
      },
      /*
       * 🔴 Gated on the SERVER-resolved super-panel level, not on
       * `isPlatformSuperAdmin`. The panel is now two tiers: a platform
       * super-admin gets the whole installation, and the super-admin of a
       * community that has communities beneath it gets its own branch only. Both
       * should see this entry; nobody else should.
       *
       * Do not substitute a flag check here. Eligibility also requires the
       * community to allow sub-communities AND to have a usable position in the
       * hierarchy — the backend refuses otherwise, so a flag-based guess would
       * offer a link that 403s.
       */
      ...(canSeeSuperPanel ? [{
        key: 'super-admin',
        label: t('super_admin_panel'),
        icon: Crown,
        href: '/super-admin',
        zone: 'overview' as const,
      }] : []),
      // One entry to the dedicated Partner Timebanks panel replaces the old
      // 15-link federation + integrations sections (2026-07-02). Every admin
      // gets the read-mostly panel when federation is on; the setup/plumbing
      // pages inside are super-admin-only. On tenants where only the
      // partner_api / caring_community surfaces exist, the panel holds
      // super-admin-only content, so the entry hides for ordinary admins.
      ...(hasFeature('federation') || (isSuperAdmin && (hasFeature('partner_api') || hasFeature('caring_community'))) ? [{
        key: 'partner-timebanks-panel',
        label: t('partner_timebanks'),
        icon: Globe,
        href: '/partner-timebanks',
        zone: 'overview' as const,
      }] : []),
      {
        key: 'users',
        label: t('users'),
        icon: Users,
        zone: 'people',
        items: [
          { label: t('all_users'), href: '/admin/users', icon: Users, keywords: keyword(t('search_keywords.all_users')) },
          { label: t('pending_approvals'), href: '/admin/users?filter=pending', icon: UserCheck, keywords: keyword(t('search_keywords.pending_approvals')) },
          ...(hasFeature('caring_community') ? [{ label: t('residency_verifications'), href: '/admin/residency-verifications', icon: MapPin, keywords: keyword(t('search_keywords.residency_verifications')) }] : []),
        ],
      },
      {
        key: 'crm',
        label: t('crm'),
        icon: Contact,
        zone: 'people',
        items: [
          { label: t('crm_dashboard'), href: '/admin/crm', icon: Contact },
          { label: t('member_notes'), href: '/admin/crm/notes', icon: StickyNote },
          { label: t('coordinator_tasks'), href: '/admin/crm/tasks', icon: ClipboardList },
          { label: t('member_tags'), href: '/admin/crm/tags', icon: Tag },
          { label: t('activity_timeline'), href: '/admin/crm/timeline', icon: Activity },
          { label: t('onboarding_funnel'), href: '/admin/crm/funnel', icon: Filter },
        ],
      },
      ...(hasFeature('caring_community') ? [{
        key: 'caring_community',
        label: t('caring_community'),
        icon: Heart,
        href: '/caring',
        zone: 'pinned' as const,
      }] : []),
      ...(communityItems.length > 0 ? [{
        key: 'community',
        label: t('community'),
        icon: Users,
        zone: 'community' as const,
        items: communityItems,
      }] : []),
      ...(hasModule('listings') ? [{
        key: 'listings',
        label: t('listings'),
        icon: ListChecks,
        zone: 'community' as const,
        items: [{ label: t('all_content'), href: '/admin/listings', icon: ListChecks }],
      }] : []),
      {
        key: 'content',
        label: t('content'),
        icon: Newspaper,
        zone: 'community',
        items: [
          ...(hasFeature('blog') ? [{ label: t('blog_posts'), href: '/admin/blog', icon: FileText }] : []),
          ...(hasFeature('resources') ? [{ label: t('resources'), href: '/admin/resources', icon: BookOpen }] : []),
          { label: t('pages'), href: '/admin/pages', icon: FileText },
          { label: t('landing_page'), href: '/admin/landing-page', icon: Palette },
          ...(isGod ? [{ label: t('menus'), href: '/admin/menus', icon: Menu }] : []),
          { label: t('categories'), href: '/admin/categories', icon: FolderTree },
          { label: t('attributes'), href: '/admin/attributes', icon: Tags },
          { label: t('help_faqs'), href: '/admin/help/faqs', icon: HelpCircle, keywords: keyword(t('search_keywords.help_faqs')) },
        ],
      },
      ...(hasFeature('job_vacancies') ? [{
        key: 'jobs',
        label: t('jobs'),
        icon: Briefcase,
        zone: 'community' as const,
        items: [
          { label: t('job_vacancies'), href: '/admin/jobs', icon: Briefcase },
          { label: t('job_moderation'), href: '/admin/jobs/moderation', icon: ShieldCheck },
          { label: t('job_pipeline'), href: '/admin/jobs/pipeline', icon: Handshake },
          { label: t('job_bias_audit'), href: '/admin/jobs/bias-audit', icon: BarChart3 },
          { label: t('job_templates'), href: '/admin/jobs/templates', icon: FileText },
        ],
      }] : []),
      // Content moderation (queue/feed/comments/reviews/reports) and the
      // safeguarding trio moved to the broker panel (/broker/moderation/*,
      // /broker/safeguarding, /broker/safeguarding-options) on 2026-07-02.
      // Smart Matching is the only remaining item here — it now lives in the
      // Intelligence & Diagnostics section below.
      // Email settings / deliverability are restricted to super admins
      // (2026-07-02). When this is the only surviving section in the
      // communications zone, hiding it also removes the zone header for
      // non-super-admins (the zone-empty filter drops it).
      ...(isSuperAdmin ? [{
        key: 'communications',
        label: t('communications'),
        icon: Mail,
        zone: 'communications' as const,
        items: [
          { label: t('email_settings'), href: '/admin/email-settings', icon: Mail, keywords: keyword(t('search_keywords.email_settings')) },
          { label: t('email_deliverability'), href: '/admin/email-deliverability', icon: Mail, keywords: keyword(t('search_keywords.email_deliverability')) },
          { label: t('deliverability'), href: '/admin/deliverability', icon: Mail, keywords: keyword(t('search_keywords.deliverability')) },
        ],
      }] : []),
      {
        key: 'marketing',
        label: t('marketing'),
        icon: Megaphone,
        zone: 'communications',
        items: [
          ...(hasFeature('newsletter') ? [
            { label: t('newsletters'), href: '/admin/newsletters', icon: Megaphone },
            { label: t('subscribers'), href: '/admin/newsletters/subscribers', icon: Users },
            { label: t('templates'), href: '/admin/newsletters/templates', icon: FileText },
            { label: t('bounces'), href: '/admin/newsletters/bounces', icon: AlertTriangle, keywords: keyword(t('search_keywords.bounces')) },
            { label: t('send_time_optimizer'), href: '/admin/newsletters/send-time-optimizer', icon: Clock },
            { label: t('diagnostics'), href: '/admin/newsletters/diagnostics', icon: Stethoscope },
          ] : []),
        ],
      },
      ...(hasFeature('local_advertising') ? [{
        key: 'advertising',
        label: t('advertising'),
        icon: Megaphone,
        zone: 'communications' as const,
        items: [
          { label: t('ad_campaigns'), href: '/admin/advertising/campaigns', icon: Megaphone },
          { label: t('push_campaigns'), href: '/admin/advertising/push-campaigns', icon: BellRing },
        ],
      }] : []),
      ...(hasFeature('gamification') ? [{
        key: 'engagement',
        label: t('engagement'),
        icon: Trophy,
        zone: 'growth' as const,
        items: [
          { label: t('gamification_hub'), href: '/admin/gamification', icon: Gamepad2 },
          { label: t('challenges'), href: '/admin/gamification/challenges', icon: Trophy },
          { label: t('campaigns'), href: '/admin/gamification/campaigns', icon: Target },
          { label: t('custom_badges'), href: '/admin/custom-badges', icon: Medal },
          { label: t('analytics'), href: '/admin/gamification/analytics', icon: BarChart3 },
        ],
      }] : []),
      {
        /*
         * 🔴 The single front door for reporting.
         *
         * TBUK's tester reported "Reporting unclear, could not assess" — a
         * DISCOVERABILITY complaint, not a correctness one. At the time reporting was
         * spread across five separate panels, and SEVEN analytics screens had no
         * sidebar entry at all: they existed only if you already knew the URL
         * (`/admin/groups/analytics`, `/admin/newsletters/analytics`,
         * `/admin/smart-matching/analytics`, `/admin/analytics/regional`,
         * `/admin/timebanking/user-report`, `/admin/nexus-score/analytics`,
         * `/admin/performance`). Municipal Impact — the only export on the platform
         * whose figures reconcile with its screen — lived solely in the Caring panel.
         *
         * Every reporting surface an administrator can reach is now listed here.
         * If you add an analytics or report screen, add it to THIS section; a screen
         * with no sidebar entry is a screen nobody finds.
         */
        key: 'analytics',
        label: t('analytics_reporting'),
        icon: BarChart3,
        zone: 'growth',
        items: [
          { label: t('community_analytics'), href: '/admin/community-analytics', icon: BarChart3 },
          { label: t('impact_report'), href: '/admin/impact-report', icon: FileText },
          { label: t('member_reports'), href: '/admin/reports/members', icon: Users },
          ...(hasModule('wallet') ? [{ label: t('hours_reports'), href: '/admin/reports/hours', icon: Clock }] : []),
          { label: t('inactive_members'), href: '/admin/reports/inactive-members', icon: UserX },
          // Previously reachable only by typing the URL.
          ...(hasModule('wallet') ? [{ label: t('user_report'), href: '/admin/timebanking/user-report', icon: Clock }] : []),
          ...(hasFeature('caring_community') ? [{ label: t('municipal_impact'), href: '/caring/municipal-impact', icon: FileText }] : []),
          { label: t('regional_analytics'), href: '/admin/analytics/regional', icon: BarChart3 },
          // Each of these mirrors the gate on its own module's section — an
          // analytics link for a disabled module is a dead end, and there is a
          // regression test asserting exactly that for newsletters.
          ...(hasFeature('groups') ? [{ label: t('groups'), href: '/admin/groups/analytics', icon: Users }] : []),
          ...(hasFeature('newsletter') ? [{ label: t('newsletters'), href: '/admin/newsletters/analytics', icon: Mail }] : []),
          ...(hasFeature('exchange_workflow') ? [{ label: t('smart_matching'), href: '/admin/smart-matching/analytics', icon: Zap }] : []),
          { label: t('nexus_score'), href: '/admin/nexus-score/analytics', icon: Activity },
          { label: t('performance'), href: '/admin/performance', icon: Activity },
        ],
      },
      {
        key: 'discovery',
        label: t('growth_discovery'),
        icon: Search,
        zone: 'growth',
        items: [
          { label: t('seo_overview'), href: '/admin/seo', icon: Search },
          { label: t('search_analytics'), href: '/admin/search-analytics', icon: BarChart3, keywords: keyword(t('search_keywords.search_analytics')) },
          ...(isPlatformSuperAdmin ? [{ label: t('prerender_engine'), href: '/admin/seo/prerender', icon: Zap }] : []),
          { label: t('error_404_tracking'), href: '/admin/404-errors', icon: AlertTriangle, keywords: keyword(t('search_keywords.error_404_tracking')) },
        ],
      },
      {
        key: 'financial',
        label: t('financial'),
        icon: Coins,
        zone: 'commerce',
        items: [
          ...(hasModule('wallet') ? [
            { label: t('timebanking'), href: '/admin/timebanking', icon: Clock },
            { label: t('fraud_alerts'), href: '/admin/timebanking/alerts', icon: AlertTriangle },
            { label: t('community_fund'), href: '/admin/timebanking/community-fund', icon: Wallet },
            { label: t('org_wallets'), href: '/admin/timebanking/org-wallets', icon: Wallet },
            { label: t('starting_balances'), href: '/admin/timebanking/starting-balances', icon: Wallet },
          ] : []),
          ...(hasFeature('volunteering') ? [
            { label: t('donation_refunds'), href: '/admin/volunteering/donations', icon: HandCoins, keywords: keyword(t('search_keywords.donation_refunds')) },
          ] : []),
          ...(isGod ? [
            { label: t('plans_pricing'), href: '/admin/plans', icon: CreditCard },
            { label: t('billing'), href: '/admin/billing', icon: CreditCard },
          ] : []),
          ...(hasFeature('member_premium') ? [
            { label: t('member_premium'), href: '/admin/member-premium', icon: HandHeart },
            { label: t('premium_subscribers'), href: '/admin/member-premium/subscribers', icon: Users },
          ] : []),
        ],
      },
      ...(hasFeature('marketplace') ? [{
        key: 'marketplace',
        label: t('marketplace'),
        icon: ShoppingBag,
        zone: 'commerce' as const,
        items: [
          { label: t('marketplace_dashboard'), href: '/admin/marketplace', icon: ShoppingBag },
          { label: t('marketplace_moderation'), href: '/admin/marketplace/moderation', icon: ShieldCheck },
          { label: t('marketplace_sellers'), href: '/admin/marketplace/sellers', icon: Store },
        ],
      }] : []),
      {
        key: 'system',
        label: t('platform_operations'),
        icon: Settings,
        zone: 'platform',
        items: [
          { label: t('settings'), href: '/admin/settings', icon: Settings },
          { label: t('onboarding_settings'), href: '/admin/onboarding-settings', icon: Heart },
          ...(isSuperAdmin ? [{ label: t('module_configuration'), href: '/admin/module-configuration', icon: Puzzle }] : []),
          ...(isPlatformSuperAdmin ? [{ label: t('platform_capabilities'), href: '/admin/platform-capabilities', icon: SlidersHorizontal }] : []),
          { label: t('operations'), href: '/admin/operations', icon: Activity },
          { label: t('support_reports'), href: '/admin/support-reports', icon: Bug, keywords: keyword(t('search_keywords.support_reports')) },
          { label: t('translation_config'), href: '/admin/translation-config', icon: Languages },
          { label: t('activity_log'), href: '/admin/activity-log', icon: Activity },
          { label: t('retention_policies'), href: '/admin/retention', icon: Activity, keywords: keyword(t('search_keywords.retention_policies')) },
          { label: t('sso_providers'), href: '/admin/sso', icon: KeyIcon, keywords: keyword(t('search_keywords.sso_providers')) },
          { label: t('cron_jobs'), href: '/admin/cron-jobs', icon: Timer },
          { label: t('cron_logs'), href: '/admin/cron-jobs/logs', icon: FileText },
          { label: t('cron_setup'), href: '/admin/cron-jobs/setup', icon: Wrench },
          ...(isPlatformSuperAdmin ? [{ label: t('cron_settings'), href: '/admin/cron-jobs/settings', icon: Settings }] : []),
        ],
      },
      {
        key: 'enterprise',
        label: t('enterprise'),
        icon: Building2,
        zone: 'platform',
        items: [
          { label: t('enterprise_dashboard'), href: '/admin/enterprise', icon: Building2 },
          { label: t('roles_permissions'), href: '/admin/enterprise/roles', icon: KeyIcon },
          { label: t('gdpr_dashboard'), href: '/admin/enterprise/gdpr', icon: ShieldCheck },
          { label: t('legal_documents'), href: '/admin/legal-documents', icon: FileText },
          { label: t('compliance_dashboard'), href: '/admin/legal-documents/compliance', icon: ShieldCheck },
          { label: t('monitoring'), href: '/admin/enterprise/monitoring', icon: Heart },
        ],
      },
      {
        key: 'intelligence',
        label: t('intelligence_diagnostics'),
        icon: Brain,
        zone: 'diagnostics',
        items: [
          ...(hasFeature('exchange_workflow') ? [
            { label: t('smart_matching'), href: '/admin/smart-matching', icon: Zap },
          ] : []),
          ...(hasFeature('ai_chat') ? [
            { label: t('ai_settings'), href: '/admin/ai-settings', icon: Brain },
            { label: t('ai_module_docs'), href: '/admin/ai/module-docs', icon: Brain },
            { label: t('ai_trace_metrics'), href: '/admin/ai/metrics', icon: Brain },
          ] : []),
          ...(hasFeature('ai_agents') ? [
            { label: t('ai_agents'), href: '/admin/agents', icon: Bot },
            { label: t('agent_proposals'), href: '/admin/agents/proposals', icon: Bot },
            { label: t('agent_runs'), href: '/admin/agents/runs', icon: Bot },
          ] : []),
          { label: t('algorithm_settings'), href: '/admin/algorithm-settings', icon: Cpu },
          ...(isGod ? [
            { label: t('diagnostics'), href: '/admin/matching-diagnostic', icon: Stethoscope },
            { label: t('match_debug_panel'), href: '/admin/match-debug', icon: Target },
          ] : []),
        ],
      },
    ];

    // Partner Timebanks + Partner APIs sections retired 2026-07-02 — all
    // federation/external-partner surfaces moved to the super-admin-only
    // Partner Timebanks panel (/partner-timebanks), linked from the
    // overview zone entry above.

    return sections.filter((section) => section.href || (section.items?.length ?? 0) > 0);
  }, [hasFeature, hasModule, isGod, isPlatformSuperAdmin, isSuperAdmin, t]);
}

interface AdminSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const renderBadge = (item: NavItem) => {
  if (!item.badge) return null;
  const tone = item.attention === 'danger' ? 'bg-danger text-danger-foreground' : 'bg-accent text-accent-foreground';
  return <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{item.badge}</span>;
};

export function AdminSidebar({ collapsed = false, onToggle = () => undefined }: AdminSidebarProps) {
  const { t } = useTranslation('admin_nav');
  const { pathname, search } = useLocation();
  const { tenantPath } = useTenant();
  const [searchQuery, setSearchQuery] = useState('');
  const sections = useAdminNav();
  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

  const allItems = useMemo(() => {
    return sections.flatMap((section) => [
      ...(section.href ? [{ ...section, label: section.label, href: section.href, icon: section.icon, sectionLabel: section.label }] : []),
      ...(section.items ?? []).map((item) => ({ ...item, sectionLabel: section.label })),
    ]);
  }, [sections]);

  const activeHref = useMemo(() => {
    let bestHref: string | null = null;
    let bestScore = -1;

    for (const item of allItems) {
      const { path, rawQuery } = getPathAndQuery(item.href);
      const fullPath = tenantPath(path);
      const isDashboard = path === '/admin';

      if (isDashboard && pathname !== fullPath) continue;
      if (!isDashboard && !(pathname === fullPath || pathname.startsWith(`${fullPath}/`))) continue;

      let score = path.length;
      if (rawQuery) {
        const required = new URLSearchParams(rawQuery);
        const current = new URLSearchParams(search);
        let queryMatches = true;
        for (const [key, value] of required.entries()) {
          if (current.get(key) !== value) {
            queryMatches = false;
            break;
          }
        }
        if (!queryMatches) continue;
        score += 1000;
      } else if (new URLSearchParams(search).get('filter')) {
        score -= 100;
      }

      if (score > bestScore) {
        bestScore = score;
        bestHref = item.href;
      }
    }

    return bestHref;
  }, [allItems, pathname, search, tenantPath]);

  const activeSectionKey = useMemo(() => {
    if (!activeHref) return null;
    return sections.find((section) => section.href === activeHref || section.items?.some((item) => item.href === activeHref))?.key ?? null;
  }, [activeHref, sections]);

  const [openSection, setOpenSection] = useState<string | null>(() => activeSectionKey);

  useEffect(() => {
    if (!collapsed && activeSectionKey) {
      setOpenSection(activeSectionKey);
    }
  }, [activeSectionKey, collapsed]);

  useEffect(() => {
    if (!openSection || collapsed) return;
    window.setTimeout(() => {
      sectionRefs.current.get(openSection)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 80);
  }, [collapsed, openSection]);

  // The safeguarding flag-count badge moved to the broker panel with the
  // rest of the safeguarding surfaces (2026-07-02) — the admin sidebar no
  // longer polls /v2/admin/safeguarding/dashboard.

  const filteredResults = useMemo((): FilteredNavItem[] => {
    const query = searchQuery.trim();
    if (!query) return [];

    return sections.flatMap((section) =>
      (section.items ?? [])
        .filter((item) =>
          fuzzyMatch(query, `${item.label} ${section.label} ${(item.keywords ?? []).join(' ')}`),
        )
        .map((item) => ({ ...item, sectionLabel: section.label })),
    );
  }, [sections, searchQuery]);

  const attentionItems = useMemo(() => {
    return sections
      .flatMap((section) => (section.items ?? []).map((item) => ({ ...item, sectionLabel: section.label })))
      .filter((item) => item.attention && item.badge)
      .slice(0, 4);
  }, [sections]);

  const isActive = (href: string) => href === activeHref;

  const renderNavLink = (item: NavItem, compact = false) => {
    const ItemIcon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        to={tenantPath(item.href)}
        onClick={() => setSearchQuery('')}
        aria-current={active ? 'page' : undefined}
        className={`group relative flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
          active
            ? 'bg-accent/10 text-accent font-semibold shadow-sm'
            : 'text-muted hover:bg-surface-secondary hover:text-foreground'
        } ${compact ? 'justify-center px-2' : ''}`}
      >
        {active && !compact && <span className="absolute left-0 top-2 h-5 w-0.5 rounded-r bg-accent" />}
        <ItemIcon size={16} className="shrink-0" />
        {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {!compact && renderBadge(item)}
      </Link>
    );
  };

  const renderCollapsedSection = (section: NavSection) => {
    const Icon = section.icon;
    const active = activeSectionKey === section.key;
    const href = section.href ?? section.items?.[0]?.href ?? '/admin';

    return (
      <Tooltip key={section.key} content={section.label} placement="right" delay={250}>
        <Link
          to={tenantPath(href)}
          aria-label={section.label}
          aria-current={active ? 'page' : undefined}
          className={`flex items-center justify-center rounded-lg px-2 py-2 transition-colors ${
            active ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface-secondary hover:text-foreground'
          }`}
        >
          <Icon size={18} aria-hidden="true" />
        </Link>
      </Tooltip>
    );
  };

  const renderSection = (section: NavSection) => {
    const Icon = section.icon;
    const active = activeSectionKey === section.key;

    if (section.href && !section.items) {
      return (
        <div
          key={section.key}
          ref={(node) => {
            if (node) sectionRefs.current.set(section.key, node);
            else sectionRefs.current.delete(section.key);
          }}
        >
          {renderNavLink({ label: section.label, href: section.href, icon: section.icon })}
        </div>
      );
    }

    return (
      <div
        key={section.key}
        ref={(node) => {
          if (node) sectionRefs.current.set(section.key, node);
          else sectionRefs.current.delete(section.key);
        }}
      >
        <Accordion
          selectedKeys={openSection === section.key ? new Set<string>([section.key]) : new Set<string>()}
          selectionMode="single"
          onSelectionChange={(keys) => {
            const selected = Array.from(keys as Set<string>)[0]?.toString() ?? null;
            setOpenSection(selected === section.key ? section.key : null);
          }}
          itemClasses={{
            base: 'py-0',
            trigger: `rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:bg-surface-secondary hover:text-foreground'
            }`,
            title: 'text-sm font-medium',
            content: 'pb-1 pt-0',
            indicator: 'text-muted',
          }}
        >
          <AccordionItem
            key={section.key} id={section.key}
            aria-label={section.label}
            title={
              <span className="flex items-center gap-3">
                <Icon size={20} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
                {section.items?.some((item) => item.attention === 'danger' && item.badge) && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-danger" />
                )}
              </span>
            }
          >
            <ul className="ml-4 mt-1 space-y-0.5 border-l border-divider pl-3">
              {(section.items ?? []).map((item, idx) => (
                <Fragment key={item.href}>
                  {item.group && (
                    <li className={`px-3 text-[10px] font-semibold uppercase tracking-wider text-muted ${idx === 0 ? 'pb-0.5' : 'pb-0.5 pt-2'}`}>
                      {item.group}
                    </li>
                  )}
                  <li>{renderNavLink(item)}</li>
                </Fragment>
              ))}
            </ul>
          </AccordionItem>
        </Accordion>
      </div>
    );
  };

  const groupedSections = ZONES.map((zone) => ({
    ...zone,
    sections: zone.sectionKeys
      .map((key) => sections.find((section) => section.key === key))
      .filter((section): section is NavSection => Boolean(section)),
  })).filter((zone) => zone.sections.length > 0);
  const caringCommunity = sections.find((section) => section.key === 'caring_community');

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-divider bg-surface transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-divider px-4">
        {!collapsed && (
          <Link to={tenantPath('/admin')} className="text-lg font-bold text-foreground">
            {t('admin')}
          </Link>
        )}
        <Button
          variant="tertiary"
          isIconOnly
          onPress={onToggle}
          className="min-h-10 min-w-0 rounded-lg p-2 text-muted hover:bg-surface-secondary hover:text-foreground"
          aria-label={collapsed ? t('expand_sidebar') : t('collapse_sidebar')}
        >
          {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
        </Button>
      </div>

      {!collapsed && (
        <div className="shrink-0 border-b border-divider px-2 py-2">
          <Input
            size="sm"
            variant="secondary"
            type="search"
            name="admin-sidebar-search"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            placeholder={t('search_nav')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            startContent={<Search size={14} className="text-muted" />}
            endContent={
              searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-muted hover:text-foreground"
                  aria-label={t('clear_search')}
                >
                  <X size={14} />
                </button>
              ) : null
            }
            classNames={{ input: 'text-sm', inputWrapper: 'h-8 min-h-8' }}
            aria-label={t('search_nav')}
          />
        </div>
      )}

      <ScrollShadow as="nav" aria-label={t('admin_navigation')} className="min-h-0 flex-1 px-2 py-3" hideScrollBar>
        {searchQuery.trim() ? (
          <ul className="space-y-0.5 py-1">
            {filteredResults.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted">{t('no_results')}</li>
            ) : (
              filteredResults.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      to={tenantPath(item.href)}
                      onClick={() => setSearchQuery('')}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        isActive(item.href)
                          ? 'bg-accent/10 text-accent font-semibold'
                          : 'text-muted hover:bg-surface-secondary hover:text-foreground'
                      }`}
                    >
                      <ItemIcon size={16} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="max-w-[80px] truncate text-[10px] text-muted">{item.sectionLabel}</span>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        ) : collapsed ? (
          <ul className="space-y-1">
            {sections.filter((section) => section.key !== 'caring_community').map((section) => (
              <li key={section.key}>{renderCollapsedSection(section)}</li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1">
            {attentionItems.length > 0 && (
              <>
                <li className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-danger">
                  {t('needs_attention')}
                </li>
                {attentionItems.map((item) => (
                  <li key={`attention-${item.href}`}>{renderNavLink(item)}</li>
                ))}
                <li><div className="mx-3 mb-1 mt-1 border-b border-divider/50" /></li>
              </>
            )}

            {groupedSections.map((zone, zoneIdx) => (
              <li key={zone.key}>
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {t(zone.label)}
                </div>
                <div className="space-y-1">{zone.sections.map((section) => renderSection(section))}</div>
                {zoneIdx < groupedSections.length - 1 && <div className="mx-3 mt-2 border-b border-divider/40" />}
              </li>
            ))}

          </ul>
        )}
      </ScrollShadow>

      <div className="shrink-0 border-t border-divider px-2 py-2">
        {caringCommunity && (
          <Tooltip content={caringCommunity.label} placement="right" isDisabled={!collapsed}>
            <Link
              to={tenantPath(caringCommunity.href ?? '/caring')}
              aria-current={isActive(caringCommunity.href ?? '/caring') ? 'page' : undefined}
              className={`mb-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                isActive(caringCommunity.href ?? '/caring')
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15'
              } ${collapsed ? 'justify-center' : ''}`}
              title={caringCommunity.label}
            >
              <Heart size={16} className="shrink-0" />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate">{caringCommunity.label}</span>
                  <span className="shrink-0 rounded-full bg-warning px-2 py-0.5 text-[10px] font-bold uppercase text-warning-foreground">
                    {t('alpha_badge')}
                  </span>
                </>
              )}
            </Link>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}

export default AdminSidebar;
