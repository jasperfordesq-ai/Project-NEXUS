// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Link } from 'react-router-dom';
import Trash2 from 'lucide-react/icons/trash-2';
import Smartphone from 'lucide-react/icons/smartphone';
import Mail from 'lucide-react/icons/mail';
import Database from 'lucide-react/icons/database';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';

const DELETED_ITEM_COUNT = 6;
const RETAINED_ITEM_COUNT = 3;

export function AccountDeletionPage() {
  const { t } = useTranslation('legal');
  const { tenantPath } = useTenant();
  usePageTitle(t('account_deletion.page_title'));

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <PageMeta
        title={t('account_deletion.page_title')}
        description={t('account_deletion.meta_description')}
      />

      <div className="text-center">
        <div className="mb-4 inline-flex rounded-2xl bg-red-500/15 p-4">
          <Trash2 className="h-10 w-10 text-[var(--color-error)]" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold text-theme-primary sm:text-4xl">
          {t('account_deletion.heading')}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-theme-muted">
          {t('account_deletion.subtitle')}
        </p>
      </div>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
          <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
          {t('account_deletion.operator_title')}
        </h2>
        <p className="mt-3 text-theme-muted">{t('account_deletion.operator_body')}</p>
        <p className="mt-2 text-sm text-theme-subtle">{t('account_deletion.package_id')}</p>
      </GlassCard>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
          <Smartphone className="h-5 w-5 text-accent" aria-hidden="true" />
          {t('account_deletion.in_app_title')}
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-theme-muted">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index}>{t(`account_deletion.in_app_steps.${index}`)}</li>
          ))}
        </ol>
      </GlassCard>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
          <Mail className="h-5 w-5 text-accent" aria-hidden="true" />
          {t('account_deletion.web_request_title')}
        </h2>
        <p className="mt-3 text-theme-muted">{t('account_deletion.web_request_body')}</p>
        <p className="mt-2 text-sm text-theme-subtle">{t('account_deletion.web_request_timing')}</p>
        <Button
          as={Link}
          to={tenantPath('/contact?topic=account-deletion')}
          className="mt-5 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
        >
          {t('account_deletion.web_request_button')}
        </Button>
      </GlassCard>

      <div className="grid gap-6 md:grid-cols-2">
        <GlassCard className="p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
            <Trash2 className="h-5 w-5 text-[var(--color-error)]" aria-hidden="true" />
            {t('account_deletion.deleted_title')}
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-theme-muted">
            {Array.from({ length: DELETED_ITEM_COUNT }, (_, index) => (
              <li key={index}>{t(`account_deletion.deleted_items.${index}`)}</li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
            <Database className="h-5 w-5 text-[var(--color-warning)]" aria-hidden="true" />
            {t('account_deletion.retained_title')}
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-theme-muted">
            {Array.from({ length: RETAINED_ITEM_COUNT }, (_, index) => (
              <li key={index}>{t(`account_deletion.retained_items.${index}`)}</li>
            ))}
          </ul>
        </GlassCard>
      </div>

      <GlassCard className="p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-theme-primary">
          {t('account_deletion.contact_title')}
        </h2>
        <p className="mt-3 text-theme-muted">{t('account_deletion.contact_body')}</p>
        <a className="mt-3 inline-block font-medium text-accent hover:underline" href="mailto:jasper@timebank.global">
          {t('account_deletion.contact_email')}
        </a>
      </GlassCard>
    </div>
  );
}

export default AccountDeletionPage;
