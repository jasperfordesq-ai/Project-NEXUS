// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Breadcrumbs
 * Auto-generates breadcrumbs from the current URL path
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import ChevronRight from 'lucide-react/icons/chevron-right';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface AdminBreadcrumbsProps {
  items?: BreadcrumbItem[];
}

// Map URL segments to i18n keys for breadcrumb labels
const SEGMENT_LABEL_KEYS: Record<string, string> = {
  '*': 'breadcrumbs.not_found',
  // Core
  admin: 'breadcrumbs.admin',
  create: 'breadcrumbs.create',
  edit: 'breadcrumbs.edit',
  detail: 'breadcrumbs.detail',
  list: 'breadcrumbs.list',

  // Users
  users: 'breadcrumbs.users',

  // CRM
  crm: 'breadcrumbs.crm',
  notes: 'breadcrumbs.notes',
  tasks: 'breadcrumbs.tasks',
  tags: 'breadcrumbs.tags',
  timeline: 'breadcrumbs.timeline',
  funnel: 'breadcrumbs.funnel',

  // Content
  listings: 'breadcrumbs.listings',
  blog: 'breadcrumbs.blog',
  pages: 'breadcrumbs.pages',
  builder: 'breadcrumbs.builder',
  menus: 'breadcrumbs.menus',
  categories: 'breadcrumbs.categories',
  attributes: 'breadcrumbs.attributes',
  plans: 'breadcrumbs.plans',
  subscriptions: 'breadcrumbs.subscriptions',

  // Engagement / Gamification
  gamification: 'breadcrumbs.gamification',
  campaigns: 'breadcrumbs.campaigns',
  'custom-badges': 'breadcrumbs.custom_badges',

  // Matching — broker-controls and admin match-approvals are fully retired;
  // all broker duties (incl. match approvals) live at /broker/*.
  'smart-matching': 'breadcrumbs.smart_matching',
  configuration: 'breadcrumbs.configuration',
  archives: 'breadcrumbs.archives',
  'match-debug': 'breadcrumbs.match_debug',

  // Moderation — content moderation (queue/feed/comments/reviews) moved to
  // the broker panel 2026-07-02; `moderation` and `reports` labels stay
  // because /admin/jobs|groups|marketplace/moderation and /admin/reports/*
  // still use them.
  moderation: 'breadcrumbs.moderation',
  reports: 'breadcrumbs.reports',

  // Newsletters / Marketing
  newsletters: 'breadcrumbs.newsletters',
  subscribers: 'breadcrumbs.subscribers',
  segments: 'breadcrumbs.segments',
  templates: 'breadcrumbs.templates',
  bounces: 'breadcrumbs.bounces',
  'send-time-optimizer': 'breadcrumbs.send_time_optimizer',
  diagnostics: 'breadcrumbs.diagnostics',
  stats: 'breadcrumbs.stats',
  activity: 'breadcrumbs.activity',

  // Advanced / SEO
  'ai-settings': 'breadcrumbs.ai_settings',
  'email-settings': 'breadcrumbs.email_settings',
  'algorithm-settings': 'breadcrumbs.algorithm_settings',
  seo: 'breadcrumbs.seo',
  audit: 'breadcrumbs.audit',
  redirects: 'breadcrumbs.redirects',
  '404-errors': 'breadcrumbs.errors_404',

  // Financial / Timebanking
  timebanking: 'breadcrumbs.timebanking',
  alerts: 'breadcrumbs.alerts',
  'user-report': 'breadcrumbs.user_report',
  'org-wallets': 'breadcrumbs.org_wallets',
  'create-org': 'breadcrumbs.create_org',
  'starting-balances': 'breadcrumbs.starting_balances',
  'community-fund': 'breadcrumbs.community_fund',

  // Enterprise
  enterprise: 'breadcrumbs.enterprise',
  roles: 'breadcrumbs.roles',
  permissions: 'breadcrumbs.permissions',
  gdpr: 'breadcrumbs.gdpr',
  requests: 'breadcrumbs.requests',
  consents: 'breadcrumbs.consents',
  breaches: 'breadcrumbs.breaches',
  monitoring: 'breadcrumbs.monitoring',
  health: 'breadcrumbs.health',
  logs: 'breadcrumbs.logs',
  config: 'breadcrumbs.config',
  secrets: 'breadcrumbs.secrets',

  // Performance
  performance: 'breadcrumbs.performance',

  // Legal Documents
  'legal-documents': 'breadcrumbs.legal_documents',
  compliance: 'breadcrumbs.compliance',
  versions: 'breadcrumbs.versions',

  // Federation
  federation: 'breadcrumbs.federation',
  aggregates: 'breadcrumbs.aggregates',
  partnerships: 'breadcrumbs.partnerships',
  directory: 'breadcrumbs.directory',
  profile: 'breadcrumbs.profile',
  'api-keys': 'breadcrumbs.api_keys',
  data: 'breadcrumbs.data',
  'credit-agreements': 'breadcrumbs.credit_agreements',
  neighborhoods: 'breadcrumbs.neighborhoods',
  'system-controls': 'breadcrumbs.system_controls',
  whitelist: 'breadcrumbs.whitelist',
  features: 'breadcrumbs.features',

  // Safeguarding — the dashboard + options moved to the broker panel
  // 2026-07-02; the `safeguarding` label stays for /admin/volunteering/safeguarding.
  safeguarding: 'breadcrumbs.safeguarding',

  // System
  settings: 'breadcrumbs.settings',
  'registration-policy': 'breadcrumbs.registration_policy',
  'onboarding-settings': 'breadcrumbs.onboarding_settings',
  'tenant-features': 'breadcrumbs.module_configuration',
  'module-configuration': 'breadcrumbs.module_configuration',
  operations: 'breadcrumbs.operations',
  'support-reports': 'breadcrumbs.support_reports',
  'translation-config': 'breadcrumbs.translation_config',
  'cron-jobs': 'breadcrumbs.cron_jobs',
  setup: 'breadcrumbs.setup',
  'activity-log': 'breadcrumbs.activity_log',
  tests: 'breadcrumbs.tests',
  'seed-generator': 'breadcrumbs.seed_generator',
  'webp-converter': 'breadcrumbs.webp_converter',
  'image-settings': 'breadcrumbs.image_settings',
  'native-app': 'breadcrumbs.native_app',
  'blog-restore': 'breadcrumbs.blog_restore',

  // Community / Groups
  groups: 'breadcrumbs.groups',
  approvals: 'breadcrumbs.approvals',
  opportunities: 'breadcrumbs.opportunities',
  types: 'breadcrumbs.types',
  recommendations: 'breadcrumbs.recommendations',
  ranking: 'breadcrumbs.ranking',
  'smart-match-users': 'breadcrumbs.smart_match_users',
  'smart-match-monitoring': 'breadcrumbs.smart_match_monitoring',

  // Volunteering
  volunteering: 'breadcrumbs.volunteering',
  organizations: 'breadcrumbs.organizations',

  // Events, Polls, Goals, Resources, Jobs, Ideation
  events: 'breadcrumbs.events',
  polls: 'breadcrumbs.polls',
  goals: 'breadcrumbs.goals',
  resources: 'breadcrumbs.resources',
  jobs: 'breadcrumbs.jobs',
  ideation: 'breadcrumbs.ideation',

  // Deliverability
  deliverability: 'breadcrumbs.deliverability',
  'email-deliverability': 'breadcrumbs.email_deliverability',

  // Diagnostics
  'matching-diagnostic': 'breadcrumbs.matching_diagnostic',
  'nexus-score': 'breadcrumbs.nexus_score',

  // Analytics & Reporting
  analytics: 'breadcrumbs.analytics',
  regional: 'breadcrumbs.regional',
  'community-analytics': 'breadcrumbs.community_analytics',
  'impact-report': 'breadcrumbs.impact_report',
  members: 'breadcrumbs.members',
  hours: 'breadcrumbs.hours',
  'inactive-members': 'breadcrumbs.inactive_members',

  // Super Admin
  super: 'breadcrumbs.super',
  tenants: 'breadcrumbs.tenants',
  hierarchy: 'breadcrumbs.hierarchy',
  bulk: 'breadcrumbs.bulk',
  'audit-log': 'breadcrumbs.audit_log',

  // Jobs sub-pages
  pipeline: 'breadcrumbs.pipeline',
  'bias-audit': 'breadcrumbs.bias_audit',

  // Marketplace
  marketplace: 'breadcrumbs.marketplace',
  coupons: 'breadcrumbs.coupons',
  sellers: 'breadcrumbs.sellers',

  // Billing
  billing: 'breadcrumbs.billing',
  invoices: 'breadcrumbs.invoices',
  revenue: 'breadcrumbs.revenue',
  'checkout-return': 'breadcrumbs.checkout_return',

  // Caring Community legacy admin redirects
  'caring-community': 'breadcrumbs.caring_community',
  workflow: 'breadcrumbs.workflow',
  loyalty: 'breadcrumbs.loyalty',
  'hour-transfers': 'breadcrumbs.hour_transfers',
  'sub-regions': 'breadcrumbs.sub_regions',
  'federation-peers': 'breadcrumbs.federation_peers',
  'sla-dashboard': 'breadcrumbs.sla_dashboard',
  providers: 'breadcrumbs.providers',
  'warmth-pass': 'breadcrumbs.warmth_pass',
  'recipient-circle': 'breadcrumbs.recipient_circle',
  nudges: 'breadcrumbs.nudges',
  'emergency-alerts': 'breadcrumbs.emergency_alerts',
  surveys: 'breadcrumbs.surveys',
  copilot: 'breadcrumbs.copilot',
  'civic-digest': 'breadcrumbs.civic_digest',
  'lead-nurture': 'breadcrumbs.lead_nurture',
  'success-stories': 'breadcrumbs.success_stories',
  feedback: 'breadcrumbs.feedback',
  verification: 'breadcrumbs.verification',
  'trust-tier': 'breadcrumbs.trust_tier',
  'launch-readiness': 'breadcrumbs.launch_readiness',
  'pilot-scoreboard': 'breadcrumbs.pilot_scoreboard',
  'data-quality': 'breadcrumbs.data_quality',
  'operating-policy': 'breadcrumbs.operating_policy',
  'disclosure-pack': 'breadcrumbs.disclosure_pack',
  'commercial-boundary': 'breadcrumbs.commercial_boundary',
  'isolated-node': 'breadcrumbs.isolated_node',
  research: 'breadcrumbs.research',
  'external-integrations': 'breadcrumbs.external_integrations',
  'integration-showcase': 'breadcrumbs.integration_showcase',
  'municipal-impact': 'breadcrumbs.municipal_impact',
  'kpi-baselines': 'breadcrumbs.kpi_baselines',
  'municipal-roi': 'breadcrumbs.municipal_roi',
  'category-coefficients': 'breadcrumbs.category_coefficients',
  'regional-points': 'breadcrumbs.regional_points',

  // Config / Setup
  advertising: 'breadcrumbs.advertising',
  'api-docs': 'breadcrumbs.api_docs',
  'api-partners': 'breadcrumbs.api_partners',
  'badge-config': 'breadcrumbs.badge_config',
  'cc-config': 'breadcrumbs.cc_config',
  'consent-types': 'breadcrumbs.consent_types',
  'feed-algorithm': 'breadcrumbs.feed_algorithm',
  'landing-page': 'breadcrumbs.landing_page',
  requirements: 'breadcrumbs.requirements',
  tenant: 'breadcrumbs.tenant',
  webhooks: 'breadcrumbs.webhooks',
  login: 'breadcrumbs.login',
  podcasts: 'breadcrumbs.podcasts',
  'member-premium': 'breadcrumbs.member_premium',
  fadp: 'breadcrumbs.fadp',
  'push-campaigns': 'breadcrumbs.push_campaigns',
  ai: 'breadcrumbs.ai',
  'ki-agents': 'breadcrumbs.ki_agents',
  agents: 'breadcrumbs.agents',
  proposals: 'breadcrumbs.proposals',
  runs: 'breadcrumbs.runs',
  platform: 'breadcrumbs.platform',
  'pilot-inquiries': 'breadcrumbs.pilot_inquiries',
  'provisioning-requests': 'breadcrumbs.provisioning_requests',
  national: 'breadcrumbs.national',
  kiss: 'breadcrumbs.kiss',
  'regional-analytics': 'breadcrumbs.regional_analytics',
  help: 'breadcrumbs.help',

  // Groups / Community
  'external-partners': 'breadcrumbs.external_partners',
  'geocode-groups': 'breadcrumbs.geocode_groups',
  'group-locations': 'breadcrumbs.group_locations',
  'group-ranking': 'breadcrumbs.group_ranking',
  'group-types': 'breadcrumbs.group_types',

  // Impact / Reporting
  'giving-days': 'breadcrumbs.giving_days',
  'social-value': 'breadcrumbs.social_value',
  projects: 'breadcrumbs.projects',
  training: 'breadcrumbs.training',
  qualifications: 'breadcrumbs.qualifications',
  certificates: 'breadcrumbs.certificates',
  expenses: 'breadcrumbs.expenses',

  // Logs
  'log-files': 'breadcrumbs.log_files',
  prerender: 'breadcrumbs.prerender',
  'module-docs': 'breadcrumbs.module_docs',
  metrics: 'breadcrumbs.metrics',
};

export function AdminBreadcrumbs({ items }: AdminBreadcrumbsProps) {
  const { t } = useTranslation('admin_nav');
  const location = useLocation();
  const { tenantSlug } = useTenant();

  // Auto-generate breadcrumbs from URL if not provided
  const breadcrumbs: BreadcrumbItem[] = items || (() => {
    let path = location.pathname;

    // Strip tenant slug prefix if present
    if (tenantSlug) {
      path = path.replace(`/${tenantSlug}`, '');
    }

    const segments = path.split('/').filter(Boolean);
    const crumbs: BreadcrumbItem[] = [];

    let currentPath = tenantSlug ? `/${tenantSlug}` : '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;
      currentPath += `/${segment}`;

      // Skip numeric IDs
      if (/^\d+$/.test(segment)) continue;

      // Breadcrumb labels must be fully translatable. If a URL segment is not
      // in SEGMENT_LABEL_KEYS, or the mapped key has no locale value, render
      // a visible "⚠ <segment>" marker instead of silently humanizing the
      // segment in English — that way missing mappings are noticed and
      // fixed rather than hiding as "fine-looking" hardcoded English.
      // CI guardrail: scripts/check-admin-breadcrumbs.mjs blocks unmapped segments.
      const labelKey = SEGMENT_LABEL_KEYS[segment];
      let label: string;
      if (labelKey) {
        const translated = t(labelKey);
        label = translated && translated !== labelKey ? translated : `⚠ ${segment}`;
      } else {
        label = `⚠ ${segment}`;
      }
      const isLast = i === segments.length - 1;

      crumbs.push({
        label,
        href: isLast ? undefined : currentPath,
      });
    }

    return crumbs;
  })();

  if (breadcrumbs.length <= 1) return null;

  return (
    <nav aria-label={t('aria.breadcrumbs')} className="mb-4 max-w-full overflow-x-auto pb-1">
      <ol className="flex w-max max-w-full items-center gap-1.5 text-sm text-muted">
        {breadcrumbs.map((crumb, index) => (
          <li key={crumb.label} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight size={14} className="shrink-0 text-muted/60" />}
            {index === 0 && <LayoutDashboard size={14} className="mr-1 shrink-0" />}
            {crumb.href ? (
              <Link
                to={crumb.href}
                className="max-w-[9rem] truncate hover:text-foreground transition-colors sm:max-w-[14rem]"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="max-w-[12rem] truncate font-medium text-foreground sm:max-w-[18rem]">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default AdminBreadcrumbs;
