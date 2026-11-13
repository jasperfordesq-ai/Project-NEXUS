// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Overview
 *
 * The panel's landing page and its only native (non-embedded) page in
 * Phase A. Answers, in plain English, the three questions a super admin
 * actually has: are we connected, is anything waiting on me, and is
 * anything broken — plus a short setup checklist for tenants starting
 * from zero. Built entirely from existing endpoints (analytics overview,
 * settings, directory profile).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Globe from 'lucide-react/icons/globe';
import Handshake from 'lucide-react/icons/handshake';
import Hourglass from 'lucide-react/icons/hourglass';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CircleCheck from 'lucide-react/icons/circle-check';
import Circle from 'lucide-react/icons/circle';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Network from 'lucide-react/icons/network';
import Power from 'lucide-react/icons/power';
import { useAuth, useTenant } from '@/contexts';
import { isSuperAdminUser } from '@/lib/access';
import { usePageTitle } from '@/hooks/usePageTitle';
import { adminFederation } from '@/admin/api/adminApi';
import type { FederationSystemControls } from '@/admin/api/types';
import { Card, CardBody, Chip } from '@/components/ui';
import { PartnersPageShell, BrokerStatCard, BrokerEmptyState, BrokerSparkline } from '../components';

interface OverviewKpis {
  total_partnerships: number;
  active_partnerships: number;
  pending_partnerships: number;
  external_partners: number;
  federated_transactions: number;
  federated_messages: number;
  federated_listings: number;
  inbound_reviews: number;
}

interface OverviewData {
  kpis: OverviewKpis;
  daily_calls: Array<{ date: string; count: number }>;
  top_partners: Array<{ tenant_id: number; name: string; activity: number }>;
  recent_errors: Array<{ id: number; endpoint: string; created_at: string }>;
}

/** Defensive unwrap — some endpoints double-wrap their payload in {data}. */
function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export default function PartnersOverviewPage() {
  const { t } = useTranslation('partners');
  const { tenantPath, hasFeature } = useTenant();
  const { user } = useAuth();
  usePageTitle(t('overview.page_title'));

  // Setup surfaces (checklist, settings CTA, caring/inbound shortcuts) are
  // super-admin-only — ordinary admins get status + activity only.
  const isSuper = isSuperAdminUser(user);
  const showFederation = hasFeature('federation');
  const showCaring = hasFeature('caring_community') && isSuper;
  const showInboundApi = hasFeature('partner_api') && isSuper;

  const [loading, setLoading] = useState(showFederation);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [settings, setSettings] = useState<FederationSystemControls | null>(null);
  const [profilePublished, setProfilePublished] = useState<boolean | null>(null);

  useEffect(() => {
    if (!showFederation) return;
    let cancelled = false;

    (async () => {
      const [overviewRes, settingsRes, profileRes] = await Promise.allSettled([
        adminFederation.getAnalyticsOverview('30d'),
        adminFederation.getSettings(),
        adminFederation.getProfile(),
      ]);

      if (cancelled) return;

      if (overviewRes.status === 'fulfilled' && overviewRes.value.success && overviewRes.value.data) {
        setOverview(unwrap<OverviewData>(overviewRes.value.data));
      }
      if (settingsRes.status === 'fulfilled' && settingsRes.value.success && settingsRes.value.data) {
        setSettings(unwrap<FederationSystemControls>(settingsRes.value.data));
      }
      if (profileRes.status === 'fulfilled' && profileRes.value.success && profileRes.value.data) {
        // The listing's text lives under federation_profile (see
        // AdminFederationController::profile()). Until November 2026 this read
        // a top-level `description` the endpoint never sent, so the "publish
        // your listing" step could never tick however complete the listing was.
        const profile = unwrap<{ federation_profile?: { description?: string | null } | null }>(profileRes.value.data);
        setProfilePublished(Boolean(profile?.federation_profile?.description?.trim()));
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [showFederation]);

  const kpis = overview?.kpis;
  const partneringOn = settings?.federation_enabled === true;
  const hasErrors = (overview?.recent_errors?.length ?? 0) > 0;

  const checklist = [
    {
      key: 'enable',
      done: partneringOn,
      label: t('overview.checklist.enable'),
      to: '/partner-timebanks/settings',
    },
    {
      key: 'profile',
      done: profilePublished === true,
      label: t('overview.checklist.profile'),
      to: '/partner-timebanks/directory?tab=profile',
    },
    {
      key: 'connect',
      done: (kpis?.total_partnerships ?? 0) > 0,
      label: t('overview.checklist.connect'),
      to: '/partner-timebanks/partnerships',
    },
    {
      key: 'credit',
      done: null as boolean | null, // optional step — no cheap signal; link only
      label: t('overview.checklist.credit'),
      to: '/partner-timebanks/credit-agreements',
    },
  ];

  return (
    <PartnersPageShell
      title={t('overview.title')}
      description={t('overview.description')}
      icon={Globe}
      color="accent"
    >
      <div className="flex flex-col gap-4">
        {/* Partnering switched off — the single most important thing to say */}
        {showFederation && !loading && settings && !partneringOn && (
          <Card className="rounded-2xl border border-warning/40 bg-warning/5">
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                <Power size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{t('overview.disabled_banner.title')}</p>
                <p className="text-sm text-muted">{t('overview.disabled_banner.hint')}</p>
              </div>
              {isSuper && (
                <Link
                  to={tenantPath('/partner-timebanks/settings')}
                  className="shrink-0 text-sm font-medium text-warning hover:underline"
                >
                  {t('overview.disabled_banner.cta')}
                </Link>
              )}
            </CardBody>
          </Card>
        )}

        {/* Recent connection problems */}
        {showFederation && hasErrors && (
          <Card className="rounded-2xl border border-danger/40 bg-danger/5">
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger">
                <AlertTriangle size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{t('overview.errors_banner.title')}</p>
                <p className="text-sm text-muted">
                  {t('overview.errors_banner.hint', { count: overview?.recent_errors?.length ?? 0 })}
                </p>
              </div>
              <Link
                to={tenantPath('/partner-timebanks/activity')}
                className="shrink-0 text-sm font-medium text-danger hover:underline"
              >
                {t('overview.errors_banner.cta')}
              </Link>
            </CardBody>
          </Card>
        )}

        {/* KPI row */}
        {showFederation && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <BrokerStatCard
              label={t('overview.stats.active_partners')}
              value={kpis?.active_partnerships}
              icon={Handshake}
              color="accent"
              loading={loading}
              to={tenantPath('/partner-timebanks/partnerships')}
              description={t('overview.stats.active_partners_hint')}
            />
            <BrokerStatCard
              label={t('overview.stats.pending_requests')}
              value={kpis?.pending_partnerships}
              icon={Hourglass}
              color={((kpis?.pending_partnerships ?? 0) > 0 ? 'warning' : 'neutral')}
              loading={loading}
              to={tenantPath('/partner-timebanks/partnerships')}
              description={t('overview.stats.pending_requests_hint')}
            />
            <BrokerStatCard
              label={t('overview.stats.external_platforms')}
              value={kpis?.external_partners}
              icon={Globe}
              color="accent"
              loading={loading}
              to={isSuper ? tenantPath('/partner-timebanks/external-partners') : undefined}
              description={t('overview.stats.external_platforms_hint')}
            />
            <BrokerStatCard
              label={t('overview.stats.exchanges_30d')}
              value={kpis?.federated_transactions}
              icon={ArrowLeftRight}
              color="accent"
              loading={loading}
              to={tenantPath('/partner-timebanks/activity')}
              description={t('overview.stats.exchanges_30d_hint')}
              trend={overview?.daily_calls?.map((d) => d.count)}
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Setup checklist — setup is a super-admin job */}
          {showFederation && isSuper && (
            <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
              <CardBody className="p-5">
                <h2 className="text-base font-semibold text-foreground">{t('overview.checklist.title')}</h2>
                <p className="mt-1 text-sm text-muted">{t('overview.checklist.hint')}</p>
                <ul className="mt-4 flex flex-col gap-2">
                  {checklist.map((step) => (
                    <li key={step.key}>
                      <Link
                        to={tenantPath(step.to)}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-secondary"
                      >
                        {step.done === true ? (
                          <CircleCheck size={20} className="shrink-0 text-success" />
                        ) : (
                          <Circle size={20} className="shrink-0 text-muted/50" />
                        )}
                        <span className={`flex-1 text-sm ${step.done === true ? 'text-muted line-through' : 'text-foreground'}`}>
                          {step.label}
                        </span>
                        {step.done === null && (
                          <Chip size="sm" variant="tertiary" className="text-xs text-muted">
                            {t('overview.checklist.optional')}
                          </Chip>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Most active partners */}
          {showFederation && (
            <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
              <CardBody className="p-5">
                <h2 className="text-base font-semibold text-foreground">{t('overview.top_partners.title')}</h2>
                <p className="mt-1 text-sm text-muted">{t('overview.top_partners.hint')}</p>
                {!loading && (overview?.top_partners?.length ?? 0) === 0 ? (
                  <BrokerEmptyState
                    bare
                    icon={Handshake}
                    color="neutral"
                    title={t('overview.top_partners.empty_title')}
                    hint={t('overview.top_partners.empty_hint')}
                  />
                ) : (
                  <ul className="mt-4 flex flex-col gap-1">
                    {(overview?.top_partners ?? []).slice(0, 5).map((partner) => (
                      <li
                        key={partner.tenant_id}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-soft-foreground">
                          <Handshake size={16} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {partner.name}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-muted">
                          {t('overview.top_partners.activity', { count: partner.activity })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {(overview?.daily_calls?.length ?? 0) > 1 && (
                  <div className="mt-4 text-accent">
                    <BrokerSparkline points={overview!.daily_calls.map((d) => d.count)} width={220} height={32} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* Areas available without the federation feature */}
        {!showFederation && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BrokerEmptyState
              icon={Globe}
              color="neutral"
              title={t('overview.federation_off.title')}
              hint={t('overview.federation_off.hint')}
            />
            <div className="flex flex-col gap-4">
              {showCaring && (
                <BrokerStatCard
                  label={t('nav.caring_peers')}
                  value={t('overview.open') as string}
                  icon={HeartHandshake}
                  color="success"
                  to={tenantPath('/partner-timebanks/caring/peers')}
                />
              )}
              {showInboundApi && (
                <BrokerStatCard
                  label={t('nav.inbound_api')}
                  value={t('overview.open') as string}
                  icon={Network}
                  color="warning"
                  to={tenantPath('/partner-timebanks/inbound-api')}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </PartnersPageShell>
  );
}
