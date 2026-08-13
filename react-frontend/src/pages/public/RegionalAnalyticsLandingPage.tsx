// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG59 - Public marketing landing page for the Paid Regional Analytics
 * product. Pitches the offering to municipalities and SME partners and
 * routes interest into the existing /contact form.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Download from 'lucide-react/icons/download';
import MapPin from 'lucide-react/icons/map-pin';
import ShieldCheck from 'lucide-react/icons/shield-check';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

export default function RegionalAnalyticsLandingPage() {
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  usePageTitle(t('regional_analytics.page_title'));

  const features = [
    {
      icon: TrendingUp,
      title: t('regional_analytics.feature_trends_title'),
      body: t('regional_analytics.feature_trends_body'),
    },
    {
      icon: MapPin,
      title: t('regional_analytics.feature_demand_supply_title'),
      body: t('regional_analytics.feature_demand_supply_body'),
    },
    {
      icon: Users,
      title: t('regional_analytics.feature_demographics_title'),
      body: t('regional_analytics.feature_demographics_body'),
    },
    {
      icon: BarChart3,
      title: t('regional_analytics.feature_footfall_title'),
      body: t('regional_analytics.feature_footfall_body'),
    },
  ];

  const tiers: Array<{
    key: 'basic' | 'pro' | 'enterprise';
    price: string;
    description: string;
    features: string[];
  }> = [
    {
      key: 'basic',
      price: t('regional_analytics.tiers.basic.price'),
      description: t('regional_analytics.tiers.basic.description'),
      features: [
        t('regional_analytics.tiers.basic.feature_1'),
        t('regional_analytics.tiers.basic.feature_2'),
        t('regional_analytics.tiers.basic.feature_3'),
      ],
    },
    {
      key: 'pro',
      price: t('regional_analytics.tiers.pro.price'),
      description: t('regional_analytics.tiers.pro.description'),
      features: [
        t('regional_analytics.tiers.pro.feature_1'),
        t('regional_analytics.tiers.pro.feature_2'),
        t('regional_analytics.tiers.pro.feature_3'),
        t('regional_analytics.tiers.pro.feature_4'),
      ],
    },
    {
      key: 'enterprise',
      price: t('regional_analytics.tiers.enterprise.price'),
      description: t('regional_analytics.tiers.enterprise.description'),
      features: [
        t('regional_analytics.tiers.enterprise.feature_1'),
        t('regional_analytics.tiers.enterprise.feature_2'),
        t('regional_analytics.tiers.enterprise.feature_3'),
        t('regional_analytics.tiers.enterprise.feature_4'),
      ],
    },
  ];

  const contactSubject = encodeURIComponent(t('regional_analytics.contact_subject'));

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-16">
      <PageMeta title={t('regional_analytics.page_title')} description={t('regional_analytics.meta_description')} />
      <section className="text-center space-y-4">
        <Chip color="accent" variant="tertiary">
          <ShieldCheck size={14} aria-hidden="true" />
          {t('regional_analytics.privacy_badge')}
        </Chip>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          {t('regional_analytics.hero_title')}
        </h1>
        <p className="text-lg text-[var(--color-text-muted)] max-w-2xl mx-auto">
          {t('regional_analytics.hero_subtitle')}
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Button as={Link} to={tenantPath(`/contact?subject=${contactSubject}`)} variant="primary" size="lg">
            {t('regional_analytics.cta_request_access')}
          </Button>
          <Button as={Link} to={tenantPath('/about')} variant="tertiary" size="lg">
            {t('regional_analytics.cta_learn_more')}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-center mb-6">
          {t('regional_analytics.features_heading')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title}>
                <Card.Content className="flex flex-row gap-4 p-5">
                  <div className="rounded-lg bg-accent-soft dark:bg-accent-soft p-3 h-fit">
                    <Icon size={22} className="text-accent dark:text-accent" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{feature.title}</h3>
                    <p className="text-sm text-[var(--color-text-muted)]">{feature.body}</p>
                  </div>
                </Card.Content>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-center mb-6">
          {t('regional_analytics.pricing_heading')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((tier) => {
            const tierLabel = t(`regional_analytics.tiers.${tier.key}.label`);
            return (
              <Card key={tier.key} className={tier.key === 'pro' ? 'border-2 border-accent' : undefined}>
                <Card.Content className="p-6">
                  <Chip size="sm" variant="tertiary" color={tier.key === 'pro' ? 'accent' : 'default'} className="mb-3">
                    {tierLabel}
                  </Chip>
                  <div className="text-2xl font-bold mb-1">{tier.price}</div>
                  <p className="text-sm text-[var(--color-text-muted)] mb-4">{tier.description}</p>
                  <ul className="space-y-2 mb-5">
                    {tier.features.map((feature) => (
                      <li key={feature} className="text-sm flex items-start gap-2">
                        <span className="text-accent" aria-hidden="true">-</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    as={Link}
                    to={tenantPath(`/contact?subject=${contactSubject}%20-%20${encodeURIComponent(tierLabel)}`)}
                    variant={tier.key === 'pro' ? 'primary' : 'secondary'}
                    fullWidth
                    startContent={<Download size={16} aria-hidden="true" />}
                  >
                    {t('regional_analytics.tier_cta')}
                  </Button>
                </Card.Content>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="text-center pt-8 border-t border-[var(--color-border)]">
        <ShieldCheck size={32} className="mx-auto text-[var(--color-text-muted)] mb-3" aria-hidden="true" />
        <p className="text-sm text-[var(--color-text-muted)] max-w-2xl mx-auto">
          {t('regional_analytics.privacy_footer')}
        </p>
      </section>
    </div>
  );
}
