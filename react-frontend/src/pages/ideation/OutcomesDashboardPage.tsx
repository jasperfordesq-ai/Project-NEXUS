// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Outcomes Dashboard Page (I10)
 *
 * Displays aggregate impact data for all completed challenges:
 * - Summary stats: total tracked, implemented, in progress
 * - List of closed/archived challenges with their outcomes
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';import ArrowLeft from 'lucide-react/icons/arrow-left';
import Target from 'lucide-react/icons/target';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import BarChart3 from 'lucide-react/icons/chart-column';
import Award from 'lucide-react/icons/award';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

interface OutcomeDashboard {
  total: number;
  implemented: number;
  in_progress: number;
  not_started: number;
  abandoned: number;
  outcomes: OutcomeEntry[];
}

interface OutcomeEntry {
  challenge_id: number;
  challenge_title: string;
  winning_idea_title: string | null;
  implementation_status: 'not_started' | 'in_progress' | 'implemented' | 'abandoned';
  impact_description: string | null;
  updated_at: string | null;
}

const IMPL_STATUS_COLORS: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  not_started: 'default',
  in_progress: 'warning',
  implemented: 'success',
  abandoned: 'danger',
};

/* ───────────────────────── Main Component ───────────────────────── */

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

export function OutcomesDashboardPage() {
  const { t } = useTranslation('ideation');
  usePageTitle(t('outcomes.page_title'));
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState<OutcomeDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const fetchDashboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<OutcomeDashboard>('/v2/ideation-outcomes/dashboard');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setDashboard(response.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch outcomes dashboard', err);
      setError(tRef.current('challenges.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);


  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <PageMeta title={t('page_meta.outcomes.title')} noIndex />
      {/* Back link */}
      <Button
        variant="light"
        startContent={<ArrowLeft className="w-4 h-4" />}
        className="mb-4 -ml-2"
        onPress={() => navigate(tenantPath('/ideation'))}
      >
        {t('title')}
      </Button>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-3">
          <BarChart3 className="w-7 h-7" />
          {t('outcomes.dashboard')}
        </h1>
      </div>

      {/* Loading */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="w-10 h-10 text-theme-subtle" />}
            title={t('challenges.load_error')}
            action={
              <Button
                color="primary"
                variant="flat"
                startContent={<RefreshCw className="w-4 h-4" />}
                onPress={fetchDashboard}
              >
                {t('actions.retry')}
              </Button>
            }
          />
        </div>
      )}

      {/* Dashboard */}
      {!isLoading && !error && dashboard && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <GlassCard className="p-4 text-center">
              <Target className="w-6 h-6 mx-auto mb-2 text-[var(--color-text-tertiary)]" />
              <p className="text-2xl font-bold text-[var(--color-text)]">{dashboard.total}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('outcomes.total_challenges')}</p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <CheckCircle className="w-6 h-6 mx-auto mb-2 text-[var(--color-success)]" />
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">{dashboard.implemented}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('outcomes.implemented_count')}</p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <Clock className="w-6 h-6 mx-auto mb-2 text-[var(--color-warning)]" />
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{dashboard.in_progress}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('outcomes.in_progress_count')}</p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <Target className="w-6 h-6 mx-auto mb-2 text-[var(--color-text-tertiary)]" />
              <p className="text-2xl font-bold text-[var(--color-text)]">{dashboard.not_started}</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">{t('outcomes.status_not_started')}</p>
            </GlassCard>
          </div>

          {/* Outcomes List */}
          {dashboard.outcomes.length === 0 ? (
            <EmptyState
              icon={<Target className="w-10 h-10 text-theme-subtle" />}
              title={t('outcomes.empty_title')}
            />
          ) : (
            <div className="space-y-3">
              {dashboard.outcomes.map((entry) => (
                <Link
                  key={entry.challenge_id}
                  to={tenantPath(`/ideation/${entry.challenge_id}`)}
                  className="block"
                >
                  <GlassCard className="p-4 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-[var(--color-text)] mb-1">
                          {entry.challenge_title}
                        </h3>
                        {entry.winning_idea_title && (
                          <p className="text-sm text-[var(--color-text-secondary)] flex items-center gap-1.5 mb-1">
                            <Award className="w-3.5 h-3.5 text-[var(--color-warning)] shrink-0" />
                            {entry.winning_idea_title}
                          </p>
                        )}
                        {entry.impact_description && (
                          <p className="text-sm text-[var(--color-text-tertiary)] line-clamp-2">
                            {entry.impact_description}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Chip
                          size="sm"
                          color={IMPL_STATUS_COLORS[entry.implementation_status] ?? 'default'}
                          variant="flat"
                        >
                          {t(`outcomes.status_${entry.implementation_status}`)}
                        </Chip>
                        {entry.updated_at && (
                          <span className="text-xs text-[var(--color-text-tertiary)]">
                            {formatDate(entry.updated_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default OutcomesDashboardPage;
