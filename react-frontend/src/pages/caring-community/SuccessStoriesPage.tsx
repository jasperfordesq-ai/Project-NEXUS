// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import AlertCircle from 'lucide-react/icons/alert-circle';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Award from 'lucide-react/icons/award';
import Info from 'lucide-react/icons/info';
import Sparkles from 'lucide-react/icons/sparkles';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CardBody, Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MetricSource = 'pilot_scoreboard' | 'municipal_roi' | 'manual';

interface SuccessStory {
  id: string;
  copy_code?: string | null;
  title: string;
  narrative: string;
  metric_source: MetricSource;
  metric_key: string | null;
  before_value: number | null;
  after_value: number | null;
  unit: string;
  audience: string;
  sub_region_id: string | null;
  method_caveat: string;
  evidence_source: string;
  is_demo: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  items: SuccessStory[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(v: number | null, unit: string): string {
  if (v === null) return '—';
  const formatted = v.toLocaleString(getFormattingLocale());
  return unit ? `${formatted} ${unit}` : formatted;
}

function storyCopy(
  story: SuccessStory,
  field: 'title' | 'narrative' | 'method_caveat' | 'evidence_source',
  t: TFunction,
): string {
  if (!story.copy_code) return story[field];

  return t(`demo_stories.${story.copy_code}.${field}`, {
    defaultValue: story[field],
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SuccessStoriesPage() {
  const { t } = useTranslation('success_stories');
  const { t: tCommon } = useTranslation('common');
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  usePageTitle(t('page_title'));

  const { data, isLoading, error } = useApi<ListResponse>(
    '/v2/caring-community/success-stories',
    { immediate: true },
  );

  useEffect(() => {
    if (!hasFeature('caring_community')) {
      void navigate(tenantPath('/'), { replace: true });
    }
  }, [hasFeature, navigate, tenantPath]);

  const items = data?.items ?? [];

  return (
    <>
      <PageMeta title={t('page_title')} description={t('intro')} noIndex />

      <div className="space-y-6">
        {/* Header */}
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning/15">
              <Award className="h-6 w-6 text-warning-soft-foreground" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                {t('page_title')}
              </h1>
              <p className="mt-2 text-base leading-relaxed text-theme-muted">
                {t('intro')}
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Loading */}
        {isLoading && (
          <div role="status" aria-busy="true" aria-label={tCommon('loading')} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <GlassCard key={i} className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3 rounded-lg" />
                <Skeleton className="h-4 w-full rounded-lg" />
                <Skeleton className="h-4 w-5/6 rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </GlassCard>
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <GlassCard role="alert" className="p-6">
            <div className="flex items-center gap-3 text-danger">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-medium">{t('error_loading')}</p>
            </div>
          </GlassCard>
        )}

        {/* Empty */}
        {!isLoading && !error && items.length === 0 && (
          <GlassCard className="p-6 sm:p-8">
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-tertiary">
                <Sparkles className="h-8 w-8 text-muted" aria-hidden="true" />
              </div>
              <p className="max-w-md text-sm text-theme-muted">{t('empty_state')}</p>
            </div>
          </GlassCard>
        )}

        {/* Gallery */}
        {!isLoading && !error && items.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((story) => (
              <Card
                key={story.id}
                className="border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <CardBody className="space-y-4 p-5">
                  {/* Top: title + demo flag */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold leading-tight text-theme-primary">
                        {storyCopy(story, 'title', t)}
                      </h2>
                      {story.is_demo && (
                        <Chip size="sm" color="warning" variant="flat">
                          {t('demo_label')}
                        </Chip>
                      )}
                    </div>
                  </div>

                  {/* Metric delta */}
                  <div className="rounded-xl bg-[var(--color-surface-alt)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-theme-muted">
                          {t('before_label')}
                        </p>
                        <p className="mt-1 truncate text-xl font-bold text-theme-primary">
                          {formatValue(story.before_value, story.unit)}
                        </p>
                      </div>
                      <ArrowRight
                        className="h-5 w-5 shrink-0 text-muted"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1 text-right">
                        <p className="text-xs font-medium uppercase tracking-wide text-theme-muted">
                          {t('after_label')}
                        </p>
                        <p className="mt-1 truncate text-xl font-bold text-success-soft-foreground">
                          {formatValue(story.after_value, story.unit)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Narrative */}
                  <p className="text-sm leading-relaxed text-theme-muted">
                    {storyCopy(story, 'narrative', t)}
                  </p>

                  {/* Audience */}
                  {story.audience && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-theme-muted">
                        {t('audience_label')}
                      </span>
                      <Chip size="sm" variant="flat" color="primary">
                        {t(`audiences.${story.audience}`, { defaultValue: story.audience })}
                      </Chip>
                    </div>
                  )}

                  {/* Caveat + evidence */}
                  <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
                    {storyCopy(story, 'method_caveat', t) && (
                      <div className="flex items-start gap-2">
                        <Info
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
                          aria-hidden="true"
                        />
                        <p className="text-xs italic text-theme-muted">
                          <span className="font-medium not-italic">
                            {t('caveat_label')}:{' '}
                          </span>
                          {storyCopy(story, 'method_caveat', t)}
                        </p>
                      </div>
                    )}
                    {storyCopy(story, 'evidence_source', t) && (
                      <p className="text-[11px] text-muted">
                        <span className="font-medium">{t('evidence_label')}: </span>
                        {storyCopy(story, 'evidence_source', t)}
                      </p>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default SuccessStoriesPage;
