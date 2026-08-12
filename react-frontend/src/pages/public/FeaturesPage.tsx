// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Sparkles from 'lucide-react/icons/sparkles';
import Globe from 'lucide-react/icons/globe';
import Shield from 'lucide-react/icons/shield';
import Github from 'lucide-react/icons/github';
import Bug from 'lucide-react/icons/bug';
import ExternalLink from 'lucide-react/icons/external-link';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Separator } from '@/components/ui/Separator';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTenant } from '@/contexts';
/**
 * Features Page
 *
 * Public marketing page documenting every module shipped in Project NEXUS
 * v1.5 (GA). Each module is honestly labelled with its maturity:
 *
 *   - (unmarked)  General Availability — stable, supported, used in production
 *   - Beta        Working in production, surface still hardening
 *   - Preview     Recently shipped, available to opt in, may change
 *   - Dormant     Built and tested, switched off by default, not in use
 *
 * `dormant` was added on 2026-07-30 because the first three labels all assert
 * production USE — GA says "used in production", Beta says "working in
 * production today". External partner federation is complete and tested but has
 * been switched off platform-wide since the 2026-07-27 deploy, with no partner
 * connected and zero external callers in twelve weeks of access logs. Labelled
 * `beta`, it had acquired a description claiming real partnerships exchanging
 * data daily, on a page whose own subheading promises honest labelling. The
 * vocabulary had no way to say "we built this, it works, nobody needs it yet",
 * so the copy drifted into claiming the opposite. Use `dormant` for any
 * capability that is finished but deliberately not switched on.
 *
 * 🔴 Federation is TWO different things and the labels must keep them apart.
 * Internal cross-tenant federation (communities on one installation) is live and
 * ungated by design — its admin surfaces under /v2/admin/federation/* carry no
 * kill switch. External partner federation (other installations and other
 * platforms) is the dormant one. Commit b9beb929d exists because that
 * distinction had already been lost once.
 *
 * The page replaces the previous "Development Status" page; the old route
 * still redirects here so existing bookmarks survive.
 */


// ---------------------------------------------------------------------------
// Maturity chip
// ---------------------------------------------------------------------------

type Maturity = 'ga' | 'beta' | 'preview' | 'dormant';

function MaturityChip({ level }: { level: Maturity }) {
  const { t } = useTranslation('public');
  if (level === 'ga') return null;
  const config: Record<Exclude<Maturity, 'ga'>, { color: 'warning' | 'accent' | 'default'; label: string }> = {
    beta: { color: 'warning', label: t('features_page.chips.beta') },
    preview: { color: 'accent', label: t('features_page.chips.preview') },
    // Neutral, not a warning: nothing is wrong with a finished capability that
    // is switched off. It is a statement of availability, not of quality.
    dormant: { color: 'default', label: t('features_page.chips.dormant') },
  };
  const { color, label } = config[level];
  return (
    <Chip color={color} variant="tertiary" size="sm" className="ms-2 align-middle">
      {label}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Feature item
// ---------------------------------------------------------------------------

interface FeatureItem {
  key: string;
  maturity?: Maturity;
}

function FeatureList({ groupKey, items }: { groupKey: string; items: FeatureItem[] }) {
  const { t, i18n } = useTranslation('public');

  return (
    <ul className="space-y-3 list-none">
      {items.map((item) => {
        const copyKey = `features_page.groups.${groupKey}.items.${item.key}`;
        const noteKey = `${copyKey}.note`;
        const note = i18n.exists(noteKey, { ns: 'public' }) ? t(noteKey) : '';

        return (
          <li key={item.key} className="flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-success shrink-0 mt-1" aria-hidden="true" />
            <div className="text-sm">
              <span className="font-semibold text-foreground">{t(`${copyKey}.title`)}</span>
              <MaturityChip level={item.maturity ?? 'ga'} />
              <span className="text-theme-muted"> {t(`${copyKey}.description`)}</span>
              {note && (
                <p className="text-xs text-theme-muted mt-1 italic">{note}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface FeatureGroup {
  key: string;
  items: FeatureItem[];
}

function FeatureSection({
  group,
  icon,
}: {
  group: FeatureGroup;
  icon?: ReactNode;
}) {
  const { t, i18n } = useTranslation('public');
  const groupKey = `features_page.groups.${group.key}`;
  const introKey = `${groupKey}.intro`;
  const intro = i18n.exists(introKey, { ns: 'public' }) ? t(introKey) : '';

  return (
    <Card className="border border-border shadow-sm">
      <Card.Header className="flex gap-2 items-center">
        {icon}
        <h2 className="text-lg font-semibold">{t(`${groupKey}.title`)}</h2>
      </Card.Header>
      <Separator />
      <Card.Content className="space-y-3">
        {intro && <p className="text-sm text-theme-muted">{intro}</p>}
        <FeatureList groupKey={group.key} items={group.items} />
      </Card.Content>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Feature inventory
// ---------------------------------------------------------------------------

const GROUPS: FeatureGroup[] = [
  {
    key: 'core_platform',
    items: [
      {
        key: 'timebanking_engine'
      },
      {
        key: 'multi_tenancy'
      },
      {
        key: 'tenant_hierarchy'
      },
      {
        key: 'smart_matching'
      },
      {
        key: 'real_time_messaging'
      },
      {
        key: 'progressive_web_app'
      },
      {
        key: 'native_mobile_app',
        maturity: 'beta'
      }
    ]
  },
  {
    key: 'federation',
    items: [
      // Internal cross-tenant federation: live, ungated by design.
      {
        key: 'federation_network'
      },
      {
        key: 'federation_neighborhoods',
        maturity: 'beta'
      },
      {
        key: 'credit_agreements',
        maturity: 'beta'
      },
      {
        key: 'federation_analytics'
      },
      // External partner federation: complete, tested, switched off by default.
      // Not 'beta' — beta asserts "working in production today", and nothing is
      // connected. See the header note on the dormant label.
      {
        key: 'external_partner_federation',
        maturity: 'dormant'
      },
      {
        key: 'multi_protocol_adapters',
        maturity: 'dormant'
      }
    ]
  },
  {
    key: 'member_experience',
    items: [
      {
        key: 'service_listings'
      },
      {
        key: 'marketplace',
        maturity: 'beta'
      },
      {
        key: 'donations'
      },
      {
        key: 'identity_verification',
        maturity: 'beta'
      },
      {
        key: 'exchange_workflow'
      },
      {
        key: 'group_exchanges'
      },
      {
        key: 'social_feed'
      },
      {
        key: 'stories',
        maturity: 'beta'
      },
      {
        key: 'presence_system'
      },
      {
        key: 'events_and_groups'
      },
      {
        key: 'connections'
      },
      {
        key: 'members_directory'
      },
      {
        key: 'gamification'
      },
      {
        key: 'goals_and_impact'
      },
      {
        key: 'ideation_challenges'
      },
      {
        key: 'volunteering'
      },
      {
        key: 'job_vacancies'
      },
      {
        key: 'organisations'
      },
      {
        key: 'sub_accounts_family_accounts'
      },
      {
        key: 'reviews_and_ratings'
      },
      {
        key: 'endorsements'
      },
      {
        key: 'polls'
      },
      {
        key: 'skills_browse'
      },
      {
        key: 'availability_scheduling'
      }
    ]
  },
  {
    key: 'content_and_communication',
    items: [
      {
        key: 'blog'
      },
      {
        key: 'resources_and_knowledge_base'
      },
      {
        key: 'help_center'
      },
      {
        key: 'custom_pages'
      },
      {
        key: 'newsletter_system'
      },
      {
        key: 'ai_chat',
        maturity: 'beta'
      },
      {
        key: 'legal_hub'
      },
      {
        key: 'impact_reports'
      },
      {
        key: 'social_prescribing',
        maturity: 'preview'
      }
    ]
  },
  {
    key: 'trust_reputation_and_safety',
    items: [
      {
        key: 'member_verification_badges'
      },
      {
        key: 'nexusscore'
      },
      {
        key: 'streaks'
      },
      {
        key: 'personal_insights_dashboard'
      },
      {
        key: 'safeguarding_module'
      },
      {
        key: 'crm'
      }
    ]
  },
  {
    key: 'ai_and_recommendation_engine',
    items: [
      {
        key: 'semantic_search'
      },
      {
        key: 'collaborative_filtering'
      },
      {
        key: 'semantic_embeddings'
      },
      {
        key: 'edgerank_feed'
      },
      {
        key: 'matchrank_and_communityrank'
      },
      {
        key: 'group_recommendations'
      },
      {
        key: 'match_learning'
      },
      {
        key: 'algorithm_health_dashboard'
      }
    ]
  },
  {
    key: 'caring_community_layer',
    items: [
      {
        key: 'civic_digest',
        maturity: 'preview'
      },
      {
        key: 'success_stories',
        maturity: 'preview'
      },
      {
        key: 'feedback_inbox',
        maturity: 'preview'
      },
      {
        key: 'integration_showcase',
        maturity: 'preview'
      },
      {
        key: 'lead_nurture',
        maturity: 'preview'
      },
      {
        key: 'copilot',
        maturity: 'preview'
      }
    ]
  },
  {
    key: 'built_for_production',
    items: [
      {
        key: 'enterprise_security'
      },
      {
        key: 'stripe_payments_layer'
      },
      {
        key: 'gdpr_compliance_suite'
      },
      {
        key: 'fraud_and_abuse_detection'
      },
      {
        key: 'insurance_certificate_tracking'
      },
      {
        key: 'enterprise_rbac'
      },
      {
        key: 'wcag_2_1_aa_accessibility'
      },
      {
        key: 'multi_language_support'
      },
      {
        key: 'self_hosted_prerendering'
      },
      {
        key: 'guided_onboarding'
      },
      {
        key: 'admin_panel'
      },
      {
        key: 'email_webhook_processing'
      },
      {
        key: '500plus_phpunit_tests'
      },
      {
        key: 'openapi_3_0_specification'
      },
      {
        key: 'fully_dockerized'
      }
    ]
  }
];


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FeaturesPage() {
  const { t } = useTranslation('public');
  const { tenantPath } = useTenant();
  usePageTitle(t('features_page.title'));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-4 sm:px-6 lg:px-8">
      <PageMeta
        title={t('features_page.meta_title')}
        description={t('features_page.meta_description')}
      />

      {/* Hero */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Sparkles className="w-7 h-7 text-accent shrink-0" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
            {t('features_page.heading')}
          </h1>
          <Chip color="success" variant="tertiary" size="sm">
            {t('release_stage')}
          </Chip>
        </div>
        <p className="text-sm sm:text-base text-theme-muted">
          {t('features_page.subheading')}
        </p>
      </div>

      {/* Maturity key */}
      <Card className="border border-border shadow-sm">
        <Card.Content className="text-sm space-y-2">
          <p className="font-semibold text-foreground">
            {t('features_page.maturity_key_title')}
          </p>
          <ul className="space-y-1.5 list-none">
            <li className="flex items-start gap-2">
              <Chip color="success" variant="tertiary" size="sm" className="shrink-0">GA</Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_ga')}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Chip color="warning" variant="tertiary" size="sm" className="shrink-0">
                {t('features_page.chips.beta')}
              </Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_beta')}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Chip color="accent" variant="tertiary" size="sm" className="shrink-0">
                {t('features_page.chips.preview')}
              </Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_preview')}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Chip color="default" variant="tertiary" size="sm" className="shrink-0">
                {t('features_page.chips.dormant')}
              </Chip>
              <span className="text-theme-muted">
                {t('features_page.maturity_dormant')}
              </span>
            </li>
          </ul>
        </Card.Content>
      </Card>

      {/* Feature groups */}
      {GROUPS.map((group, index) => {
        const icons = [
          <Sparkles key="feature-icon-0" className="w-5 h-5 text-accent" aria-hidden="true" />,
          <Globe key="feature-icon-1" className="w-5 h-5 text-accent" aria-hidden="true" />,
          <CheckCircle key="feature-icon-2" className="w-5 h-5 text-success" aria-hidden="true" />,
          <CheckCircle key="feature-icon-3" className="w-5 h-5 text-success" aria-hidden="true" />,
          <Shield key="feature-icon-4" className="w-5 h-5 text-warning" aria-hidden="true" />,
          <Sparkles key="feature-icon-5" className="w-5 h-5 text-accent" aria-hidden="true" />,
          <Sparkles key="feature-icon-6" className="w-5 h-5 text-accent" aria-hidden="true" />,
          <Shield key="feature-icon-7" className="w-5 h-5 text-accent" aria-hidden="true" />,
        ];
        return <FeatureSection key={group.key} group={group} icon={icons[index]} />;
      })}

      {/* Modern Tech Stack */}
      <Card className="border border-border shadow-sm">
        <Card.Header>
          <h2 className="text-lg font-semibold">
            {t('features_page.tech_stack_title')}
          </h2>
        </Card.Header>
        <Separator />
        <Card.Content className="text-sm text-theme-muted">
          <ul className="grid sm:grid-cols-2 gap-y-1.5 gap-x-6 list-none">
            <li><strong>{t('features_page.tech_stack.frontend_label')}:</strong> {t('features_page.tech_stack.frontend_value')}</li>
            <li><strong>{t('features_page.tech_stack.backend_label')}:</strong> {t('features_page.tech_stack.backend_value')}</li>
            <li><strong>{t('features_page.tech_stack.database_label')}:</strong> {t('features_page.tech_stack.database_value')}</li>
            <li><strong>{t('features_page.tech_stack.search_label')}:</strong> {t('features_page.tech_stack.search_value')}</li>
            <li><strong>{t('features_page.tech_stack.ai_label')}:</strong> {t('features_page.tech_stack.ai_value')}</li>
            <li><strong>{t('features_page.tech_stack.realtime_label')}:</strong> {t('features_page.tech_stack.realtime_value')}</li>
            <li><strong>{t('features_page.tech_stack.mobile_label')}:</strong> {t('features_page.tech_stack.mobile_value')}</li>
            <li><strong>{t('features_page.tech_stack.infrastructure_label')}:</strong> {t('features_page.tech_stack.infrastructure_value')}</li>
          </ul>
        </Card.Content>
      </Card>

      {/* Open source + how to help */}
      <Card className="border border-accent dark:border-accent">
        <Card.Header className="flex gap-2 items-center">
          <Github className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            {t('features_page.open_source_title')}
          </h2>
        </Card.Header>
        <Separator />
        <Card.Content className="text-sm text-theme-muted space-y-3">
          <p>
            {t('features_page.open_source_body')}
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://github.com/jasperfordesq-ai/Project-NEXUS"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              <Github className="w-3.5 h-3.5" aria-hidden="true" />
              {t('features_page.link_repo')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <Link
              to={tenantPath('/changelog')}
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              {t('features_page.link_changelog')}
            </Link>
            <a
              href="https://project-nexus.canny.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              <Bug className="w-3.5 h-3.5" aria-hidden="true" />
              {t('features_page.link_report_bug')}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <Link
              to={tenantPath('/about')}
              className="inline-flex items-center gap-1.5 text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              {t('features_page.link_about')}
            </Link>
          </div>
        </Card.Content>
      </Card>

      {/* Security disclosure */}
      <Card className="border border-danger-200 dark:border-danger-800">
        <Card.Header className="flex gap-2 items-center">
          <Shield className="w-5 h-5 text-danger" aria-hidden="true" />
          <h2 className="text-lg font-semibold">
            {t('features_page.security_title')}
          </h2>
        </Card.Header>
        <Separator />
        <Card.Content className="text-sm text-theme-muted">
          <p>
            {t('features_page.security_body_before')}
            <a
              href="mailto:jasper@hour-timebank.ie"
              className="text-accent underline font-medium focus:outline-none focus:ring-2 focus:ring-accent rounded"
            >
              {t('features_page.security_email')}
            </a>
            {t('features_page.security_body_after')}
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}

export default FeaturesPage;
