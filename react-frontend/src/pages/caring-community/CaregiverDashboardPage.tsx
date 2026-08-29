// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AlertTriangle from 'lucide-react/icons/alert-triangle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import Heart from 'lucide-react/icons/heart';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Plus from 'lucide-react/icons/plus';
import UserRoundCheck from 'lucide-react/icons/user-round-check';
import { useTranslation } from 'react-i18next';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaregiverLink {
  id: number;
  cared_for_id: number;
  relationship_type: 'family' | 'friend' | 'neighbour' | 'professional';
  is_primary: boolean;
  start_date: string;
  notes: string | null;
  cared_for_name: string;
  cared_for_avatar_url: string | null;
  status: 'pending' | 'active' | 'rejected' | 'inactive';
  recipient_confirmed_at: string | null;
  rejection_reason: string | null;
}

interface IncomingCaregiverLink {
  id: number;
  caregiver_id: number;
  caregiver_name: string;
  caregiver_avatar_url: string | null;
  relationship_type: CaregiverLink['relationship_type'];
  status: CaregiverLink['status'];
  recipient_confirmed_at: string | null;
}

interface BurnoutCheck {
  weekly_hours: number;
  threshold: number;
  at_risk: boolean;
  risk_level: 'none' | 'moderate' | 'high';
}

interface SupportRelationshipEntry {
  id: number;
  title: string;
  frequency: string;
  expected_hours: number;
  next_check_in_at: string | null;
  supporter_name: string;
  supporter_avatar_url: string | null;
}

interface RecentLogEntry {
  id: number;
  date: string;
  hours: number;
  status: string;
  supporter_name: string;
}

interface ScheduleData {
  support_relationships: SupportRelationshipEntry[];
  recent_logs: RecentLogEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BurnoutBanner({ burnout, t }: { burnout: BurnoutCheck; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (!burnout.at_risk) return null;

  const isHigh = burnout.risk_level === 'high';

  return (
    <GlassCard
      className={`p-5 border-2 ${isHigh ? 'border-danger/60 bg-danger/5' : 'border-warning/60 bg-warning/5'}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isHigh ? 'bg-danger/15' : 'bg-warning/15'}`}
        >
          <AlertTriangle
            className={`h-5 w-5 ${isHigh ? 'text-danger' : 'text-warning'}`}
            aria-hidden="true"
          />
        </div>
        <div>
          <p className={`font-semibold ${isHigh ? 'text-danger' : 'text-warning'}`}>
            {isHigh
              ? t('caregiver.burnout_high', { hours: burnout.weekly_hours.toFixed(1) })
              : t('caregiver.burnout_moderate', { hours: burnout.weekly_hours.toFixed(1) })}
          </p>
          <p className="mt-1 text-sm text-theme-muted">
            {t('caregiver.burnout_warning')}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}

function LinkCardSkeleton() {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3 rounded-lg" />
          <Skeleton className="h-3 w-1/4 rounded-lg" />
        </div>
      </div>
    </GlassCard>
  );
}

interface SchedulePanelProps {
  caredForId: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function SchedulePanel({ caredForId, t }: SchedulePanelProps) {
  const { data: schedule, isLoading } = useApi<ScheduleData>(
    `/v2/caring-community/caregiver/schedule/${caredForId}`,
    { immediate: true },
  );

  if (isLoading) {
    return (
      <div className="space-y-2 py-3">
        <Skeleton className="h-4 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-1/2 rounded-lg" />
      </div>
    );
  }

  if (!schedule) return null;

  return (
    <div className="space-y-4 py-2">
      {/* Upcoming support relationships */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-theme-muted">
          {t('caregiver.upcoming_care')}
        </p>
        {schedule.support_relationships.length === 0 ? (
          <p className="text-sm text-theme-muted">{t('caregiver.no_upcoming_care')}</p>
        ) : (
          <ul className="space-y-2">
            {schedule.support_relationships.map((sr) => (
              <li key={sr.id} className="flex items-center gap-3 rounded-lg border border-theme-default bg-theme-elevated p-3">
                <Avatar
                  src={sr.supporter_avatar_url ?? undefined}
                  name={sr.supporter_name}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-theme-primary">{sr.supporter_name}</p>
                  <p className="text-xs text-theme-muted">{sr.title}</p>
                </div>
                {sr.next_check_in_at && (
                  <span className="flex items-center gap-1 text-xs text-theme-muted">
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatDate(sr.next_check_in_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent care logs */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-theme-muted">
          {t('caregiver.recent_care')}
        </p>
        {schedule.recent_logs.length === 0 ? (
          <p className="text-sm text-theme-muted">{t('caregiver.no_recent_care')}</p>
        ) : (
          <ul className="space-y-1.5">
            {schedule.recent_logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-theme-muted">{formatDate(log.date)}</span>
                <span className="font-medium text-theme-primary">
                  {t('caregiver.hours_short', { hours: log.hours })}
                </span>
                <span className="text-theme-muted">{log.supporter_name}</span>
                <Chip
                  size="sm"
                  color={
                    log.status === 'approved' ? 'success' : log.status === 'pending' ? 'warning' : 'default'
                  }
                  variant="flat"
                >
                  {log.status}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface LinkCardProps {
  link: CaregiverLink;
  t: (key: string, opts?: Record<string, unknown>) => string;
  tenantPath: (path: string) => string;
}

function LinkCard({ link, t, tenantPath }: LinkCardProps) {
  const isActive = link.status === 'active';
  const statusKey = link.status === 'pending'
    ? (link.recipient_confirmed_at ? 'pending_staff' : 'pending_recipient')
    : link.status;

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar
            src={link.cared_for_avatar_url ?? undefined}
            name={link.cared_for_name}
            size="md"
            className="shrink-0"
          />
          <div>
            <p className="font-semibold text-theme-primary">{link.cared_for_name}</p>
            <Chip size="sm" variant="flat" color="secondary" className="mt-1">
              {t(`caregiver.relationship_${link.relationship_type}`)}
            </Chip>
            <Chip
              size="sm"
              variant="flat"
              color={isActive ? 'success' : link.status === 'rejected' ? 'danger' : 'warning'}
              className="ml-2 mt-1"
            >
              {t(`caregiver.status_${statusKey}`)}
            </Chip>
            {link.status === 'rejected' && link.rejection_reason && (
              <p className="mt-2 text-sm text-danger">{link.rejection_reason}</p>
            )}
          </div>
        </div>
        {isActive && <div className="flex flex-wrap gap-2">
          <Accordion className="w-full sm:w-auto" variant="light">
            <AccordionItem
              key="schedule" id="schedule"
              aria-label={t('caregiver.view_schedule')}
              title={
                <span className="text-sm font-medium text-[var(--color-primary)]">
                  {t('caregiver.view_schedule')}
                </span>
              }
            >
              <SchedulePanel caredForId={link.cared_for_id} t={t} />
            </AccordionItem>
          </Accordion>
          <Button
            as={Link}
            to={`${tenantPath('/caring-community/request-help')}?on_behalf_of=${link.cared_for_id}`}
            size="sm"
            variant="bordered"
            className="w-full justify-start sm:w-auto"
            startContent={<HeartHandshake className="h-4 w-4" aria-hidden="true" />}
          >
            {t('caregiver.request_on_behalf')}
          </Button>
          <Button
            as={Link}
            to={tenantPath('/caring-community/caregiver/cover')}
            size="sm"
            variant="bordered"
            className="w-full justify-start sm:w-auto"
            startContent={<UserRoundCheck className="h-4 w-4" aria-hidden="true" />}
          >
            {t('cover.title')}
          </Button>
        </div>}
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CaregiverDashboardPage() {
  const { t } = useTranslation('caring_community');
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  const [decidingIncomingId, setDecidingIncomingId] = useState<number | null>(null);

  usePageTitle(t('caregiver.dashboard_title'));

  const { data: links, isLoading: linksLoading, error: linksError } = useApi<CaregiverLink[]>(
    '/v2/caring-community/caregiver/links',
    { immediate: true },
  );

  const {
    data: incomingLinks,
    isLoading: incomingLoading,
    refetch: refetchIncoming,
  } = useApi<IncomingCaregiverLink[]>('/v2/caring-community/caregiver/incoming-links', { immediate: true });

  const { data: burnout, isLoading: burnoutLoading } = useApi<BurnoutCheck>(
    '/v2/caring-community/caregiver/burnout-check',
    { immediate: true },
  );

  // Redirect if feature is disabled
  useEffect(() => {
    if (!hasFeature('caring_community')) {
      void navigate(tenantPath('/'), { replace: true });
    }
  }, [hasFeature, navigate, tenantPath]);

  const isLoading = linksLoading || burnoutLoading;

  const decideIncoming = async (linkId: number, action: 'confirm' | 'reject') => {
    setDecidingIncomingId(linkId);
    try {
      const body = action === 'reject' ? { reason: t('caregiver.recipient_rejection_reason') } : undefined;
      await api.post(`/v2/caring-community/caregiver/incoming-links/${linkId}/${action}`, body);
      await refetchIncoming();
    } finally {
      setDecidingIncomingId(null);
    }
  };

  return (
    <>
      <PageMeta
        title={t('caregiver.dashboard_title')}
        description={t('caregiver.dashboard_subtitle')}
        noIndex
      />

      <div className="space-y-6">
        {/* Back link */}
        <Link
          to={tenantPath('/caring-community')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('caregiver.dashboard_title')}
        </Link>

        {/* Page header */}
        <GlassCard className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/15">
                <Heart className="h-6 w-6 text-rose-500" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                  {t('caregiver.dashboard_title')}
                </h1>
                <p className="mt-2 text-base leading-7 text-theme-muted">
                  {t('caregiver.dashboard_subtitle')}
                </p>
              </div>
            </div>
            <Button
              as={Link}
              to={tenantPath('/caring-community/caregiver/link')}
              color="primary"
              variant="flat"
              startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              {t('caregiver.link_care_receiver')}
            </Button>
          </div>
        </GlassCard>

        {/* Burnout warning banner */}
        {!burnoutLoading && burnout && burnout.at_risk && (
          <BurnoutBanner burnout={burnout} t={t} />
        )}

        {/* My care receivers */}
        {!incomingLoading && incomingLinks?.some((link) => link.status === 'pending' && !link.recipient_confirmed_at) && (
          <section aria-labelledby="incoming-caregiver-links" className="space-y-4">
            <h2 id="incoming-caregiver-links" className="text-lg font-semibold text-theme-primary">
              {t('caregiver.incoming_requests')}
            </h2>
            {incomingLinks
              .filter((link) => link.status === 'pending' && !link.recipient_confirmed_at)
              .map((link) => (
                <GlassCard key={link.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Avatar src={link.caregiver_avatar_url ?? undefined} name={link.caregiver_name} size="md" />
                      <div>
                        <p className="font-semibold text-theme-primary">{link.caregiver_name}</p>
                        <p className="text-sm text-theme-muted">{t('caregiver.incoming_explanation')}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        color="primary"
                        isLoading={decidingIncomingId === link.id}
                        onPress={() => void decideIncoming(link.id, 'confirm')}
                      >
                        {t('caregiver.confirm_relationship')}
                      </Button>
                      <Button
                        color="danger"
                        variant="bordered"
                        isDisabled={decidingIncomingId === link.id}
                        onPress={() => void decideIncoming(link.id, 'reject')}
                      >
                        {t('caregiver.reject_relationship')}
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              ))}
          </section>
        )}

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-theme-primary">
            {t('caregiver.my_care_receivers')}
          </h2>

          {/* Loading state */}
          {isLoading && (
            <div role="status" aria-busy="true" aria-label={t('loading')} className="space-y-3">
              <LinkCardSkeleton />
              <LinkCardSkeleton />
            </div>
          )}

          {/* Error state */}
          {linksError && !linksLoading && (
            <GlassCard role="alert" className="p-6 text-center text-danger">
              <p className="font-medium">{t('caregiver.no_care_receivers')}</p>
            </GlassCard>
          )}

          {/* Empty state */}
          {!isLoading && !linksError && links !== null && links.length === 0 && (
            <GlassCard className="p-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
                <Heart className="h-7 w-7 text-rose-500" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold text-theme-primary">
                {t('caregiver.no_care_receivers')}
              </h2>
              <p className="mt-3">
                <Button
                  as={Link}
                  to={tenantPath('/caring-community/caregiver/link')}
                  color="primary"
                  variant="flat"
                  startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('caregiver.link_care_receiver')}
                </Button>
              </p>
            </GlassCard>
          )}

          {/* Link cards */}
          {!isLoading && !linksError && links && links.length > 0 && (
            <div className="space-y-4">
              {links.map((link) => (
                <LinkCard key={link.id} link={link} t={t} tenantPath={tenantPath} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default CaregiverDashboardPage;
