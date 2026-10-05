// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An organisation's safeguarding reports, for its owner, administrators and
 * safeguarding lead (and deputy).
 *
 *   /volunteering/org/:orgId/safeguarding      — reports linked to the organisation
 *   /volunteering/org/:orgId/safeguarding/:id  — one report, its history, and updates
 *
 * Also rendered as the "Safeguarding" tab of the organisation dashboard.
 *
 * The community's safeguarding team handles each report. The organisation sees a
 * summary; its lead sees the full report only while the team has shared it. The
 * page reads only the fields listed below and never shows who made a report, even
 * if a response carried it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale } from '@/lib/helpers';
import { memberStatusKey } from '@/lib/incidentStatus';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Textarea } from '@/components/ui/Textarea';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';

interface IncidentSummary {
  id: number;
  type: string;
  severity: string;
  status: string;
  incident_date: string | null;
  created_at: string;
  opportunity_title: string | null;
  full_report_shared?: boolean;
}

type OrgEventType = 'reported' | 'migrated' | 'status_changed' | 'org_update' | 'message_to_organisation'
  | 'reporter_addition' | 'shared_with_organisation' | 'share_withdrawn';

interface OrgEvent {
  id: number;
  type: OrgEventType;
  created_at: string;
  to?: string | null;
  body?: string;
  actor_name?: string | null;
}

interface IncidentDetail extends IncidentSummary {
  full_report_shared: boolean;
  title?: string;
  description?: string;
  subject_name?: string | null;
  timeline: OrgEvent[];
}

const UPDATE_MIN = 20;
const UPDATE_MAX = 5000;

const EVENT_LABEL: Record<OrgEventType, string | null> = {
  reported: 'org_safeguarding.timeline_reported',
  migrated: null,
  status_changed: 'org_safeguarding.timeline_status_changed',
  message_to_organisation: 'org_safeguarding.message_from_team',
  org_update: 'org_safeguarding.timeline_org_update',
  reporter_addition: 'org_safeguarding.timeline_reporter_addition',
  shared_with_organisation: 'org_safeguarding.timeline_shared',
  share_withdrawn: 'org_safeguarding.timeline_share_withdrawn',
};

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T'));
  return withTime ? date.toLocaleString(getFormattingLocale()) : date.toLocaleDateString(getFormattingLocale());
}

/** Copy only the fields this page shows — never anything about who reported it. */
function pickSummary(raw: Record<string, unknown>): IncidentSummary {
  return {
    id: Number(raw.id),
    type: String(raw.type ?? 'other'),
    severity: String(raw.severity ?? 'medium'),
    status: String(raw.status ?? 'open'),
    incident_date: typeof raw.incident_date === 'string' ? raw.incident_date : null,
    created_at: String(raw.created_at ?? ''),
    opportunity_title: typeof raw.opportunity_title === 'string' ? raw.opportunity_title : null,
    full_report_shared: raw.full_report_shared === true,
  };
}

function pickDetail(raw: Record<string, unknown>): IncidentDetail {
  const shared = raw.full_report_shared === true;
  const timeline = Array.isArray(raw.timeline) ? (raw.timeline as Record<string, unknown>[]) : [];
  return {
    ...pickSummary(raw),
    full_report_shared: shared,
    ...(shared ? {
      title: typeof raw.title === 'string' ? raw.title : '',
      description: typeof raw.description === 'string' ? raw.description : '',
      subject_name: typeof raw.subject_name === 'string' ? raw.subject_name : null,
    } : {}),
    timeline: timeline.map((e) => ({
      id: Number(e.id),
      type: e.type as OrgEventType,
      created_at: String(e.created_at ?? ''),
      to: typeof e.to === 'string' ? e.to : null,
      body: typeof e.body === 'string' ? e.body : undefined,
      // The organisation's own updates name who in the organisation wrote them.
      actor_name: e.type === 'org_update' && typeof e.actor_name === 'string' ? e.actor_name : null,
    })),
  };
}

interface OrgSafeguardingPageProps {
  /** Rendered inside the organisation dashboard rather than as its own page. */
  embedded?: boolean;
  orgId?: number;
}

export function OrgSafeguardingPage({ embedded = false, orgId: orgIdProp }: OrgSafeguardingPageProps = {}) {
  const { t } = useTranslation('volunteering');
  const params = useParams<{ orgId?: string; id?: string }>();
  const orgId = orgIdProp ?? Number(params.orgId);
  const incidentId = !embedded && params.id ? Number(params.id) : null;

  const page = incidentId
    ? <IncidentView orgId={orgId} incidentId={incidentId} />
    : <IncidentList orgId={orgId} embedded={embedded} />;

  // Inside the organisation dashboard the dashboard keeps its own tab title.
  return embedded ? page : <><PageTitle title={t('org_safeguarding.title')} />{page}</>;
}

function PageTitle({ title }: { title: string }) {
  usePageTitle(title);
  return null;
}

function IncidentList({ orgId, embedded }: { orgId: number; embedded: boolean }) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const [items, setItems] = useState<IncidentSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'failed'>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get<{ items?: Record<string, unknown>[] }>(`/v2/volunteering/organisations/${orgId}/incidents`);
        if (!active) return;
        if (res.success && res.data) {
          setItems((res.data.items ?? []).map(pickSummary));
          setState('ready');
        } else {
          setState(res.code === 'NOT_ORGANISATION_CONTACT' || res.code === 'FORBIDDEN' ? 'forbidden' : 'failed');
        }
      } catch (err) {
        logError('Failed to load organisation safeguarding reports', err);
        if (active) setState('failed');
      }
    })();
    return () => { active = false; };
  }, [orgId]);

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto max-w-4xl space-y-4 p-4'}>
      {!embedded && (
        <>
          <Link to={tenantPath(`/volunteering/org/${orgId}/dashboard`)} className="inline-flex items-center gap-1 text-sm text-theme-muted hover:underline">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t('org_safeguarding.back_to_dashboard')}
          </Link>
          <h1 className="text-xl font-semibold text-theme-primary">{t('org_safeguarding.title')}</h1>
        </>
      )}
      <p className="text-sm text-theme-muted">{t('org_safeguarding.intro')}</p>

      {state === 'loading' && <div role="status" aria-busy="true" className="space-y-3"><CardRowsSkeleton /><CardRowsSkeleton /></div>}
      {state === 'forbidden' && <EmptyState icon={<ShieldAlert className="w-12 h-12" aria-hidden="true" />} title={t('org_safeguarding.forbidden')} />}
      {state === 'failed' && <EmptyState icon={<ShieldAlert className="w-12 h-12" aria-hidden="true" />} title={t('org_safeguarding.load_error')} />}
      {state === 'ready' && items.length === 0 && (
        <EmptyState icon={<ShieldAlert className="w-12 h-12" aria-hidden="true" />} title={t('org_safeguarding.empty')} />
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <GlassCard className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={tenantPath(`/volunteering/org/${orgId}/safeguarding/${item.id}`)} className="font-semibold text-theme-primary hover:underline">
                    <span>#{item.id}</span> · <span>{t(`safeguarding.incident_types.${item.type}`)}</span>
                  </Link>
                  <Chip size="sm" variant="soft" color={item.severity === 'high' || item.severity === 'critical' ? 'danger' : 'warning'}>
                    {t(`safeguarding.severity_options.${item.severity}`)}
                  </Chip>
                  <Chip size="sm" variant="soft">{t(memberStatusKey(item.status))}</Chip>
                  {item.full_report_shared && <Chip size="sm" variant="soft" color="success">{t('org_safeguarding.shared_chip')}</Chip>}
                </div>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-theme-muted">
                  <div className="flex gap-1"><dt>{t('org_safeguarding.col_date')}:</dt><dd>{formatDate(item.incident_date || item.created_at)}</dd></div>
                  {item.opportunity_title && <div className="flex gap-1"><dt>{t('org_safeguarding.col_opportunity')}:</dt><dd>{item.opportunity_title}</dd></div>}
                </dl>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IncidentView({ orgId, incidentId }: { orgId: number; incidentId: number }) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [update, setUpdate] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Record<string, unknown>>(`/v2/volunteering/organisations/${orgId}/incidents/${incidentId}`);
      if (res.success && res.data) {
        setIncident(pickDetail(res.data));
        setState('ready');
      } else {
        setState(res.code === 'NOT_FOUND' ? 'missing' : 'failed');
      }
    } catch (err) {
      logError('Failed to load organisation safeguarding report', err);
      setState('failed');
    }
  }, [orgId, incidentId]);

  useEffect(() => { void load(); }, [load]);

  const sendUpdate = async () => {
    const body = update.trim();
    if (body.length < UPDATE_MIN) {
      setUpdateError(t('org_safeguarding.update_too_short'));
      return;
    }
    setIsSending(true);
    try {
      const res = await api.post(`/v2/volunteering/organisations/${orgId}/incidents/${incidentId}/updates`, { body });
      if (res.success) {
        setUpdate('');
        toast.success(t('org_safeguarding.update_sent'));
        await load();
      } else {
        setUpdateError(res.error || t('org_safeguarding.load_error'));
      }
    } catch (err) {
      logError('Failed to send organisation update', err);
      setUpdateError(t('org_safeguarding.load_error'));
    }
    setIsSending(false);
  };

  const back = (
    <Link to={tenantPath(`/volunteering/org/${orgId}/safeguarding`)} className="inline-flex items-center gap-1 text-sm text-theme-muted hover:underline">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      {t('org_safeguarding.back_to_list')}
    </Link>
  );

  if (state === 'loading') {
    return <div className="mx-auto max-w-3xl space-y-3 p-4" role="status" aria-busy="true"><CardRowsSkeleton /><CardRowsSkeleton /></div>;
  }
  if (state !== 'ready' || !incident) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {back}
        <EmptyState
          icon={<ShieldAlert className="w-12 h-12" aria-hidden="true" />}
          title={state === 'missing' ? t('org_safeguarding.not_found') : t('org_safeguarding.load_error')}
        />
      </div>
    );
  }

  const facts: [string, string | null | undefined][] = [
    [t('org_safeguarding.col_kind'), t(`safeguarding.incident_types.${incident.type}`)],
    [t('org_safeguarding.col_severity'), t(`safeguarding.severity_options.${incident.severity}`)],
    [t('org_safeguarding.col_date'), formatDate(incident.incident_date)],
    [t('org_safeguarding.col_opportunity'), incident.opportunity_title],
  ];
  const events = [...incident.timeline].filter((e) => EVENT_LABEL[e.type]).reverse();

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      {back}

      <GlassCard className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-theme-muted">{t('org_safeguarding.reference', { id: incident.id })}</span>
          <Chip size="sm" variant="soft">{t(memberStatusKey(incident.status))}</Chip>
          {incident.full_report_shared && <Chip size="sm" variant="soft" color="success">{t('org_safeguarding.shared_chip')}</Chip>}
        </div>
        <h1 className="text-xl font-semibold text-theme-primary">{t('org_safeguarding.detail_title')}</h1>
        <p className="text-sm text-theme-muted">{t('org_safeguarding.team_handling')}</p>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {facts.filter(([, value]) => !!value).map(([label, value]) => (
            <div key={label}>
              <dt className="text-theme-muted">{label}</dt>
              <dd className="font-medium text-theme-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </GlassCard>

      {incident.full_report_shared && (
        <GlassCard className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-theme-primary">{t('org_safeguarding.full_report_heading')}</h2>
          <p className="font-medium text-theme-primary">{incident.title}</p>
          <p className="whitespace-pre-line text-sm text-theme-primary">{incident.description}</p>
          {incident.subject_name && (
            <div className="text-sm">
              <span className="text-theme-muted">{t('org_safeguarding.about_label')}: </span>
              <span className="font-medium text-theme-primary">{incident.subject_name}</span>
            </div>
          )}
        </GlassCard>
      )}

      <GlassCard className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-theme-primary">{t('org_safeguarding.history_heading')}</h2>
        <ol className="space-y-4">
          {events.map((event) => (
            <li key={event.id}>
              <p className="text-sm font-medium text-theme-primary">
                {t(EVENT_LABEL[event.type] as string)}
                {event.type === 'status_changed' && event.to && (
                  <span className="font-normal text-theme-muted"> — {t(memberStatusKey(event.to))}</span>
                )}
              </p>
              <p className="text-xs text-theme-subtle">
                {[event.actor_name, formatDate(event.created_at, true)].filter(Boolean).join(' · ')}
              </p>
              {event.body && <p className="mt-1 whitespace-pre-line text-sm text-theme-primary">{event.body}</p>}
            </li>
          ))}
        </ol>
      </GlassCard>

      <GlassCard className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-theme-primary">{t('org_safeguarding.updates_heading')}</h2>
        <Textarea
          label={t('org_safeguarding.update_label')}
          description={t('org_safeguarding.update_hint')}
          value={update}
          maxLength={UPDATE_MAX}
          onValueChange={(v) => { setUpdate(v); setUpdateError(null); }}
          isInvalid={!!updateError}
          errorMessage={updateError ?? undefined}
        />
        <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={sendUpdate} isLoading={isSending}>
          {t('org_safeguarding.update_send')}
        </Button>
      </GlassCard>
    </div>
  );
}

export default OrgSafeguardingPage;
