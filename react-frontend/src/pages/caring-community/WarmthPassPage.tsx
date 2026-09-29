import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AlertCircle from 'lucide-react/icons/alert-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/check-circle';
import Clock from 'lucide-react/icons/clock';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Star from 'lucide-react/icons/star';
import XCircle from 'lucide-react/icons/x-circle';
import { useTranslation } from 'react-i18next';
import { TrustTierBadge } from '@/components/caring-community/TrustTierBadge';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WarmthPass {
  eligible: boolean;
  tier: number; // 0-4
  tier_label: string; // newcomer/member/trusted/verified/coordinator
  hours_logged: number;
  reviews_received: number;
  identity_verified: boolean;
  member_since: string | null; // ISO date
  pass_active_since: string | null; // ISO date, only when tier >= 2
  tenant_name: string;
  member_name: string;
  categories: string[]; // list of help category names they've contributed in
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// The API caps the tier shown on a pass at Trusted unless the member holds an
// active id_verified badge (E-061 F-228), so "Verified" only appears for a
// member whose identity really was checked.
const TIER_LABEL_KEYS: Record<number, string> = {
  0: 'trust_tier.tier_newcomer',
  1: 'trust_tier.tier_member',
  2: 'trust_tier.tier_trusted',
  3: 'trust_tier.tier_verified',
  4: 'trust_tier.tier_coordinator',
};

type TierChipColor = 'default' | 'primary' | 'warning' | 'success';

function tierChipColor(tier: number): TierChipColor {
  if (tier >= 4) return 'warning';
  if (tier === 3) return 'success';
  if (tier === 2) return 'warning';
  if (tier === 1) return 'primary';
  return 'default';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function WarmthPassPage() {
  const { t } = useTranslation('caring_community');
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  usePageTitle(t('warmth_pass.title'));

  const { data, isLoading, error } = useApi<WarmthPass>(
    '/v2/caring-community/my-warmth-pass',
    { immediate: true },
  );

  // Redirect if feature is disabled
  useEffect(() => {
    if (!hasFeature('caring_community')) {
      void navigate(tenantPath('/'), { replace: true });
    }
  }, [hasFeature, navigate, tenantPath]);

  return (
    <>
      <PageMeta
        title={t('warmth_pass.title')}
        description={t('warmth_pass.what_it_shows_body')}
        noIndex
      />

      <div className="space-y-6">
        {/* Back link */}
        <Link
          to={tenantPath('/caring-community')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('warmth_pass.title')}
        </Link>

        {/* Page header */}
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning/15">
              <HeartHandshake className="h-6 w-6 text-warning-600" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                {t('warmth_pass.title')}
              </h1>
              <p className="mt-2 text-base leading-relaxed text-theme-muted">
                {t('warmth_pass.what_it_shows_body')}
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Loading skeleton */}
        {isLoading && (
          <GlassCard role="status" aria-busy="true" aria-label={t('loading')} className="space-y-4 p-6">
            <Skeleton className="h-6 w-1/3 rounded-lg" />
            <Skeleton className="h-4 w-2/3 rounded-lg" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </GlassCard>
        )}

        {/* Error state */}
        {error && !isLoading && (
          <GlassCard role="alert" className="p-6">
            <div className="flex items-center gap-3 text-danger">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-medium">{t('warmth_pass.error')}</p>
            </div>
          </GlassCard>
        )}

        {/* Not eligible state */}
        {!isLoading && !error && data && !data.eligible && (
          <GlassCard className="p-6 sm:p-8">
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-tertiary">
                <HeartHandshake className="h-8 w-8 text-muted" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xl font-semibold text-theme-primary">
                  {t('warmth_pass.not_eligible')}
                </p>
                <p className="mt-2 text-sm text-theme-muted">
                  {t('warmth_pass.not_eligible_hint')}
                </p>
              </div>
              <div className="mt-2">
                <TrustTierBadge
                  tier={data.tier as 0 | 1 | 2 | 3 | 4}
                  size="md"
                  showLabel
                />
              </div>
            </div>
          </GlassCard>
        )}

        {/* Warmth Pass card */}
        {!isLoading && !error && data && data.eligible && (
          <>
            {/* The credential card */}
            <div
              className="rounded-2xl bg-gradient-to-br from-warning-100 to-accent-soft p-1 shadow-lg dark:from-warning-900/40 dark:to-accent-soft"
            >
              <div className="rounded-xl bg-white/80 p-6 backdrop-blur-sm dark:bg-black/30 sm:p-8">
                {/* Card header row: tenant name + pass label */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-theme-muted">
                      {data.tenant_name}
                    </p>
                    <p className="mt-0.5 text-sm font-bold uppercase tracking-wider text-warning-700 dark:text-warning-400">
                      {t('warmth_pass.credential_label')}
                    </p>
                  </div>
                  <HeartHandshake className="h-8 w-8 text-warning-500" aria-hidden="true" />
                </div>

                {/* Member name */}
                <div className="mt-6">
                  <p className="text-xs font-medium uppercase tracking-wide text-theme-muted">
                    {t('warmth_pass.member_name')}
                  </p>
                  <p className="mt-1 text-3xl font-bold tracking-tight text-theme-primary">
                    {data.member_name}
                  </p>
                </div>

                {/* Trust tier badge */}
                <div className="mt-4">
                  <Chip
                    size="md"
                    color={tierChipColor(data.tier)}
                    variant="flat"
                    className="font-semibold"
                    data-tier={data.tier}
                  >
                    {t(TIER_LABEL_KEYS[data.tier] ?? 'trust_tier.tier_trusted')}
                  </Chip>
                </div>

                {/* Stats row */}
                <div className="mt-6 grid grid-cols-3 gap-4">
                  <div className="flex flex-col items-center gap-1 rounded-lg bg-white/60 p-3 dark:bg-white/10">
                    <Clock className="h-5 w-5 text-accent" aria-hidden="true" />
                    <p className="text-xl font-bold text-theme-primary">{data.hours_logged}</p>
                    <p className="text-center text-xs text-theme-muted">
                      {t('warmth_pass.hours_logged')}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded-lg bg-white/60 p-3 dark:bg-white/10">
                    <Star className="h-5 w-5 text-warning" aria-hidden="true" />
                    <p className="text-xl font-bold text-theme-primary">{data.reviews_received}</p>
                    <p className="text-center text-xs text-theme-muted">
                      {t('warmth_pass.reviews_received')}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-1 rounded-lg bg-white/60 p-3 dark:bg-white/10">
                    {data.identity_verified ? (
                      <CheckCircle className="h-5 w-5 text-success" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-5 w-5 text-muted" aria-hidden="true" />
                    )}
                    <p className="text-xl font-bold text-theme-primary">
                      {data.identity_verified ? t('warmth_pass.yes') : t('warmth_pass.no')}
                    </p>
                    <p className="text-center text-xs text-theme-muted">
                      {t('warmth_pass.identity_verified')}
                    </p>
                  </div>
                </div>

                {/* Categories */}
                <div className="mt-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-theme-muted">
                    {t('warmth_pass.categories')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.categories.length > 0 ? (
                      data.categories.map((cat) => (
                        <Chip key={cat} size="sm" variant="flat" color="primary">
                          {cat}
                        </Chip>
                      ))
                    ) : (
                      <p className="text-sm text-theme-muted">{t('warmth_pass.no_categories')}</p>
                    )}
                  </div>
                </div>

                {/* Dates */}
                <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-theme-muted">
                      {t('warmth_pass.member_since')}
                    </p>
                    <p className="text-sm font-semibold text-theme-primary">
                      {formatDate(data.member_since)}
                    </p>
                  </div>
                  {data.pass_active_since && (
                    <div>
                      <p className="text-xs font-medium text-theme-muted">
                        {t('warmth_pass.active_since')}
                      </p>
                      <p className="text-sm font-semibold text-theme-primary">
                        {formatDate(data.pass_active_since)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Attribution */}
                <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
                  <p className="text-center text-xs text-theme-muted">
                    {t('warmth_pass.issued_by', { tenant: data.tenant_name })}
                  </p>
                </div>
              </div>
            </div>

            {/* Info note */}
            <Card>
              <CardBody className="gap-3 p-5">
                <div className="flex items-center gap-2">
                  <HeartHandshake className="h-5 w-5 text-accent" aria-hidden="true" />
                  <p className="font-semibold text-sm">{t('warmth_pass.what_is_this')}</p>
                </div>
                <p className="text-sm text-theme-muted leading-relaxed">
                  {t('warmth_pass.what_it_shows_body')}
                </p>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

export default WarmthPassPage;
