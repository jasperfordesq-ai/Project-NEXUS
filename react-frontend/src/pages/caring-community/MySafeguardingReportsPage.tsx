// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';import ArrowLeft from 'lucide-react/icons/arrow-left';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

type MyReport = {
  id: number;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description_preview: string;
  status: 'submitted' | 'triaged' | 'investigating' | 'resolved' | 'dismissed';
  review_due_at: string | null;
  escalated: boolean;
  resolved_at: string | null;
  created_at: string;
};

const SEVERITY_COLOR: Record<MyReport['severity'], 'danger' | 'warning' | 'default' | 'success'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'default',
  low: 'success',
};

const STATUS_COLOR: Record<MyReport['status'], 'default' | 'primary' | 'warning' | 'success' | 'danger'> = {
  submitted: 'primary',
  triaged: 'primary',
  investigating: 'warning',
  resolved: 'success',
  dismissed: 'default',
};

export default function MySafeguardingReportsPage(): ReactNode {
  const { t } = useTranslation('common');
  const { hasFeature, tenantPath } = useTenant();
  usePageTitle(t('safeguarding_reports.my_reports.meta.title'));

  const [reports, setReports] = useState<MyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<{ items: MyReport[] }>(
          '/v2/caring-community/safeguarding/my-reports',
        );
        if (!cancelled) {
          if (res.success && res.data) {
            setReports(res.data.items ?? []);
          } else {
            setError(t('safeguarding_reports.errors.load_failed'));
            setReports([]);
          }
        }
      } catch (err) {
        logError('MySafeguardingReportsPage: fetch failed', err);
        if (!cancelled) {
          setError(t('safeguarding_reports.errors.load_failed'));
          setReports([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (!hasFeature('caring_community')) {
    return <Navigate to={tenantPath('/caring-community')} replace />;
  }

  return (
    <>
      <PageMeta
        title={t('safeguarding_reports.my_reports.meta.title')}
        description={t('safeguarding_reports.my_reports.meta.description')}
        noIndex
      />
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <Button
            as={Link}
            to={tenantPath('/caring-community')}
            variant="light"
            size="sm"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            {t('safeguarding_reports.back')}
          </Button>
        </div>

        <GlassCard className="p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-rose-500/15">
              <ShieldAlert className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-theme-primary">
                {t('safeguarding_reports.my_reports.title')}
              </h1>
              <p className="mt-1 text-sm leading-6 text-theme-muted">
                {t('safeguarding_reports.my_reports.subtitle')}
              </p>
            </div>
          </div>

          {error && !loading && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger-soft-foreground"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : reports.length === 0 && !error ? (
            <div className="py-10 text-center text-sm text-theme-muted">
              {t('safeguarding_reports.my_reports.empty')}
            </div>
          ) : (
            <ul className="space-y-3">
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-border bg-surface/30 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Chip size="sm" color={SEVERITY_COLOR[r.severity]} variant="flat">
                          {t(`safeguarding_reports.submit.form.severities.${r.severity}`)}
                        </Chip>
                        <Chip size="sm" color={STATUS_COLOR[r.status]} variant="flat">
                          {t(`safeguarding_reports.my_reports.status.${r.status}`)}
                        </Chip>
                        {r.escalated && (
                          <Chip size="sm" color="danger" variant="bordered">
                            {t('safeguarding_reports.my_reports.escalated')}
                          </Chip>
                        )}
                      </div>
                      <p className="text-sm font-medium text-theme-primary">
                        {t(`safeguarding_reports.submit.form.categories.${r.category}`)}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-theme-muted">
                        {r.description_preview}
                      </p>
                      <p className="mt-2 text-xs text-theme-muted">
                        {t('safeguarding_reports.my_reports.submitted_at', {
                          date: new Date(r.created_at).toLocaleDateString(getFormattingLocale()),
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </>
  );
}
