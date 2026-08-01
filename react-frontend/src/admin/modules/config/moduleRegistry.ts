// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Module Registry
 * Central definition of all platform modules, their metadata, icons,
 * config sources, and granular configuration options.
 */

import type { LucideIcon } from 'lucide-react';
import ListChecks from 'lucide-react/icons/list-checks';
import Wallet from 'lucide-react/icons/wallet';
import MessageSquare from 'lucide-react/icons/message-square';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Rss from 'lucide-react/icons/rss';
import Bell from 'lucide-react/icons/bell';
import UserCircle from 'lucide-react/icons/circle-user';
import Settings from 'lucide-react/icons/settings';
import Calendar from 'lucide-react/icons/calendar';
import Store from 'lucide-react/icons/store';
import Users from 'lucide-react/icons/users';
import Gamepad2 from 'lucide-react/icons/gamepad-2';
import Target from 'lucide-react/icons/target';
import FileText from 'lucide-react/icons/file-text';
import BookOpen from 'lucide-react/icons/book-open';
import Heart from 'lucide-react/icons/heart';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Building2 from 'lucide-react/icons/building-2';
import Globe from 'lucide-react/icons/globe';
import Link2 from 'lucide-react/icons/link-2';
import Star from 'lucide-react/icons/star';
import BarChart3 from 'lucide-react/icons/chart-column';
import Briefcase from 'lucide-react/icons/briefcase';
import Lightbulb from 'lucide-react/icons/lightbulb';
import MessageCircle from 'lucide-react/icons/message-circle';
import Repeat2 from 'lucide-react/icons/repeat-2';
import Search from 'lucide-react/icons/search';
import Brain from 'lucide-react/icons/brain';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Mail from 'lucide-react/icons/mail';
import Languages from 'lucide-react/icons/languages';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import Podcast from 'lucide-react/icons/podcast';
import HandHeart from 'lucide-react/icons/hand-heart';
import Compass from 'lucide-react/icons/compass';
import KeyRound from 'lucide-react/icons/key-round';
import Fingerprint from 'lucide-react/icons/fingerprint';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ModuleType = 'core' | 'feature';

export type ConfigSource =
  | 'tenant_features'
  | 'tenant_modules'
  | 'broker_config'
  | 'group_config'
  | 'listing_config'
  | 'volunteering_config'
  | 'job_config'
  | 'podcast_config'
  | 'identity_config'
  | 'authentication_config'
  | 'group_policies'
  | 'onboarding_config'
  | 'tenant_settings'
  | 'none';

export type ConfigOptionType = 'boolean' | 'number' | 'string' | 'select';

/** Development maturity stage of a module. Absent = stable/generally available. */
export type ModuleStage = 'alpha' | 'beta';

export interface SelectChoice {
  value: string;
}

export interface ConfigOption {
  key: string;
  type: ConfigOptionType;
  defaultValue: boolean | number | string;
  category: string;
  comingSoon?: boolean;
  min?: number;
  max?: number;
  choices?: SelectChoice[];
}

export interface ModuleDefinition {
  id: string;
  icon: LucideIcon;
  type: ModuleType;
  configSource: ConfigSource;
  configOptions: ConfigOption[];
  /** Link to an existing dedicated admin page for this module's config */
  detailPageUrl?: string;
  /** Development maturity stage. Omit for stable/GA modules. */
  stage?: ModuleStage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Modules (8)
// ─────────────────────────────────────────────────────────────────────────────

const CORE_MODULES: ModuleDefinition[] = [
  {
    id: 'listings',
    icon: ListChecks,
    type: 'core',
    configSource: 'listing_config',
    configOptions: [
      // Moderation & Approval
      { key: 'listing.moderation_enabled', type: 'boolean', defaultValue: false, category: 'moderation_approval' },
      { key: 'listing.auto_approve_trusted', type: 'boolean', defaultValue: false, category: 'moderation_approval' },
      // Listing Limits
      { key: 'listing.max_per_user', type: 'number', defaultValue: 50, category: 'listing_limits', min: 1, max: 500 },
      { key: 'listing.max_images', type: 'number', defaultValue: 5, category: 'listing_limits', min: 1, max: 20 },
      { key: 'listing.max_image_size_mb', type: 'number', defaultValue: 8, category: 'listing_limits', min: 1, max: 50 },
      { key: 'listing.require_image', type: 'boolean', defaultValue: false, category: 'listing_limits' },
      { key: 'listing.min_title_length', type: 'number', defaultValue: 5, category: 'listing_limits', min: 1, max: 100 },
      { key: 'listing.min_description_length', type: 'number', defaultValue: 20, category: 'listing_limits', min: 1, max: 500 },
      // Types & Form Options
      { key: 'listing.allow_offers', type: 'boolean', defaultValue: true, category: 'types_form_options' },
      { key: 'listing.allow_requests', type: 'boolean', defaultValue: true, category: 'types_form_options' },
      { key: 'listing.require_category', type: 'boolean', defaultValue: true, category: 'types_form_options' },
      { key: 'listing.require_location', type: 'boolean', defaultValue: false, category: 'types_form_options' },
      { key: 'listing.require_hours_estimate', type: 'boolean', defaultValue: false, category: 'types_form_options' },
      { key: 'listing.enable_skill_tags', type: 'boolean', defaultValue: true, category: 'types_form_options' },
      { key: 'listing.enable_service_type', type: 'boolean', defaultValue: true, category: 'types_form_options' },
      // Expiry & Renewal
      { key: 'listing.auto_expire_days', type: 'number', defaultValue: 0, category: 'expiry_renewal', min: 0, max: 365 },
      { key: 'listing.max_renewals', type: 'number', defaultValue: 12, category: 'expiry_renewal', min: 0, max: 50 },
      { key: 'listing.renewal_days', type: 'number', defaultValue: 30, category: 'expiry_renewal', min: 7, max: 365 },
      { key: 'listing.expiry_reminders', type: 'boolean', defaultValue: true, category: 'expiry_renewal' },
      // Features
      { key: 'listing.enable_featured', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'listing.featured_duration_days', type: 'number', defaultValue: 7, category: 'features', min: 1, max: 90 },
      { key: 'listing.enable_ai_descriptions', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'listing.enable_reporting', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'listing.enable_favourites', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'listing.enable_map_view', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'listing.enable_reciprocity', type: 'boolean', defaultValue: true, category: 'features' },
    ],
  },
  {
    id: 'wallet',
    icon: Wallet,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [
      { key: 'wallet.min_transfer', type: 'number', defaultValue: 0.25, category: 'limits', comingSoon: true, min: 0.25, max: 10 },
      { key: 'wallet.max_transfer', type: 'number', defaultValue: 100, category: 'limits', comingSoon: true, min: 1, max: 1000 },
      { key: 'wallet.allow_negative_balance', type: 'boolean', defaultValue: false, category: 'rules', comingSoon: true },
    ],
  },
  {
    id: 'messages',
    icon: MessageSquare,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [
      { key: 'messages.retention_days', type: 'number', defaultValue: 0, category: 'storage', comingSoon: true, min: 0, max: 3650 },
      { key: 'messages.rate_limit', type: 'number', defaultValue: 60, category: 'limits', comingSoon: true, min: 5, max: 500 },
    ],
  },
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [
      { key: 'dashboard.show_recent_activity', type: 'boolean', defaultValue: true, category: 'layout', comingSoon: true },
      { key: 'dashboard.show_quick_actions', type: 'boolean', defaultValue: true, category: 'layout', comingSoon: true },
    ],
  },
  {
    id: 'feed',
    icon: Rss,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [
      { key: 'feed.allow_images', type: 'boolean', defaultValue: true, category: 'content', comingSoon: true },
      { key: 'feed.allow_polls', type: 'boolean', defaultValue: true, category: 'content', comingSoon: true },
      { key: 'feed.require_moderation', type: 'boolean', defaultValue: false, category: 'moderation', comingSoon: true },
    ],
  },
  {
    id: 'notifications',
    icon: Bell,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [
      { key: 'notifications.email_digest', type: 'boolean', defaultValue: false, category: 'delivery', comingSoon: true },
      { key: 'notifications.push_enabled', type: 'boolean', defaultValue: true, category: 'delivery', comingSoon: true },
    ],
  },
  {
    id: 'profile',
    icon: UserCircle,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [
      { key: 'profile.require_avatar', type: 'boolean', defaultValue: false, category: 'requirements', comingSoon: true },
      { key: 'profile.require_bio', type: 'boolean', defaultValue: false, category: 'requirements', comingSoon: true },
    ],
  },
  {
    id: 'settings',
    icon: Settings,
    type: 'core',
    configSource: 'tenant_modules',
    configOptions: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Optional Features (19)
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_MODULES: ModuleDefinition[] = [
  {
    id: 'explore',
    icon: Compass,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [],
  },
  {
    id: 'events',
    icon: Calendar,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [],
    detailPageUrl: '/admin/events/settings',
  },
  {
    // Partner venues — records engagement when venue staff scan a member's
    // pass. Deliberately separate from marketplace/merchant_coupons: no
    // coupon is issued and no discount is applied by the platform.
    id: 'partner_venues',
    icon: Store,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [],
    detailPageUrl: '/admin/partner-venues',
  },
  {
    id: 'groups',
    icon: Users,
    type: 'feature',
    configSource: 'group_config',
    detailPageUrl: '/admin/groups',
    configOptions: [
      // Creation & Membership
      { key: 'allow_user_group_creation', type: 'boolean', defaultValue: true, category: 'creation_membership' },
      { key: 'require_group_approval', type: 'boolean', defaultValue: false, category: 'creation_membership' },
      { key: 'max_groups_per_user', type: 'number', defaultValue: 10, category: 'creation_membership', min: 1, max: 100 },
      { key: 'max_members_per_group', type: 'number', defaultValue: 500, category: 'creation_membership', min: 2, max: 10000 },
      { key: 'allow_private_groups', type: 'boolean', defaultValue: true, category: 'creation_membership' },
      { key: 'default_visibility', type: 'select', defaultValue: 'public', category: 'creation_membership', choices: [{ value: 'public' }, { value: 'private' }] },
      // Features
      { key: 'enable_discussions', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'min_description_length', type: 'number', defaultValue: 10, category: 'content', min: 0, max: 1000 },
      { key: 'max_description_length', type: 'number', defaultValue: 5000, category: 'content', min: 10, max: 50000 },
      // Tab Visibility — control which tabs appear in group detail view
      { key: 'tab_feed', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_discussion', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_members', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_events', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_files', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_announcements', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_qa', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_wiki', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_media', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_chatrooms', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_tasks', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_challenges', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_analytics', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'tab_subgroups', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
    ],
  },
  {
    id: 'gamification',
    icon: Gamepad2,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'gamification.show_leaderboard', type: 'boolean', defaultValue: true, category: 'visibility', comingSoon: true },
      { key: 'gamification.xp_multiplier', type: 'number', defaultValue: 1, category: 'rewards', comingSoon: true, min: 0.1, max: 10 },
      { key: 'gamification.daily_rewards', type: 'boolean', defaultValue: true, category: 'rewards', comingSoon: true },
    ],
  },
  {
    id: 'goals',
    icon: Target,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'goals.allow_community_goals', type: 'boolean', defaultValue: true, category: 'features', comingSoon: true },
      { key: 'goals.max_active_goals', type: 'number', defaultValue: 10, category: 'limits', comingSoon: true, min: 1, max: 50 },
    ],
  },
  {
    id: 'blog',
    icon: FileText,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'blog.allow_comments', type: 'boolean', defaultValue: true, category: 'features', comingSoon: true },
      { key: 'blog.require_approval', type: 'boolean', defaultValue: true, category: 'moderation', comingSoon: true },
    ],
  },
  {
    id: 'resources',
    icon: BookOpen,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'resources.allow_uploads', type: 'boolean', defaultValue: true, category: 'features', comingSoon: true },
      { key: 'resources.max_file_size_mb', type: 'number', defaultValue: 10, category: 'limits', comingSoon: true, min: 1, max: 100 },
    ],
  },
  {
    id: 'caring_community',
    icon: Heart,
    type: 'feature',
    configSource: 'tenant_features',
    detailPageUrl: '/caring',
    stage: 'alpha',
    configOptions: [
      { key: 'caring_community.dashboard_enabled', type: 'boolean', defaultValue: true, category: 'visibility' },
      { key: 'caring_community.show_municipal_reporting', type: 'boolean', defaultValue: true, category: 'reporting' },
      { key: 'caring_community.show_trust_pack', type: 'boolean', defaultValue: true, category: 'trust_safety', comingSoon: true },
    ],
  },
  {
    id: 'volunteering',
    icon: Heart,
    type: 'feature',
    configSource: 'volunteering_config',
    configOptions: [
      // Tab Visibility (17 tabs)
      { key: 'volunteering.tab_opportunities', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_applications', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_hours', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_recommended', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_certificates', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_alerts', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_wellbeing', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_credentials', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_waitlist', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_swaps', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_group_signups', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_hours_review', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_expenses', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_safeguarding', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_community_projects', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_donations', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      { key: 'volunteering.tab_accessibility', type: 'boolean', defaultValue: true, category: 'tab_visibility' },
      // Shifts & Applications
      { key: 'volunteering.swap_requires_admin', type: 'boolean', defaultValue: false, category: 'shifts_applications' },
      { key: 'volunteering.auto_approve_applications', type: 'boolean', defaultValue: false, category: 'shifts_applications' },
      { key: 'volunteering.require_org_note_on_decline', type: 'boolean', defaultValue: false, category: 'shifts_applications' },
      { key: 'volunteering.cancellation_deadline_hours', type: 'number', defaultValue: 24, category: 'shifts_applications', min: 0, max: 168 },
      { key: 'volunteering.max_hours_per_shift', type: 'number', defaultValue: 8, category: 'shifts_applications', min: 1, max: 24 },
      // Hours & Verification
      { key: 'volunteering.hours_require_verification', type: 'boolean', defaultValue: true, category: 'hours_verification' },
      { key: 'volunteering.min_hours_for_certificate', type: 'number', defaultValue: 1, category: 'hours_verification', min: 1, max: 100 },
      // Emergency Alerts
      { key: 'volunteering.alert_default_expiry_hours', type: 'number', defaultValue: 24, category: 'emergency_alerts', min: 1, max: 168 },
      { key: 'volunteering.alert_skill_matching', type: 'boolean', defaultValue: true, category: 'emergency_alerts' },
      // Expenses
      { key: 'volunteering.expenses_enabled', type: 'boolean', defaultValue: true, category: 'expenses' },
      { key: 'volunteering.expense_require_receipt', type: 'boolean', defaultValue: false, category: 'expenses' },
      { key: 'volunteering.expense_max_amount', type: 'number', defaultValue: 500, category: 'expenses', min: 1, max: 10000 },
      // Wellbeing & Safety
      { key: 'volunteering.burnout_detection', type: 'boolean', defaultValue: true, category: 'wellbeing_safety' },
      { key: 'volunteering.guardian_consent_required', type: 'boolean', defaultValue: false, category: 'wellbeing_safety' },
      // Features
      { key: 'volunteering.enable_qr_checkin', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'volunteering.enable_recurring_shifts', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'volunteering.enable_reviews', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'volunteering.enable_matching', type: 'boolean', defaultValue: true, category: 'features' },
    ],
  },
  {
    id: 'exchange_workflow',
    icon: ArrowLeftRight,
    type: 'feature',
    configSource: 'broker_config',
    detailPageUrl: '/admin/broker/configuration',
    configOptions: [
      // Messaging
      { key: 'broker_messaging_enabled', type: 'boolean', defaultValue: true, category: 'messaging' },
      { key: 'broker_copy_all_messages', type: 'boolean', defaultValue: false, category: 'messaging' },
      { key: 'broker_copy_threshold_hours', type: 'number', defaultValue: 5, category: 'messaging', min: 1, max: 100 },
      { key: 'new_member_monitoring_days', type: 'number', defaultValue: 30, category: 'messaging', min: 0, max: 365 },
      { key: 'require_exchange_for_listings', type: 'boolean', defaultValue: false, category: 'messaging' },
      // Risk Tagging
      { key: 'risk_tagging_enabled', type: 'boolean', defaultValue: true, category: 'risk_tagging' },
      { key: 'auto_flag_high_risk', type: 'boolean', defaultValue: true, category: 'risk_tagging' },
      { key: 'require_approval_high_risk', type: 'boolean', defaultValue: false, category: 'risk_tagging' },
      { key: 'notify_on_high_risk_match', type: 'boolean', defaultValue: true, category: 'risk_tagging' },
      // Exchange Workflow
      { key: 'broker_approval_required', type: 'boolean', defaultValue: true, category: 'exchange_workflow' },
      { key: 'auto_approve_low_risk', type: 'boolean', defaultValue: false, category: 'exchange_workflow' },
      { key: 'exchange_timeout_days', type: 'number', defaultValue: 7, category: 'exchange_workflow', min: 1, max: 90 },
      { key: 'max_hours_without_approval', type: 'number', defaultValue: 5, category: 'exchange_workflow', min: 1, max: 100 },
      { key: 'confirmation_deadline_hours', type: 'number', defaultValue: 48, category: 'exchange_workflow', min: 1, max: 720 },
      { key: 'allow_hour_adjustment', type: 'boolean', defaultValue: false, category: 'exchange_workflow' },
      { key: 'max_hour_variance_percent', type: 'number', defaultValue: 20, category: 'exchange_workflow', min: 0, max: 100 },
      { key: 'expiry_hours', type: 'number', defaultValue: 168, category: 'exchange_workflow', min: 1, max: 720 },
      // Broker Visibility
      { key: 'broker_visible_to_members', type: 'boolean', defaultValue: false, category: 'broker_visibility' },
      { key: 'show_broker_name', type: 'boolean', defaultValue: false, category: 'broker_visibility' },
      { key: 'broker_contact_email', type: 'string', defaultValue: '', category: 'broker_visibility' },
      { key: 'copy_first_contact', type: 'boolean', defaultValue: true, category: 'broker_visibility' },
      { key: 'copy_new_member_messages', type: 'boolean', defaultValue: true, category: 'broker_visibility' },
      { key: 'copy_high_risk_listing_messages', type: 'boolean', defaultValue: true, category: 'broker_visibility' },
      { key: 'random_sample_percentage', type: 'number', defaultValue: 0, category: 'broker_visibility', min: 0, max: 100 },
      { key: 'retention_days', type: 'number', defaultValue: 90, category: 'broker_visibility', min: 1, max: 3650 },
      // Compliance
      { key: 'insurance_enabled', type: 'boolean', defaultValue: false, category: 'compliance' },
      { key: 'enforce_insurance_on_exchanges', type: 'boolean', defaultValue: false, category: 'compliance' },
      { key: 'insurance_expiry_warning_days', type: 'number', defaultValue: 30, category: 'compliance', min: 1, max: 90 },
    ],
  },
  {
    id: 'organisations',
    icon: Building2,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'organisations.require_approval', type: 'boolean', defaultValue: false, category: 'moderation', comingSoon: true },
      { key: 'organisations.allow_org_wallets', type: 'boolean', defaultValue: true, category: 'features', comingSoon: true },
    ],
  },
  {
    id: 'federation',
    icon: Globe,
    type: 'feature',
    configSource: 'tenant_features',
    detailPageUrl: '/partner-timebanks/settings',
    configOptions: [
      { key: 'federation.auto_accept_partners', type: 'boolean', defaultValue: false, category: 'partnerships', comingSoon: true },
      { key: 'federation.share_listings', type: 'boolean', defaultValue: true, category: 'sharing', comingSoon: true },
      { key: 'federation.share_events', type: 'boolean', defaultValue: true, category: 'sharing', comingSoon: true },
    ],
  },
  {
    id: 'connections',
    icon: Link2,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'connections.max_connections', type: 'number', defaultValue: 0, category: 'limits', comingSoon: true, min: 0, max: 10000 },
      { key: 'connections.require_mutual', type: 'boolean', defaultValue: true, category: 'rules', comingSoon: true },
    ],
  },
  {
    id: 'reviews',
    icon: Star,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'reviews.require_exchange', type: 'boolean', defaultValue: true, category: 'rules', comingSoon: true },
      { key: 'reviews.allow_anonymous', type: 'boolean', defaultValue: false, category: 'features', comingSoon: true },
    ],
  },
  {
    id: 'polls',
    icon: BarChart3,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'polls.allow_member_creation', type: 'boolean', defaultValue: true, category: 'permissions', comingSoon: true },
      { key: 'polls.show_results_before_close', type: 'boolean', defaultValue: false, category: 'display', comingSoon: true },
    ],
  },
  {
    id: 'job_vacancies',
    icon: Briefcase,
    type: 'feature',
    configSource: 'job_config',
    configOptions: [
      // Tab / Page Visibility
      { key: 'jobs.tab_browse', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.tab_saved', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.tab_my_postings', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.page_kanban', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.page_analytics', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.page_bias_audit', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.page_talent_search', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      { key: 'jobs.page_alerts', type: 'boolean', defaultValue: true, category: 'tab_page_visibility' },
      // Job Types & Posting Rules
      { key: 'jobs.allow_paid', type: 'boolean', defaultValue: true, category: 'job_types_posting_rules' },
      { key: 'jobs.allow_volunteer', type: 'boolean', defaultValue: true, category: 'job_types_posting_rules' },
      { key: 'jobs.allow_timebank', type: 'boolean', defaultValue: true, category: 'job_types_posting_rules' },
      { key: 'jobs.require_salary', type: 'boolean', defaultValue: false, category: 'job_types_posting_rules' },
      { key: 'jobs.default_currency', type: 'select', defaultValue: 'EUR', category: 'job_types_posting_rules', choices: [{ value: 'EUR' }, { value: 'GBP' }, { value: 'USD' }] },
      { key: 'jobs.max_postings_per_user', type: 'number', defaultValue: 20, category: 'job_types_posting_rules', min: 1, max: 100 },
      { key: 'jobs.default_deadline_days', type: 'number', defaultValue: 30, category: 'job_types_posting_rules', min: 7, max: 365 },
      // Moderation
      { key: 'jobs.moderation_enabled', type: 'boolean', defaultValue: false, category: 'moderation' },
      { key: 'jobs.spam_detection', type: 'boolean', defaultValue: true, category: 'moderation' },
      { key: 'jobs.auto_approve_trusted', type: 'boolean', defaultValue: false, category: 'moderation' },
      // Applications & Pipeline
      { key: 'jobs.enable_cv_upload', type: 'boolean', defaultValue: true, category: 'applications_pipeline' },
      { key: 'jobs.require_cover_message', type: 'boolean', defaultValue: false, category: 'applications_pipeline' },
      { key: 'jobs.enable_interview_scheduling', type: 'boolean', defaultValue: true, category: 'applications_pipeline' },
      { key: 'jobs.enable_offers', type: 'boolean', defaultValue: true, category: 'applications_pipeline' },
      { key: 'jobs.enable_scorecards', type: 'boolean', defaultValue: true, category: 'applications_pipeline' },
      { key: 'jobs.enable_pipeline_rules', type: 'boolean', defaultValue: true, category: 'applications_pipeline' },
      { key: 'jobs.enable_blind_hiring', type: 'boolean', defaultValue: false, category: 'applications_pipeline' },
      // Features
      { key: 'jobs.enable_featured', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.featured_duration_days', type: 'number', defaultValue: 7, category: 'features', min: 1, max: 90 },
      { key: 'jobs.enable_ai_descriptions', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.enable_skills_matching', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.enable_referrals', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.enable_templates', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.enable_rss_feed', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.enable_saved_profiles', type: 'boolean', defaultValue: true, category: 'features' },
      { key: 'jobs.enable_employer_branding', type: 'boolean', defaultValue: true, category: 'features' },
    ],
  },
  {
    id: 'ideation_challenges',
    icon: Lightbulb,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'ideation.max_votes_per_user', type: 'number', defaultValue: 3, category: 'voting', comingSoon: true, min: 1, max: 20 },
      { key: 'ideation.allow_comments', type: 'boolean', defaultValue: true, category: 'features', comingSoon: true },
    ],
  },
  {
    id: 'direct_messaging',
    icon: MessageCircle,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'dm.require_connection', type: 'boolean', defaultValue: false, category: 'rules', comingSoon: true },
      { key: 'dm.rate_limit_per_hour', type: 'number', defaultValue: 30, category: 'limits', comingSoon: true, min: 1, max: 200 },
    ],
  },
  {
    id: 'group_exchanges',
    icon: Repeat2,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'group_exchanges.min_participants', type: 'number', defaultValue: 3, category: 'rules', comingSoon: true, min: 2, max: 50 },
      { key: 'group_exchanges.max_participants', type: 'number', defaultValue: 20, category: 'rules', comingSoon: true, min: 2, max: 100 },
    ],
  },
  {
    id: 'search',
    icon: Search,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'search.include_members', type: 'boolean', defaultValue: true, category: 'scope', comingSoon: true },
      { key: 'search.include_events', type: 'boolean', defaultValue: true, category: 'scope', comingSoon: true },
    ],
  },
  {
    id: 'ai_chat',
    icon: Brain,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'ai_chat.daily_message_limit', type: 'number', defaultValue: 50, category: 'limits', comingSoon: true, min: 0, max: 1000 },
      { key: 'ai_chat.show_context_sources', type: 'boolean', defaultValue: true, category: 'features', comingSoon: true },
    ],
  },
  {
    id: 'marketplace',
    icon: ShoppingBag,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [
      { key: 'marketplace.allow_shipping', type: 'boolean', defaultValue: false, category: 'general' },
      { key: 'marketplace.allow_free_items', type: 'boolean', defaultValue: true, category: 'general' },
      { key: 'marketplace.allow_business_sellers', type: 'boolean', defaultValue: true, category: 'general' },
      { key: 'marketplace.allow_community_delivery', type: 'boolean', defaultValue: false, category: 'general' },
      { key: 'marketplace.allow_hybrid_pricing', type: 'boolean', defaultValue: false, category: 'pricing' },
      { key: 'marketplace.stripe_enabled', type: 'boolean', defaultValue: false, category: 'pricing' },
      { key: 'marketplace.escrow_enabled', type: 'boolean', defaultValue: false, category: 'pricing' },
      { key: 'marketplace.platform_fee_percent', type: 'number', defaultValue: 5, category: 'pricing', min: 0, max: 50 },
      { key: 'marketplace.moderation_enabled', type: 'boolean', defaultValue: true, category: 'moderation' },
      { key: 'marketplace.promotions_enabled', type: 'boolean', defaultValue: false, category: 'moderation' },
      { key: 'marketplace.max_images', type: 'number', defaultValue: 20, category: 'limits', min: 1, max: 50 },
      { key: 'marketplace.max_active_listings', type: 'number', defaultValue: 50, category: 'limits', min: 1, max: 500 },
      { key: 'marketplace.listing_duration_days', type: 'number', defaultValue: 30, category: 'limits', min: 1, max: 365 },
    ],
  },
  {
    id: 'identity_verification',
    icon: ShieldCheck,
    type: 'feature',
    configSource: 'identity_config',
    configOptions: [
      { key: 'identity_verification_fee_cents', type: 'number', defaultValue: 500, category: 'pricing', min: 0, max: 10000 },
    ],
  },
  {
    id: 'two_factor_authentication',
    icon: KeyRound,
    type: 'feature',
    configSource: 'authentication_config',
    configOptions: [
      { key: 'two_factor.allow_trusted_devices', type: 'boolean', defaultValue: true, category: 'access' },
      { key: 'two_factor.trusted_device_days', type: 'number', defaultValue: 30, category: 'access', min: 1, max: 365 },
      { key: 'two_factor.backup_code_count', type: 'number', defaultValue: 10, category: 'recovery', min: 1, max: 100 },
    ],
  },
  {
    id: 'biometric_login',
    icon: Fingerprint,
    type: 'feature',
    configSource: 'authentication_config',
    configOptions: [
      { key: 'passkeys.enrollment_enabled', type: 'boolean', defaultValue: true, category: 'access' },
      { key: 'passkeys.conditional_autofill', type: 'boolean', defaultValue: true, category: 'access' },
      { key: 'passkeys.max_credentials_per_user', type: 'number', defaultValue: 10, category: 'access', min: 1, max: 20 },
    ],
  },
  {
    id: 'newsletter',
    icon: Mail,
    type: 'feature',
    configSource: 'tenant_features',
    detailPageUrl: '/admin/newsletters',
    configOptions: [],
  },
  {
    id: 'message_translation',
    icon: Languages,
    type: 'feature',
    configSource: 'tenant_features',
    configOptions: [],
  },
  {
    id: 'courses',
    icon: GraduationCap,
    type: 'feature',
    configSource: 'tenant_features',
    detailPageUrl: '/admin/courses',
    stage: 'alpha',
    configOptions: [
      { key: 'courses.allow_member_authoring', type: 'boolean', defaultValue: true, category: 'authoring' },
      { key: 'courses.moderation_enabled', type: 'boolean', defaultValue: false, category: 'moderation' },
      { key: 'courses.award_xp', type: 'boolean', defaultValue: true, category: 'gamification' },
      { key: 'courses.post_completions_to_feed', type: 'boolean', defaultValue: true, category: 'social', comingSoon: true },
    ],
  },
  {
    id: 'podcasts',
    // ModuleCard resolves config.module_name_podcasts; this internal fallback
    // deliberately avoids shipping an English user-facing label.
    icon: Podcast,
    type: 'feature',
    configSource: 'podcast_config',
    detailPageUrl: '/admin/podcasts',
    configOptions: [
      { key: 'podcasts.allow_member_show_creation', type: 'boolean', defaultValue: true, category: 'authoring' },
      { key: 'podcasts.max_shows_per_user', type: 'number', defaultValue: 5, category: 'authoring', min: 0, max: 100 },
      { key: 'podcasts.moderation_enabled', type: 'boolean', defaultValue: false, category: 'moderation' },
      { key: 'podcasts.enable_rss_feed', type: 'boolean', defaultValue: true, category: 'publishing' },
      { key: 'podcasts.enable_private_shows', type: 'boolean', defaultValue: true, category: 'publishing' },
      { key: 'podcasts.enable_transcripts', type: 'boolean', defaultValue: true, category: 'accessibility' },
      { key: 'podcasts.enable_chapters', type: 'boolean', defaultValue: true, category: 'accessibility' },
      { key: 'podcasts.enable_episode_reactions', type: 'boolean', defaultValue: true, category: 'community' },
      { key: 'podcasts.enable_listen_analytics', type: 'boolean', defaultValue: true, category: 'analytics' },
      { key: 'podcasts.max_audio_size_mb', type: 'number', defaultValue: 250, category: 'publishing', min: 10, max: 2000 },
      { key: 'podcasts.media_storage_driver', type: 'select', defaultValue: 'local', category: 'media', choices: [{ value: 'local' }, { value: 'cloud' }] },
      { key: 'podcasts.cloud_storage_disk', type: 'select', defaultValue: 's3', category: 'media', choices: [{ value: 's3' }] },
      { key: 'podcasts.cloud_cdn_base_url', type: 'string', defaultValue: '', category: 'media' },
      { key: 'podcasts.enable_media_scanning', type: 'boolean', defaultValue: true, category: 'media' },
      { key: 'podcasts.enable_media_processing', type: 'boolean', defaultValue: true, category: 'media' },
    ],
  },
  {
    id: 'member_premium',
    icon: HandHeart,
    type: 'feature',
    configSource: 'tenant_features',
    detailPageUrl: '/admin/member-premium',
    configOptions: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const MODULE_REGISTRY: ModuleDefinition[] = [...CORE_MODULES, ...FEATURE_MODULES];

export function getCoreModules(): ModuleDefinition[] {
  return CORE_MODULES;
}

export function getFeatureModules(): ModuleDefinition[] {
  return FEATURE_MODULES;
}

/** Get unique categories from a module's config options */
export function getOptionCategories(mod: ModuleDefinition): string[] {
  const cats = new Set(mod.configOptions.map(o => o.category));
  return Array.from(cats);
}

/** Count non-comingSoon (live) options */
export function getLiveOptionCount(mod: ModuleDefinition): number {
  return mod.configOptions.filter(o => !o.comingSoon).length;
}
