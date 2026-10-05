// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A safeguarding report, as the person who made it sees it: what they
 * reported, what has happened since (in plain words), and a box to add more
 * information until the report is closed.
 *
 * The server only ever sends the reporter's own view — never the team's notes,
 * reasons or the organisation's messages — and answers "not found" for anyone
 * else's report.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import FileWarning from 'lucide-react/icons/file-warning';
import MessageSquare from 'lucide-react/icons/message-square';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import MessageSquarePlus from 'lucide-react/icons/message-square-plus';
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

type ReporterEventType = 'reported' | 'migrated' | 'status_changed' | 'message_to_reporter' | 'reporter_addition';

interface ReporterEvent {
  id: number;
  type: ReporterEventType;
  created_at: string;
  from?: string | null;
  to?: string | null;
  body?: string;
}

interface ReporterIncident {
  id: number;
  type: string;
  severity: string;
  status: string;
  incident_date: string | null;
  created_at: string;
  organization_name: string | null;
  opportunity_title: string | null;
  title: string;
  description: string;
  subject_name: string | null;
  can_add: boolean;
  timeline: ReporterEvent[];
}

/** Information added later must say something; the server enforces the same. */
const ADDITION_MIN = 20;
const ADDITION_MAX = 5000;

const EVENT_LABEL: Partial<Record<ReporterEventType, string>> = {
  reported: 'safeguarding.timeline_reported',
  status_changed: 'safeguarding.timeline_status_changed',
  message_to_reporter: 'safeguarding.timeline_message_from_team',
  reporter_addition: 'safeguarding.timeline_your_addition',
};
const EVENT_ICON = {
  reported: FileWarning,
  migrated: FileWarning,
  status_changed: ArrowRightLeft,
  message_to_reporter: MessageSquare,
  reporter_addition: MessageSquarePlus,
} as const;

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value.replace(' ', 'T'));
  return withTime ? date.toLocaleString(getFormattingLocale()) : date.toLocaleDateString(getFormattingLocale());
}

export function IncidentReportPage() {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const incidentId = Number(id);

  const [report, setReport] = useState<ReporterIncident | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
  const [addition, setAddition] = useState('');
  const [additionError, setAdditionError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  usePageTitle(t('safeguarding.report_page_title'));

  const load = useCallback(async () => {
    try {
      const res = await api.get<ReporterIncident>(`/v2/volunteering/incidents/${incidentId}`);
      if (res.success && res.data) {
        setReport(res.data);
        setState('ready');
      } else {
        setState(res.code === 'NOT_FOUND' ? 'missing' : 'failed');
      }
    } catch (err) {
      logError('Failed to load safeguarding report', err);
      setState('failed');
    }
  }, [incidentId]);

  useEffect(() => { void load(); }, [load]);

  const sendAddition = async () => {
    const body = addition.trim();
    if (body.length < ADDITION_MIN) {
      setAdditionError(t('safeguarding.report_add_too_short'));
      return;
    }
    setIsSending(true);
    try {
      const res = await api.post(`/v2/volunteering/incidents/${incidentId}/additions`, { body });
      if (res.success) {
        setAddition('');
        toast.success(t('safeguarding.report_added'));
        await load();
      } else {
        // The server says why (too short, or the report has just been closed),
        // in the member's own language.
        setAdditionError(res.error || t('safeguarding.incident_failed'));
        if (res.code === 'INCIDENT_CLOSED') await load();
      }
    } catch (err) {
      logError('Failed to add to safeguarding report', err);
      setAdditionError(t('safeguarding.incident_failed'));
    }
    setIsSending(false);
  };

  const backLink = (
    <Link to={tenantPath('/volunteering?tab=safeguarding')} className="inline-flex items-center gap-1 text-sm text-theme-muted hover:underline">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      {t('safeguarding.report_back')}
    </Link>
  );

  if (state === 'loading') {
    return <div className="mx-auto max-w-3xl space-y-3 p-4" role="status" aria-busy="true"><CardRowsSkeleton /><CardRowsSkeleton /></div>;
  }
  if (state !== 'ready' || !report) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {backLink}
        <EmptyState
          icon={<FileWarning className="w-12 h-12" aria-hidden="true" />}
          title={state === 'missing' ? t('safeguarding.report_not_found') : t('safeguarding.load_error')}
        />
      </div>
    );
  }

  const events = report.timeline.filter((e) => e.type !== 'migrated');
  const facts: [string, string | null][] = [
    [t('safeguarding.report_fact_kind'), t(`safeguarding.incident_types.${report.type}`)],
    [t('safeguarding.report_fact_date'), formatDate(report.incident_date)],
    [t('safeguarding.report_fact_organisation'), report.organization_name],
    [t('safeguarding.report_fact_opportunity'), report.opportunity_title],
    [t('safeguarding.report_fact_person'), report.subject_name],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      {backLink}

      <GlassCard className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-theme-muted">{t('safeguarding.report_reference', { id: report.id })}</span>
          <Chip size="sm" variant="soft" color={report.status === 'closed' || report.status === 'resolved' ? 'success' : 'warning'}>
            {t(memberStatusKey(report.status))}
          </Chip>
        </div>
        <h1 className="text-xl font-semibold text-theme-primary">{report.title}</h1>
      </GlassCard>

      <GlassCard className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-theme-primary">{t('safeguarding.report_what_you_reported')}</h2>
        <p className="whitespace-pre-line text-sm text-theme-primary">{report.description}</p>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {facts.filter(([, value]) => !!value).map(([label, value]) => (
            <div key={label}>
              <dt className="text-theme-muted">{label}</dt>
              <dd className="font-medium text-theme-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </GlassCard>

      <GlassCard className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-theme-primary">{t('safeguarding.report_what_has_happened')}</h2>
        <ol className="space-y-4">
          {[...events].reverse().map((event) => {
            const Icon = EVENT_ICON[event.type] ?? FileWarning;
            return (
              <li key={event.id} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-theme-elevated">
                  <Icon className="w-4 h-4 text-theme-muted" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-theme-primary">
                    {t(EVENT_LABEL[event.type] ?? 'safeguarding.timeline_reported')}
                    {event.type === 'status_changed' && event.to && (
                      <span className="font-normal text-theme-muted"> — {t(memberStatusKey(event.to))}</span>
                    )}
                  </p>
                  <p className="text-xs text-theme-subtle">{formatDate(event.created_at, true)}</p>
                  {event.body && <p className="mt-1 whitespace-pre-line text-sm text-theme-primary">{event.body}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </GlassCard>

      <GlassCard className="space-y-3 p-5">
        {report.can_add ? (
          <>
            <Textarea
              label={t('safeguarding.report_add_heading')}
              description={t('safeguarding.report_add_hint')}
              value={addition}
              maxLength={ADDITION_MAX}
              onValueChange={(v) => { setAddition(v); setAdditionError(null); }}
              isInvalid={!!additionError}
              errorMessage={additionError ?? undefined}
            />
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={sendAddition}
              isLoading={isSending}
            >
              {t('safeguarding.report_add_button')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-theme-primary">{t('safeguarding.report_closed_message')}</p>
            <Link to={tenantPath('/volunteering?tab=safeguarding&report=1')} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
              {t('safeguarding.report_make_new')}
            </Link>
          </>
        )}
      </GlassCard>
    </div>
  );
}

export default IncidentReportPage;
