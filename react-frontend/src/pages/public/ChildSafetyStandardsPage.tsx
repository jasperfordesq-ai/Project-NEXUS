// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Flag from 'lucide-react/icons/flag';
import Gavel from 'lucide-react/icons/gavel';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';

const PROHIBITED_ITEM_COUNT = 5;
const RESPONSE_ITEM_COUNT = 5;

export function ChildSafetyStandardsPage() {
  const { t } = useTranslation('legal');
  const { tenantPath } = useTenant();
  usePageTitle(t('child_safety.page_title'));

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <PageMeta title={t('child_safety.page_title')} description={t('child_safety.meta_description')} />

      <div className="text-center">
        <div className="mb-4 inline-flex rounded-2xl bg-rose-500/15 p-4">
          <ShieldAlert className="h-10 w-10 text-rose-500" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold text-theme-primary sm:text-4xl">
          {t('child_safety.heading')}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-theme-muted">
          {t('child_safety.subtitle')}
        </p>
        <p className="mt-3 text-sm text-theme-subtle">{t('child_safety.effective_date')}</p>
      </div>

      <GlassCard className="border-l-4 border-rose-500/60 p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-theme-primary">{t('child_safety.zero_tolerance_title')}</h2>
        <p className="mt-3 text-theme-muted">{t('child_safety.zero_tolerance_body')}</p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-theme-muted">
          {Array.from({ length: PROHIBITED_ITEM_COUNT }, (_, index) => (
            <li key={index}>{t(`child_safety.prohibited_items.${index}`)}</li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
          <Flag className="h-5 w-5 text-accent" aria-hidden="true" />
          {t('child_safety.reporting_title')}
        </h2>
        <p className="mt-3 text-theme-muted">{t('child_safety.reporting_body')}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-theme-muted">
          <li>{t('child_safety.reporting_steps.0')}</li>
          <li>{t('child_safety.reporting_steps.1')}</li>
          <li>{t('child_safety.reporting_steps.2')}</li>
        </ol>
        <Button
          as={Link}
          to={tenantPath('/contact?topic=child-safety')}
          className="mt-5 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
        >
          {t('child_safety.reporting_button')}
        </Button>
      </GlassCard>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
          <Gavel className="h-5 w-5 text-accent" aria-hidden="true" />
          {t('child_safety.response_title')}
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-theme-muted">
          {Array.from({ length: RESPONSE_ITEM_COUNT }, (_, index) => (
            <li key={index}>{t(`child_safety.response_items.${index}`)}</li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
          <Mail className="h-5 w-5 text-accent" aria-hidden="true" />
          {t('child_safety.contact_title')}
        </h2>
        <p className="mt-3 text-theme-muted">{t('child_safety.contact_body')}</p>
        <a className="mt-3 inline-block font-medium text-accent hover:underline" href="mailto:jasper@timebank.global">
          {t('child_safety.contact_email')}
        </a>
        <p className="mt-3 text-sm text-theme-subtle">{t('child_safety.operator_body')}</p>
      </GlassCard>
    </div>
  );
}

export default ChildSafetyStandardsPage;
