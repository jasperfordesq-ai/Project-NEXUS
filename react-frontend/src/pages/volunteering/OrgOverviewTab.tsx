// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Users from 'lucide-react/icons/users';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Clock from 'lucide-react/icons/clock';
import Wallet from 'lucide-react/icons/wallet';
import Briefcase from 'lucide-react/icons/briefcase';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useTranslation } from 'react-i18next';

interface OrgStats {
  total_volunteers: number;
  pending_applications: number;
  pending_hours: number;
  total_approved_hours: number;
  active_opportunities: number;
  wallet_balance: number;
  auto_pay_enabled: boolean;
  org_name: string;
}

interface OrgOverviewTabProps {
  orgId: number;
  onTabChange: (tab: string) => void;
}

export default function OrgOverviewTab({ orgId, onTabChange }: OrgOverviewTabProps) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadStats = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(false);
    api.get<OrgStats>(`/v2/volunteering/organisations/${orgId}/stats`)
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.data) setStats(res.data);
        // A failed request must not look identical to "no stats yet" — surface
        // a retryable error instead.
        else setError(true);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        logError('Failed to load org stats', err);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
  }, [orgId]);

  useEffect(() => {
    loadStats();
    return () => { abortRef.current?.abort(); };
  }, [loadStats]);

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard className="p-8 text-center" role="alert">
        <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
        <p className="text-theme-muted mb-4">{t('org_dashboard.load_error')}</p>
        <Button
          className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
          onPress={loadStats}
        >
          {t('try_again')}
        </Button>
      </GlassCard>
    );
  }

  if (!stats) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-theme-muted">{t('org_dashboard.stats_unavailable')}</p>
      </GlassCard>
    );
  }

  const statCards = [
    {
      label: t('org_dashboard.total_volunteers'),
      value: stats.total_volunteers,
      icon: Users,
      color: 'from-blue-500 to-cyan-500',
      tab: 'volunteers',
    },
    {
      label: t('org_dashboard.pending_applications'),
      value: stats.pending_applications,
      icon: ClipboardList,
      color: 'from-amber-500 to-orange-500',
      tab: 'applications',
      badge: stats.pending_applications > 0,
    },
    {
      label: t('org_dashboard.pending_hours'),
      value: stats.pending_hours,
      icon: Clock,
      color: 'from-violet-500 to-accent-gradient-end',
      tab: 'hours-review',
      badge: stats.pending_hours > 0,
    },
    {
      label: t('org_dashboard.wallet_balance'),
      value: t('hours_abbrev', { hours: stats.wallet_balance }),
      icon: Wallet,
      color: 'from-emerald-500 to-teal-500',
      tab: 'wallet',
    },
    {
      label: t('org_dashboard.total_approved_hours'),
      value: stats.total_approved_hours,
      icon: Clock,
      color: 'from-rose-500 to-pink-500',
    },
    {
      label: t('org_dashboard.active_opportunities'),
      value: stats.active_opportunities,
      icon: Briefcase,
      color: 'from-accent to-blue-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Plain-language intro so an org owner immediately understands what this
          dashboard is for. */}
      <GlassCard className="p-4 border border-rose-500/20">
        <p className="text-sm text-theme-muted">{t('org_dashboard.overview_intro')}</p>
      </GlassCard>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <GlassCard
              key={card.label}
              hoverable
              className="p-4 cursor-pointer"
              onClick={() => card.tab && onTabChange(card.tab)}
            >
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center`}>
                  <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                </div>
                {card.badge && (
                  <Chip size="sm" color="warning" variant="soft">
                    {t('org_dashboard.needs_review')}
                  </Chip>
                )}
              </div>
              <p className="mt-3 text-2xl font-bold text-theme-primary">{card.value}</p>
              <p className="text-sm text-theme-muted">{card.label}</p>
            </GlassCard>
          );
        })}
      </div>

      {/* Quick Actions */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-4">
          {t('org_dashboard.quick_actions')}
        </h3>
        <div className="flex flex-wrap gap-3">
          {stats.pending_applications > 0 && (
            <Button
              variant="secondary"
              className="bg-warning-soft text-warning hover:bg-warning-soft/80"
              startContent={<ClipboardList className="w-4 h-4" />}
              endContent={<ArrowRight className="w-4 h-4" />}
              onPress={() => onTabChange('applications')}
            >
              {t('org_dashboard.review_applications', { count: stats.pending_applications })}
            </Button>
          )}
          {stats.pending_hours > 0 && (
            <Button
              variant="secondary"
              startContent={<Clock className="w-4 h-4" />}
              endContent={<ArrowRight className="w-4 h-4" />}
              onPress={() => onTabChange('hours-review')}
            >
              {t('org_dashboard.review_hours', { count: stats.pending_hours })}
            </Button>
          )}
          <Button
            variant="primary"
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<Briefcase className="w-4 h-4" />}
            onPress={() => navigate(tenantPath('/volunteering/create'))}
          >
            {t('org_dashboard.post_opportunity')}
          </Button>
          <Button
            variant="tertiary"
            startContent={<Wallet className="w-4 h-4" />}
            onPress={() => onTabChange('wallet')}
          >
            {t('org_dashboard.tab_wallet')}
          </Button>
        </div>
      </GlassCard>

      {/* How volunteers get paid — a fixed reassurance, not a toggle. Approving
          a volunteer's hours always credits them automatically. */}
      <GlassCard className="p-4 border border-emerald-500/30">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-primary">
              {t('org_dashboard.autocredit_title')}
            </p>
            <p className="text-xs text-theme-muted">
              {t('org_dashboard.autocredit_desc')}
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
